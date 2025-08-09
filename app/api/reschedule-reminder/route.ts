// app/api/reschedule-reminder/route.ts

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

interface TaskWithUser {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  deadline: string;
  reminder_days: number;
  remind_method: "email" | "whatsapp" | "both" | null;
  target_email: string | null;
  target_phone: string | null;
  trigger_handle_id?: string | null;
  users: {
    name: string;
    email: string;
    phone_number?: string;
  } | null;
}

// Optimized cancel function dengan timeout lebih pendek
async function cancelTriggerHandle(handleId: string): Promise<boolean> {
  const url = `https://api.trigger.dev/api/v2/runs/${handleId}/cancel`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 detik aja

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      console.log(`✅ Cancelled trigger ${handleId}`);
      return true;
    } else {
      console.warn(
        `❌ Failed to cancel trigger ${handleId}: ${response.status}`
      );
      return false;
    }
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error(`⏰ Timeout cancelling trigger ${handleId}`);
    } else {
      console.error(`Error cancelling trigger ${handleId}:`, error);
    }
    return false;
  }
}

// Optimized phone normalization
function normalizePhoneNumber(phone: string): string | null {
  const cleaned = phone.trim().replace(/[\s-]/g, "");

  if (cleaned.startsWith("0")) {
    return "62" + cleaned.slice(1);
  } else if (cleaned.startsWith("+62")) {
    return cleaned.slice(1);
  } else if (!cleaned.startsWith("62")) {
    return "62" + cleaned;
  }
  return cleaned;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // 1. Paralel validation + auth
    const [bodyResult, authResult] = await Promise.all([
      request.json(),
      (async () => {
        const supabase = await createClient();
        return supabase.auth.getUser();
      })(),
    ]);

    // Validate input
    const validationResult = RescheduleReminderSchema.safeParse(bodyResult);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    // Check auth
    const {
      data: { user },
      error: authError,
    } = authResult;
    if (authError || !user) {
      console.error("Authentication error:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { taskId, hasReminder } = validationResult.data;

    // 2. Fetch task dengan optimized query
    const supabase = await createClient();
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select(
        `id, title, description, deadline, reminder_days, user_id,
         remind_method, target_email, target_phone, trigger_handle_id,
         users!inner(name, email, phone_number)`
      )
      .eq("id", taskId)
      .eq("user_id", user.id) // Filter di query level
      .single<TaskWithUser>();

    if (fetchError || !task) {
      console.error("Task fetch error:", fetchError);
      return NextResponse.json(
        { error: "Task not found or access denied." },
        { status: 404 }
      );
    }

    // 3. Cancel old trigger (non-blocking jika gagal)
    let cancelResult = { success: false, attempted: false };
    let cancelPromise: Promise<void> | null = null;

    if (task.trigger_handle_id) {
      cancelResult.attempted = true;
      console.log(`🔄 Cancelling old reminder: ${task.trigger_handle_id}`);

      // Start cancel in background
      cancelPromise = cancelTriggerHandle(task.trigger_handle_id).then(
        (success) => {
          cancelResult.success = success;
        }
      );
    }

    let newTriggerHandleId: string | null = null;
    let scheduleResult = { success: false, error: null as string | null };
    let scheduledFor = {
      email: undefined as string | undefined,
      whatsapp: undefined as string | undefined,
      method: undefined as string | undefined,
    };

    // 4. Schedule new reminder (jika diperlukan)
    if (hasReminder) {
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

      // Quick validation
      if (task.reminder_days < 0 || task.reminder_days > 365) {
        return NextResponse.json(
          { error: "Reminder days must be between 0 and 365." },
          { status: 400 }
        );
      }

      // Setup recipients
      let recipientEmail: string | undefined;
      let recipientPhone: string | undefined;

      if (task.remind_method === "email" || task.remind_method === "both") {
        recipientEmail = task.target_email || userDetails.email;
        if (!validator.isEmail(recipientEmail)) {
          return NextResponse.json(
            { error: "Invalid email address." },
            { status: 400 }
          );
        }
      }

      if (task.remind_method === "whatsapp" || task.remind_method === "both") {
        const phoneToNormalize = task.target_phone || userDetails.phone_number;
       if (phoneToNormalize) {
         const normalized = normalizePhoneNumber(phoneToNormalize);
         recipientPhone = normalized || undefined; // Convert null to undefined
         if (!recipientPhone || !/^62\d{8,13}$/.test(recipientPhone)) {
           return NextResponse.json(
             { error: "Invalid WhatsApp number format." },
             { status: 400 }
           );
         }
       }
      }

      // Validate required contacts
      if (task.remind_method === "email" && !recipientEmail) {
        return NextResponse.json(
          { error: "No valid email address found." },
          { status: 400 }
        );
      }
      if (task.remind_method === "whatsapp" && !recipientPhone) {
        return NextResponse.json(
          { error: "No valid phone number found." },
          { status: 400 }
        );
      }
      if (
        task.remind_method === "both" &&
        (!recipientEmail || !recipientPhone)
      ) {
        return NextResponse.json(
          { error: "Both email and phone required." },
          { status: 400 }
        );
      }

      // Check timing
      const deadlineDate = new Date(task.deadline);
      const reminderTimestamp =
        deadlineDate.getTime() - task.reminder_days * 24 * 60 * 60 * 1000;

      if (reminderTimestamp < Date.now()) {
        return NextResponse.json(
          { error: "Reminder time has already passed." },
          { status: 400 }
        );
      }

      // Schedule new reminder
      try {
        const firstName = (userDetails.name || "User").split(" ")[0];

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
        console.error("Error scheduling reminder:", error);
        return NextResponse.json(
          { error: "Failed to schedule reminder", details: error.message },
          { status: 500 }
        );
      }
    }

    // 5. Wait for cancel to complete (with timeout)
    if (cancelPromise) {
      try {
        await Promise.race([
          cancelPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Cancel timeout")), 2000)
          ),
        ]);
      } catch (err) {
        console.warn("Cancel operation timed out or failed, continuing...");
      }
    }

    // 6. Update database
    const { error: updateError } = await supabaseAdmin
      .from("tasks")
      .update({ trigger_handle_id: newTriggerHandleId })
      .eq("id", taskId);

    if (updateError) {
      console.error("Failed to update trigger_handle_id:", updateError);
    }

    const processingTime = Date.now() - startTime;
    console.log(`⚡ Reschedule completed in ${processingTime}ms`);

    return NextResponse.json({
      success: true,
      message: hasReminder
        ? "Reminder rescheduled successfully"
        : "Reminder cancelled successfully",
      taskId: task.id,
      oldTriggerHandle: task.trigger_handle_id,
      newTriggerHandle: newTriggerHandleId,
      cancelResult,
      scheduleResult,
      action: hasReminder ? "rescheduled" : "cancelled",
      scheduledFor,
      processingTime,
    });
  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error(`💥 Error after ${processingTime}ms:`, error);

    return NextResponse.json(
      {
        error: "Failed to process reminder request",
        details: error.message,
        processingTime,
      },
      { status: 500 }
    );
  }
}
