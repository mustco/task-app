// app/api/reschedule-reminder/route.ts (FINAL - HANYA LOGIKA KONTAK YANG DIUBAH)

import { NextRequest, NextResponse } from "next/server";
import { scheduleTaskReminder } from "../../../src/trigger/task";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import validator from "validator";

const RescheduleReminderSchema = z.object({
  taskId: z.string().uuid("Invalid taskId format. Must be a UUID."),
  hasReminder: z.boolean(),
});

// ✅ PERUBAHAN 1: Interface disesuaikanAdnan0111710

interface TaskWithUser {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  deadline: string;
  reminder_days: number;
  remind_method: "email" | "whatsapp" | "both" | null;
  target_email: string | null; // Kolom baru
  target_phone: string | null; // Kolom baru
  trigger_handle_id?: string | null;
  users: {
    name: string;
    email: string;
    phone_number?: string;
  } | null;
}

async function cancelTriggerHandle(handleId: string): Promise<boolean> {
  const url = `https://api.trigger.dev/api/v2/runs/${handleId}/cancel`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      console.log(`✅ Successfully cancelled trigger ${handleId} using ${url}`);
      return true;
    } else {
      console.warn(
        `❌ Failed to cancel trigger ${handleId} with ${url}: ${response.status} - ${await response.text()}`
      );
      return false;
    }
  } catch (error: any) {
    if (error.name === "AbortError")
      console.error(`Timeout when trying to cancel trigger ${handleId}.`);
    else
      console.error(`Error cancelling trigger ${handleId} with ${url}:`, error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. Validasi Input Body
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

    // 2. Autentikasi Pengguna
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error("Authentication error:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ✅ PERUBAHAN 2: Query select disesuaikan
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

    // 4. Otorisasi
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

    let cancelResult = { success: false, attempted: false };

    // 5. HAPUS JADWAL LAMA
    if (task.trigger_handle_id) {
      cancelResult.attempted = true;
      console.log(
        `🔄 Attempting to cancel old reminder: ${task.trigger_handle_id}`
      );
      cancelResult.success = await cancelTriggerHandle(task.trigger_handle_id);
      if (cancelResult.success)
        console.log(`✅ Old reminder cancelled successfully`);
      else
        console.warn(
          `⚠️ Could not cancel old reminder ${task.trigger_handle_id} - might already be executed or expired`
        );
    }

    let newTriggerHandleId: string | null = null;
    let scheduleResult = { success: false, error: null as string | null };
    let scheduledFor = {
      email: undefined as string | undefined,
      whatsapp: undefined as string | undefined,
      method: undefined as string | undefined,
    };

    if (hasReminder) {
      if (!task.remind_method) {
        return NextResponse.json(
          {
            error:
              "Remind method not set for this task. Cannot schedule a reminder.",
          },
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

      // ✅ PERUBAHAN 3: Logika kontak disederhanakan secara total
      let recipientEmail: string | undefined;
      let recipientPhone: string | undefined;

      if (task.remind_method === "email" || task.remind_method === "both") {
        recipientEmail = task.target_email || userDetails.email;
      }
      if (task.remind_method === "whatsapp" || task.remind_method === "both") {
        recipientPhone = task.target_phone || userDetails.phone_number;
      }

      if (recipientEmail && !validator.isEmail(recipientEmail)) {
        return NextResponse.json(
          { error: "Invalid email address for reminder." },
          { status: 400 }
        );
      }
      if (recipientPhone) {
        if (!/^\+?\d{8,15}$/.test(recipientPhone)) {
          return NextResponse.json(
            { error: "Invalid WhatsApp phone number for reminder." },
            { status: 400 }
          );
        }
        if (recipientPhone.startsWith("0")) {
          recipientPhone = "62" + recipientPhone.substring(1);
        }
      }

      // Validasi Akhir untuk Ketersediaan Kontak
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
      if (
        task.remind_method === "both" &&
        (!recipientEmail || !recipientPhone)
      ) {
        return NextResponse.json(
          {
            error:
              "Valid email and phone number are required for both reminder methods.",
          },
          { status: 400 }
        );
      }

      // Validasi `reminder_days`
      if (task.reminder_days < 0 || task.reminder_days > 365) {
        return NextResponse.json(
          { error: "Reminder days must be between 0 and 365." },
          { status: 400 }
        );
      }

      const firstName = (userDetails.name || "User").split(" ")[0];
      const deadlineDate = new Date(task.deadline);
      const reminderTimestamp =
        deadlineDate.getTime() - task.reminder_days * 24 * 60 * 60 * 1000;

      if (new Date(reminderTimestamp).getTime() <= new Date().getTime()) {
        return NextResponse.json(
          {
            error:
              "The calculated reminder time has already passed. Cannot schedule reminder for a past date.",
          },
          { status: 400 }
        );
      }

      try {
        const handle = await scheduleTaskReminder({
          id: task.id,
          title: task.title,
          description: task.description,
          deadline: task.deadline,
          reminderDays: task.reminder_days,
          recipientEmail: recipientEmail || "",
          recipientPhone: recipientPhone,
          firstName: firstName,
        });
        newTriggerHandleId = handle.id;
        scheduleResult.success = true;
        scheduledFor = {
          email: recipientEmail,
          whatsapp: recipientPhone,
          method: task.remind_method,
        };
        console.log(`✅ New reminder scheduled: ${newTriggerHandleId}`);
      } catch (error: any) {
        scheduleResult.error = error.message;
        console.error("Error scheduling new reminder:", error);
        return NextResponse.json(
          { error: "Failed to schedule new reminder", details: error.message },
          { status: 500 }
        );
      }
    } else {
      console.log("hasReminder is false. No new reminder will be scheduled.");
    }

    // 7. UPDATE TRIGGER_HANDLE_ID DI DATABASE
    const { error: updateError } = await supabaseAdmin
      .from("tasks")
      .update({ trigger_handle_id: newTriggerHandleId })
      .eq("id", taskId);

    if (updateError) {
      console.error("Failed to update trigger_handle_id in DB:", updateError);
    }

    return NextResponse.json({
      success: true,
      message: hasReminder
        ? "Reminder rescheduled successfully"
        : "Reminder cancelled successfully",
      taskId: task.id,
      oldTriggerHandle: task.trigger_handle_id,
      newTriggerHandle: newTriggerHandleId,
      cancelResult: cancelResult,
      scheduleResult: scheduleResult,
      action: hasReminder ? "rescheduled" : "cancelled",
      scheduledFor: scheduledFor,
    });
  } catch (error: any) {
    console.error("Error in reschedule-reminder API:", error);
    return NextResponse.json(
      { error: "Failed to process reminder request", details: error.message },
      { status: 500 }
    );
  }
}
