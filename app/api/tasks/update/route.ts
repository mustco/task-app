// app/api/tasks/update/route.ts - FIXED VERSION with proper name handling

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { z } from "zod";
import validator from "validator";
import { ratelimit } from "@/lib/upstash-ratelimit";
import { scheduleTaskReminder } from "@/src/trigger/task";

// --- Helper function for canceling Trigger.dev runs ---
async function cancelTriggerHandle(handleId: string): Promise<boolean> {
  const url = `${process.env.TRIGGER_API_URL}/api/v2/runs/${handleId}/cancel`;
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
    if (error.name === "AbortError") {
      console.error(`Timeout when trying to cancel trigger ${handleId}.`);
    } else {
      console.error(`Error cancelling trigger ${handleId} with ${url}:`, error);
    }
    return false;
  }
}

// --- Server-side Zod Schema for Task Update ---
const ServerTaskUpdateSchema = z
  .object({
    taskId: z.string().uuid("Invalid task ID format. Must be a UUID."),
    title: z
      .string()
      .min(1, "Title is required.")
      .max(255, "Title is too long.")
      .optional(),
    description: z
      .string()
      .max(1000, "Description is too long.")
      .nullable()
      .optional(),
    deadline: z
      .string()
      .refine((val) => {
        const date = new Date(val);
        return !isNaN(date.getTime()) && date > new Date();
      }, "Deadline must be a valid future date and time.")
      .optional(),
    status: z
      .enum(["pending", "in_progress", "completed", "overdue"])
      .optional(),

    showReminder: z.boolean().optional(),
    remindMethod: z.enum(["email", "whatsapp", "both"]).optional(),
    targetContact: z.string().optional(),
    emailContact: z.string().email("Invalid email format.").optional(),
    whatsappContact: z.string().optional(),
    reminderDays: z
      .number()
      .min(0, "Reminder days cannot be negative.")
      .max(365, "Reminder days cannot exceed 365 days.")
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.showReminder === true) {
      if (!data.remindMethod) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reminder method is required when reminder is enabled.",
          path: ["remindMethod"],
        });
      }
      if (data.remindMethod === "email") {
        if (!data.targetContact || !validator.isEmail(data.targetContact)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Valid email address is required for email reminder.",
            path: ["targetContact"],
          });
        }
      } else if (data.remindMethod === "whatsapp") {
        if (!data.targetContact || !/^\+?\d{8,15}$/.test(data.targetContact)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Valid WhatsApp number (8-15 digits, optional '+') is required.",
            path: ["targetContact"],
          });
        }
      } else if (data.remindMethod === "both") {
        if (!data.emailContact || !validator.isEmail(data.emailContact)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Valid email address is required for 'both' reminder method.",
            path: ["emailContact"],
          });
        }
        if (
          !data.whatsappContact ||
          !/^\+?\d{8,15}$/.test(data.whatsappContact)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Valid WhatsApp number is required for 'both' reminder method.",
            path: ["whatsappContact"],
          });
        }
      }
      if (data.reminderDays === undefined || data.reminderDays === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reminder days are required when reminder is enabled.",
          path: ["reminderDays"],
        });
      }
    }
  });

// --- Main POST handler for task update ---
export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate User (Server-side)
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("Authentication error in update task API:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Rate Limiting
    const identifier = user.id || request.ip || "anonymous";
    const {
      success: rateLimitPassed,
      limit,
      remaining,
      reset,
    } = await ratelimit.limit(identifier);

    if (!rateLimitPassed) {
      console.warn(`Rate limit exceeded for identifier: ${identifier}`);
      return NextResponse.json(
        {
          error: "Too many requests. Please try again later.",
          limit: limit,
          remaining: remaining,
          reset: reset,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": remaining.toString(),
            "X-RateLimit-Reset": reset.toString(),
          },
        }
      );
    }

    // 3. Validate Request Payload
    const body = await request.json();
    const parsed = ServerTaskUpdateSchema.safeParse(body);

    if (!parsed.success) {
      console.error(
        "Server-side validation failed for update:",
        parsed.error.flatten()
      );
      return NextResponse.json(
        {
          error: "Invalid input data",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const {
      taskId,
      showReminder,
      remindMethod,
      targetContact,
      emailContact,
      whatsappContact,
      reminderDays,
      ...coreTaskUpdates
    } = parsed.data;

    // 4. Fetch current task details for comparison and to ensure ownership
    const { data: existingTask, error: fetchError } = await supabase
      .from("tasks")
      .select(
        `
        id, title, description, deadline, reminder_days, user_id, status,
        remind_method, target_contact, trigger_handle_id
      `
      )
      .eq("id", taskId)
      .single();

    if (fetchError || !existingTask) {
      console.error("Supabase fetch error for existing task:", fetchError);
      return NextResponse.json(
        { error: "Task not found or you do not have permission to access it." },
        { status: 404 }
      );
    }

    // 5. Authorize Task Ownership
    if (existingTask.user_id !== user.id) {
      console.warn(
        `User ${user.id} attempted to update task ${taskId} belonging to user ${existingTask.user_id}`
      );
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to update this task." },
        { status: 403 }
      );
    }

    // 6. Get user details for reminder scheduling if needed
    let userDetailsForScheduling: any = null;
    if (showReminder === true) {
      // First try to get from profiles/users table (adjust table name as needed)
      const { data: userProfile, error: profileError } = await supabase
        .from("users") // Change this to your actual user table name (could be "profiles", "users", etc.)
        .select("name, email, phone_number")
        .eq("id", user.id)
        .single();

      if (profileError || !userProfile) {
        console.warn(
          "Could not fetch user profile, using auth user data as fallback:",
          profileError
        );
        // Fallback to auth user data
        userDetailsForScheduling = {
          name: user.user_metadata?.full_name || null,
          email: user.email,
          phone_number: user.user_metadata?.phone_number || null,
        };
      } else {
        userDetailsForScheduling = userProfile;
      }
    }

    // 7. Prepare Database Update Payload
    type TaskUpdateDBPayload = {
      title?: string;
      description?: string | null;
      deadline?: string;
      status?: "pending" | "in_progress" | "completed" | "overdue";
      remind_method?: "email" | "whatsapp" | "both" | null;
      target_contact?: string | null;
      reminder_days?: number | null;
    };

    const updatesToDB: Partial<TaskUpdateDBPayload> = {
      ...coreTaskUpdates,
    };

    let recipientEmailForReminder: string | undefined;
    let recipientPhoneForReminder: string | undefined;

    // Determine reminder fields for DB and for scheduling function
    if (showReminder === true) {
      updatesToDB.remind_method = remindMethod!;
      updatesToDB.reminder_days = reminderDays!;

      if (remindMethod === "email") {
        recipientEmailForReminder = targetContact!;
        updatesToDB.target_contact = targetContact!;
      } else if (remindMethod === "whatsapp") {
        let normalizedPhone = targetContact!;
        if (normalizedPhone.startsWith("0"))
          normalizedPhone = "62" + normalizedPhone.substring(1);
        else if (
          !normalizedPhone.startsWith("62") &&
          normalizedPhone.length < 15
        ) {
          console.warn(
            `Phone number ${normalizedPhone} does not start with 62. Assuming local and prepending 62 for reminder.`
          );
          normalizedPhone = "62" + normalizedPhone;
        }
        recipientPhoneForReminder = normalizedPhone;
        updatesToDB.target_contact = normalizedPhone;
      } else if (remindMethod === "both") {
        recipientEmailForReminder = emailContact!;
        let normalizedWhatsapp = whatsappContact!;
        if (normalizedWhatsapp.startsWith("0"))
          normalizedWhatsapp = "62" + normalizedWhatsapp.substring(1);
        else if (
          !normalizedWhatsapp.startsWith("62") &&
          normalizedWhatsapp.length < 15
        ) {
          console.warn(
            `Phone number ${normalizedWhatsapp} does not start with 62. Assuming local and prepending 62 for reminder.`
          );
          normalizedWhatsapp = "62" + normalizedWhatsapp;
        }
        recipientPhoneForReminder = normalizedWhatsapp;
        updatesToDB.target_contact = `${recipientEmailForReminder}|${recipientPhoneForReminder}`;
      }
    } else {
      // Reminder is being turned off (showReminder is false)
      updatesToDB.remind_method = null;
      updatesToDB.target_contact = null;
      updatesToDB.reminder_days = null;
    }

    // 8. Perform Database Update
    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update(updatesToDB)
      .eq("id", taskId)
      .eq("user_id", user.id) // Crucial for RLS and ownership check
      .select()
      .single();

    if (updateError) {
      console.error("Supabase update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update task in database. Please try again later." },
        { status: 500 }
      );
    }

    // 9. Handle Reminder Rescheduling/Cancellation
    let oldTriggerHandleId: string | null =
      existingTask.trigger_handle_id || null;
    let newTriggerHandleId: string | null = null;
    let reminderProcessedMessage = "";

    // Determine if reminder settings have functionally changed based on new DB values
    const currentTaskReminderActive = !!existingTask.remind_method;
    const currentTaskContact = existingTask.target_contact || "";
    const currentTaskDays = existingTask.reminder_days ?? 1;
    const currentTaskDeadlineIso = existingTask.deadline
      ? new Date(existingTask.deadline).toISOString()
      : "";

    const updatedRemindMethod = updatedTask.remind_method;
    const updatedContact = updatedTask.target_contact || "";
    const updatedDays = updatedTask.reminder_days ?? 1;
    const updatedDeadlineIso = updatedTask.deadline
      ? new Date(updatedTask.deadline).toISOString()
      : "";

    const reminderSettingsChanged =
      currentTaskReminderActive !== !!updatedRemindMethod ||
      (!!updatedRemindMethod &&
        (existingTask.remind_method !== updatedRemindMethod ||
          currentTaskContact !== updatedContact ||
          currentTaskDays !== updatedDays ||
          currentTaskDeadlineIso !== updatedDeadlineIso));

    if (reminderSettingsChanged) {
      // First, cancel the old reminder if it exists
      if (oldTriggerHandleId) {
        const cancelSuccess = await cancelTriggerHandle(oldTriggerHandleId);
        if (!cancelSuccess) {
          console.warn(
            `Failed to cancel old reminder ${oldTriggerHandleId} for task ${taskId}.`
          );
          reminderProcessedMessage += "Old reminder could not be cancelled. ";
        } else {
          reminderProcessedMessage += "Old reminder cancelled. ";
        }
      }

      // If reminder is active in the new state (after update), schedule a new one
      if (
        updatedTask.remind_method &&
        updatedTask.reminder_days !== null &&
        userDetailsForScheduling
      ) {
        try {
          // FIXED: Better firstName extraction logic
          let firstName = "User"; // Default fallback

          if (
            userDetailsForScheduling.name &&
            userDetailsForScheduling.name.trim()
          ) {
            // If we have a name in the database, use it
            firstName = userDetailsForScheduling.name.trim().split(" ")[0];
          } else if (userDetailsForScheduling.email) {
            // Only fall back to email if no name exists in database
            firstName = userDetailsForScheduling.email.split("@")[0];
          }

          console.log(
            `Using firstName: "${firstName}" for user ${user.id}, from name: "${userDetailsForScheduling.name}"`
          );

          // Re-derive recipient details from updatedTask's stored values
          let currentRecipientEmail: string | undefined;
          let currentRecipientPhone: string | undefined;

          if (updatedTask.remind_method === "email") {
            currentRecipientEmail =
              updatedTask.target_contact || userDetailsForScheduling.email;
          } else if (updatedTask.remind_method === "whatsapp") {
            currentRecipientPhone =
              updatedTask.target_contact ||
              userDetailsForScheduling.phone_number;
            if (currentRecipientPhone && currentRecipientPhone.startsWith("0"))
              currentRecipientPhone = "62" + currentRecipientPhone.substring(1);
            else if (
              currentRecipientPhone &&
              !currentRecipientPhone.startsWith("62") &&
              currentRecipientPhone.length < 15
            )
              currentRecipientPhone = "62" + currentRecipientPhone;
          } else if (updatedTask.remind_method === "both") {
            const [em = "", ph = ""] = (updatedTask.target_contact || "").split(
              "|"
            );
            currentRecipientEmail = em || userDetailsForScheduling.email;
            currentRecipientPhone = ph || userDetailsForScheduling.phone_number;
            if (currentRecipientPhone && currentRecipientPhone.startsWith("0"))
              currentRecipientPhone = "62" + currentRecipientPhone.substring(1);
            else if (
              currentRecipientPhone &&
              !currentRecipientPhone.startsWith("62") &&
              currentRecipientPhone.length < 15
            )
              currentRecipientPhone = "62" + currentRecipientPhone;
          }

          const newDeadlineDate = new Date(updatedTask.deadline);
          const newReminderDate = new Date(
            newDeadlineDate.getTime() -
              updatedTask.reminder_days * 24 * 60 * 60 * 1000
          );

          if (newReminderDate.getTime() <= new Date().getTime()) {
            reminderProcessedMessage +=
              "New reminder cannot be scheduled (time has already passed). ";
          } else if (!currentRecipientEmail && !currentRecipientPhone) {
            reminderProcessedMessage +=
              "New reminder cannot be scheduled (no valid contact). ";
          } else {
            const handle = await scheduleTaskReminder({
              id: updatedTask.id,
              title: updatedTask.title,
              description: updatedTask.description,
              deadline: updatedTask.deadline,
              reminderDays: updatedTask.reminder_days,
              recipientEmail: currentRecipientEmail || "",
              recipientPhone: currentRecipientPhone,
              firstName: firstName,
            });
            newTriggerHandleId = handle.id;
            reminderProcessedMessage += "New reminder scheduled successfully. ";
          }
        } catch (scheduleError) {
          console.error(
            "Error scheduling new reminder during task update:",
            scheduleError
          );
          reminderProcessedMessage += "Failed to schedule new reminder. ";
        }
      } else if (showReminder === false) {
        reminderProcessedMessage += "Reminder turned off. ";
      } else if (!userDetailsForScheduling) {
        console.error(
          "User details missing for reminder scheduling in update API."
        );
        reminderProcessedMessage +=
          "Failed to schedule reminder (user details missing). ";
      }

      // Update trigger_handle_id
      const { error: updateTriggerHandleError } = await supabaseAdmin
        .from("tasks")
        .update({ trigger_handle_id: newTriggerHandleId })
        .eq("id", updatedTask.id);

      if (updateTriggerHandleError) {
        console.error(
          `Failed to update trigger_handle_id for task ${updatedTask.id} after reminder handling:`,
          updateTriggerHandleError
        );
      }
    } else {
      reminderProcessedMessage = "Reminder settings unchanged. ";
    }

    return NextResponse.json(
      {
        success: true,
        message: `Task updated successfully. ${reminderProcessedMessage.trim()}`,
        task: updatedTask,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Unhandled error in update task API:", error);
    return NextResponse.json(
      { error: "An unexpected server error occurred.", details: error.message },
      { status: 500 }
    );
  }
}
