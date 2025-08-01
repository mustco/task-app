// app/api/tasks/update/route.ts - OPTIMIZED VERSION

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { z } from "zod";
import validator from "validator";
import { ratelimit } from "@/lib/upstash-ratelimit";
import { scheduleTaskReminder } from "@/src/trigger/task";

// ✅ OPTIMIZATION 1: Async reminder management function
async function handleReminderChangesAsync(
  existingTask: any,
  updatedTask: any,
  user: any,
  userDetailsForScheduling: any
) {
  try {
    const oldTriggerHandleId = existingTask.trigger_handle_id || null;
    let newTriggerHandleId: string | null = null;
    let reminderProcessedMessage = "";

    // Determine if reminder settings have functionally changed
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
      // ✅ OPTIMIZATION 2: Parallel operations for cancel and schedule
      const operations: Promise<any>[] = [];

      // Cancel old reminder if exists
      if (oldTriggerHandleId) {
        operations.push(
          cancelTriggerHandleWithTimeout(oldTriggerHandleId).then(
            (success) => ({
              type: "cancel",
              success,
              handleId: oldTriggerHandleId,
            })
          )
        );
      }

      // If reminder is active in new state, prepare scheduling
      if (
        updatedTask.remind_method &&
        updatedTask.reminder_days !== null &&
        userDetailsForScheduling
      ) {
        // Prepare scheduling data
        const schedulingData = prepareSchedulingData(
          updatedTask,
          userDetailsForScheduling
        );

        if (schedulingData.canSchedule) {
          operations.push(
            scheduleTaskReminder(schedulingData.payload)
              .then((handle) => ({
                type: "schedule",
                success: true,
                handleId: handle.id,
                handle,
              }))
              .catch((error) => ({
                type: "schedule",
                success: false,
                error: error.message,
              }))
          );
        }
      }

      // ✅ OPTIMIZATION 3: Execute operations in parallel
      const results = await Promise.allSettled(operations);

      // Process results
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          const operation = result.value;
          if (operation.type === "cancel") {
            if (operation.success) {
              reminderProcessedMessage += "Old reminder cancelled. ";
              console.log(`✅ Cancelled old reminder ${operation.handleId}`);
            } else {
              reminderProcessedMessage +=
                "Old reminder could not be cancelled. ";
              console.warn(
                `❌ Failed to cancel old reminder ${operation.handleId}`
              );
            }
          } else if (operation.type === "schedule") {
            if (operation.success) {
              newTriggerHandleId = operation.handleId;
              reminderProcessedMessage +=
                "New reminder scheduled successfully. ";
              console.log(`✅ Scheduled new reminder ${operation.handleId}`);
            } else {
              reminderProcessedMessage += "Failed to schedule new reminder. ";
              console.error(
                `❌ Failed to schedule reminder: ${operation.error}`
              );
            }
          }
        } else {
          console.error(`❌ Operation ${index} failed:`, result.reason);
        }
      });

      // ✅ OPTIMIZATION 4: Update trigger_handle_id asynchronously
      if (newTriggerHandleId !== oldTriggerHandleId) {
        supabaseAdmin
          .from("tasks")
          .update({ trigger_handle_id: newTriggerHandleId })
          .eq("id", updatedTask.id)
          .then(({ error }) => {
            if (error) {
              console.error(
                `❌ Failed to update trigger_handle_id for task ${updatedTask.id}:`,
                error
              );
            } else {
              console.log(
                `✅ Updated trigger_handle_id for task ${updatedTask.id}`
              );
            }
          });
      }
    } else {
      reminderProcessedMessage = "Reminder settings unchanged. ";
      console.log(`ℹ️ No reminder changes needed for task ${updatedTask.id}`);
    }

    console.log(
      `📊 Reminder processing completed for task ${updatedTask.id}: ${reminderProcessedMessage.trim()}`
    );
  } catch (error) {
    console.error(
      `❌ Error in async reminder handling for task ${updatedTask.id}:`,
      error
    );
  }
}

// ✅ OPTIMIZATION 5: Improved cancel function with timeout
async function cancelTriggerHandleWithTimeout(
  handleId: string
): Promise<boolean> {
  const url = `${process.env.TRIGGER_API_URL}/api/v2/runs/${handleId}/cancel`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

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
      return true;
    } else {
      console.warn(
        `Cancel API returned ${response.status}: ${await response.text()}`
      );
      return false;
    }
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error(`Timeout cancelling trigger ${handleId}`);
    } else {
      console.error(`Error cancelling trigger ${handleId}:`, error.message);
    }
    return false;
  }
}

// ✅ OPTIMIZATION 6: Prepare scheduling data efficiently
function prepareSchedulingData(
  updatedTask: any,
  userDetailsForScheduling: any
) {
  // Better firstName extraction logic
  let firstName = "User";
  if (userDetailsForScheduling.name && userDetailsForScheduling.name.trim()) {
    firstName = userDetailsForScheduling.name.trim().split(" ")[0];
  } else if (userDetailsForScheduling.email) {
    firstName = userDetailsForScheduling.email.split("@")[0];
  }

  // Re-derive recipient details from updatedTask's stored values
  let currentRecipientEmail: string | undefined;
  let currentRecipientPhone: string | undefined;

  if (updatedTask.remind_method === "email") {
    currentRecipientEmail =
      updatedTask.target_contact || userDetailsForScheduling.email;
  } else if (updatedTask.remind_method === "whatsapp") {
    currentRecipientPhone =
      updatedTask.target_contact || userDetailsForScheduling.phone_number;
    if (currentRecipientPhone && currentRecipientPhone.startsWith("0")) {
      currentRecipientPhone = "62" + currentRecipientPhone.substring(1);
    } else if (
      currentRecipientPhone &&
      !currentRecipientPhone.startsWith("62") &&
      currentRecipientPhone.length < 15
    ) {
      currentRecipientPhone = "62" + currentRecipientPhone;
    }
  } else if (updatedTask.remind_method === "both") {
    const [em = "", ph = ""] = (updatedTask.target_contact || "").split("|");
    currentRecipientEmail = em || userDetailsForScheduling.email;
    currentRecipientPhone = ph || userDetailsForScheduling.phone_number;
    if (currentRecipientPhone && currentRecipientPhone.startsWith("0")) {
      currentRecipientPhone = "62" + currentRecipientPhone.substring(1);
    } else if (
      currentRecipientPhone &&
      !currentRecipientPhone.startsWith("62") &&
      currentRecipientPhone.length < 15
    ) {
      currentRecipientPhone = "62" + currentRecipientPhone;
    }
  }

  const newDeadlineDate = new Date(updatedTask.deadline);
  const newReminderDate = new Date(
    newDeadlineDate.getTime() - updatedTask.reminder_days * 24 * 60 * 60 * 1000
  );

  const canSchedule =
    newReminderDate.getTime() > new Date().getTime() &&
    (currentRecipientEmail || currentRecipientPhone);

  return {
    canSchedule,
    payload: {
      id: updatedTask.id,
      title: updatedTask.title,
      description: updatedTask.description,
      deadline: updatedTask.deadline,
      reminderDays: updatedTask.reminder_days,
      recipientEmail: currentRecipientEmail || "",
      recipientPhone: currentRecipientPhone,
      firstName: firstName,
    },
  };
}

// Server-side Zod Schema (unchanged)
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

// ✅ OPTIMIZATION 7: Main POST handler with early return
export async function POST(request: NextRequest) {
  try {
    // 1. Authentication
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parallel rate limiting and body parsing
    const [rateLimitResult, body] = await Promise.all([
      ratelimit.limit(user.id || request.ip || "anonymous"),
      request.json(),
    ]);

    const {
      success: rateLimitPassed,
      limit,
      remaining,
      reset,
    } = rateLimitResult;

    if (!rateLimitPassed) {
      return NextResponse.json(
        {
          error: "Too many requests. Please try again later.",
          limit,
          remaining,
          reset,
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

    // 3. Validation
    const parsed = ServerTaskUpdateSchema.safeParse(body);
    if (!parsed.success) {
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

    // 4. Fetch existing task
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
      return NextResponse.json(
        { error: "Task not found or you do not have permission to access it." },
        { status: 404 }
      );
    }

    // 5. Authorization check
    if (existingTask.user_id !== user.id) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to update this task." },
        { status: 403 }
      );
    }

    // 6. Prepare database update
    type TaskUpdateDBPayload = {
      title?: string;
      description?: string | null;
      deadline?: string;
      status?: "pending" | "in_progress" | "completed" | "overdue";
      remind_method?: "email" | "whatsapp" | "both" | null;
      target_contact?: string | null;
      reminder_days?: number | null;
    };

    const updatesToDB: Partial<TaskUpdateDBPayload> = { ...coreTaskUpdates };

    // Process reminder fields for database
    if (showReminder === true) {
      updatesToDB.remind_method = remindMethod!;
      updatesToDB.reminder_days = reminderDays!;

      if (remindMethod === "email") {
        updatesToDB.target_contact = targetContact!;
      } else if (remindMethod === "whatsapp") {
        let normalizedPhone = targetContact!;
        if (normalizedPhone.startsWith("0"))
          normalizedPhone = "62" + normalizedPhone.substring(1);
        else if (
          !normalizedPhone.startsWith("62") &&
          normalizedPhone.length < 15
        )
          normalizedPhone = "62" + normalizedPhone;
        updatesToDB.target_contact = normalizedPhone;
      } else if (remindMethod === "both") {
        let normalizedWhatsapp = whatsappContact!;
        if (normalizedWhatsapp.startsWith("0"))
          normalizedWhatsapp = "62" + normalizedWhatsapp.substring(1);
        else if (
          !normalizedWhatsapp.startsWith("62") &&
          normalizedWhatsapp.length < 15
        )
          normalizedWhatsapp = "62" + normalizedWhatsapp;
        updatesToDB.target_contact = `${emailContact!}|${normalizedWhatsapp}`;
      }
    } else {
      updatesToDB.remind_method = null;
      updatesToDB.target_contact = null;
      updatesToDB.reminder_days = null;
    }

    // 7. Database update
    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update(updatesToDB)
      .eq("id", taskId)
      .eq("user_id", user.id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update task in database. Please try again later." },
        { status: 500 }
      );
    }

    // ✅ OPTIMIZATION 8: Get user details and handle reminders asynchronously
    if (showReminder === true || existingTask.remind_method) {
      // Fire-and-forget async reminder handling
      (async () => {
        try {
          // Get user details for scheduling
          const { data: userProfile } = await supabase
            .from("users")
            .select("name, email, phone_number")
            .eq("id", user.id)
            .single();

          const userDetailsForScheduling = userProfile || {
            name: user.user_metadata?.full_name || null,
            email: user.email,
            phone_number: user.user_metadata?.phone_number || null,
          };

          await handleReminderChangesAsync(
            existingTask,
            updatedTask,
            user,
            userDetailsForScheduling
          );
        } catch (error) {
          console.error(
            `❌ Background reminder processing failed for task ${taskId}:`,
            error
          );
        }
      })();
    }

    // ✅ OPTIMIZATION 9: Return response immediately
    return NextResponse.json(
      {
        success: true,
        message:
          "Task updated successfully. Reminder changes will be processed shortly.",
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
