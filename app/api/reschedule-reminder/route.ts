// app/api/reschedule-reminder/route.ts
import { NextRequest, NextResponse } from "next/server";
import { scheduleTaskReminder } from "../../../src/trigger/task";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import validator from "validator";

// 🔑 gunakan SDK untuk cancel biar environment/key gak mismatch
import { runs } from "@trigger.dev/sdk/v3";

const RescheduleReminderSchema = z.object({
  taskId: z.string().uuid("Invalid taskId format. Must be a UUID."),
  hasReminder: z.boolean(),
});

interface TaskWithUser {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  deadline: string;
  reminder_days: number;
  remind_method: "email" | "whatsapp" | "both" | null;
  target_email: string | null;
  target_phone: string | null;
  trigger_handle_id?: string | null;
  users: {
    name: string | null;
    email: string;
    phone_number?: string | null;
  } | null;
}

async function cancelTriggerHandle(handleId: string): Promise<boolean> {
  if (!handleId) return false;
  // Pastikan formatnya run_... sesuai Trigger.dev
  if (!/^run_/.test(handleId)) {
    console.warn(`Skipping cancel, invalid run handle format: ${handleId}`);
    return false;
  }
  try {
    await runs.cancel(handleId);
    console.log(`✅ Successfully cancelled run ${handleId}`);
    return true;
  } catch (e: any) {
    const msg = e?.message || String(e);
    // 404 = run sudah gak ada (sudah jalan/expired). Aman lanjut.
    console.warn(`⚠️ runs.cancel failed for ${handleId}: ${msg}`);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1) Validasi body
    const body = await request.json();
    const validationResult = RescheduleReminderSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }
    const { taskId, hasReminder } = validationResult.data;

    // 2) Autentikasi
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error("Authentication error:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 3) Ambil task + user
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select(
        `
        id, title, description, deadline, reminder_days, user_id,
        remind_method, target_email, target_phone, trigger_handle_id,
        users(name, email, phone_number)
        `
      )
      .eq("id", taskId)
      .single<TaskWithUser>();

    if (fetchError || !task) {
      console.error("Supabase fetch error:", fetchError);
      return NextResponse.json(
        { error: "Task not found or you do not have permission to access it." },
        { status: 404 }
      );
    }

    // 4) Otorisasi
    if (task.user_id !== user.id) {
      console.warn(
        `User ${user.id} attempted to reschedule reminder for task ${taskId} belonging to user ${task.user_id}`
      );
      return NextResponse.json(
        {
          error:
            "Forbidden: You do not have permission to reschedule reminders for this task.",
        },
        { status: 403 }
      );
    }

    // 5) Cancel run lama dulu (kalau ada)
    let cancelResult = { success: false, attempted: false };
    if (task.trigger_handle_id) {
      cancelResult.attempted = true;
      console.log(`🔄 Attempting to cancel old run: ${task.trigger_handle_id}`);
      cancelResult.success = await cancelTriggerHandle(task.trigger_handle_id);
      if (cancelResult.success)
        console.log("✅ Old reminder cancelled successfully");
      else
        console.warn(
          `⚠️ Could not cancel old reminder ${task.trigger_handle_id} (may be missing/expired)`
        );
    }

    // 6) Kalau user memutuskan tidak pakai reminder lagi, selesai di sini
    if (!hasReminder) {
      await supabaseAdmin
        .from("tasks")
        .update({ trigger_handle_id: null })
        .eq("id", taskId);
      return NextResponse.json({
        success: true,
        action: "cancelled",
        message: "Reminder cancelled successfully",
        taskId: task.id,
        oldTriggerHandle: task.trigger_handle_id,
        newTriggerHandle: null,
        cancelResult,
        scheduleResult: { success: false, error: null },
        scheduledFor: {
          method: undefined,
          email: undefined,
          whatsapp: undefined,
        },
      });
    }

    // 7) Validasi method & kontak
    if (!task.remind_method) {
      return NextResponse.json(
        { error: "Remind method not set for this task." },
        { status: 400 }
      );
    }

    const userDetails = task.users;
    if (!userDetails) {
      return NextResponse.json(
        { error: "Task has no associated user details." },
        { status: 404 }
      );
    }

    let recipientEmail: string | undefined;
    let recipientPhone: string | undefined;

    if (task.remind_method === "email" || task.remind_method === "both") {
      recipientEmail = task.target_email || userDetails.email;
    }
    if (task.remind_method === "whatsapp" || task.remind_method === "both") {
      recipientPhone =
        task.target_phone || userDetails.phone_number || undefined;
    }

    if (recipientEmail && !validator.isEmail(recipientEmail)) {
      return NextResponse.json(
        { error: "Invalid email address for reminder." },
        { status: 400 }
      );
    }

    if (recipientPhone) {
      recipientPhone = recipientPhone.trim().replace(/[\s-]/g, "");
      if (recipientPhone.startsWith("0"))
        recipientPhone = "62" + recipientPhone.slice(1);
      else if (recipientPhone.startsWith("+62"))
        recipientPhone = recipientPhone.slice(1);
      else if (!recipientPhone.startsWith("62"))
        recipientPhone = "62" + recipientPhone;
      if (!/^62\d{8,13}$/.test(recipientPhone)) {
        return NextResponse.json(
          { error: "Invalid WhatsApp number format (must start with 62...)" },
          { status: 400 }
        );
      }
    }

    if (task.remind_method === "email" && !recipientEmail) {
      return NextResponse.json(
        { error: "No valid email address found for email reminder." },
        { status: 400 }
      );
    }
    if (task.remind_method === "whatsapp" && !recipientPhone) {
      return NextResponse.json(
        { error: "No valid phone number found for WhatsApp reminder." },
        { status: 400 }
      );
    }
    if (task.remind_method === "both" && (!recipientEmail || !recipientPhone)) {
      return NextResponse.json(
        { error: "Valid email and phone number are required for both." },
        { status: 400 }
      );
    }

    if (task.reminder_days < 0 || task.reminder_days > 365) {
      return NextResponse.json(
        { error: "Reminder days must be between 0 and 365." },
        { status: 400 }
      );
    }

    // 8) Hitung waktu reminder — tolak jika sudah lewat
    const firstName = (userDetails.name || "User").split(" ")[0];
    const deadlineDate = new Date(task.deadline);
    const reminderTimestamp =
      deadlineDate.getTime() - task.reminder_days * 24 * 60 * 60 * 1000;
    if (reminderTimestamp < Date.now()) {
      // Sudah lewat → jangan buat run baru
      await supabaseAdmin
        .from("tasks")
        .update({ trigger_handle_id: null })
        .eq("id", taskId);

      return NextResponse.json(
        {
          error:
            "The calculated reminder time has already passed. Cannot schedule reminder for a past date.",
        },
        { status: 400 }
      );
    }

    // 9) Buat run baru
    let newTriggerHandleId: string | null = null;
    let scheduleResult = { success: false, error: null as string | null };
    let scheduledFor = {
      email: recipientEmail,
      whatsapp: recipientPhone,
      method: task.remind_method,
    };

    try {
      const handle = await scheduleTaskReminder({
        id: task.id,
        title: task.title,
        description: task.description || undefined,
        deadline: task.deadline,
        reminderDays: task.reminder_days,
        recipientEmail: recipientEmail || "",
        recipientPhone: recipientPhone,
        firstName,
      });

      if (!handle?.id || !/^run_/.test(handle.id)) {
        throw new Error("Unexpected run handle id from Trigger.dev");
      }

      newTriggerHandleId = handle.id;
      scheduleResult.success = true;
      console.log(`✅ New reminder scheduled: ${newTriggerHandleId}`);
    } catch (error: any) {
      scheduleResult.error = error?.message || "Unknown schedule error";
      console.error("Error scheduling new reminder:", error);
      return NextResponse.json(
        {
          error: "Failed to schedule new reminder",
          details: scheduleResult.error,
        },
        { status: 500 }
      );
    }

    // 10) Simpan handle baru
    const { error: updateError } = await supabaseAdmin
      .from("tasks")
      .update({ trigger_handle_id: newTriggerHandleId })
      .eq("id", taskId);
    if (updateError) {
      console.error("Failed to update trigger_handle_id in DB:", updateError);
    }

    return NextResponse.json({
      success: true,
      message: "Reminder rescheduled successfully",
      action: "rescheduled",
      taskId: task.id,
      oldTriggerHandle: task.trigger_handle_id,
      newTriggerHandle: newTriggerHandleId,
      cancelResult,
      scheduleResult,
      scheduledFor,
    });
  } catch (error: any) {
    console.error("Error in reschedule-reminder API:", error);
    return NextResponse.json(
      { error: "Failed to process reminder request", details: error.message },
      { status: 500 }
    );
  }
}
