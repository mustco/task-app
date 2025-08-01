// app/api/tasks/update/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import validator from "validator";
import { ratelimit } from "@/lib/upstash-ratelimit";
import { updateReminderJob } from "@/src/trigger/updateScheduler"; // Import background job

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

export async function POST(request: NextRequest) {
  try {
    // ✅ STEP 1: Authentication
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ✅ STEP 2: Parallel rate limiting and body parsing
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

    // ✅ STEP 3: Validation
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

    // ✅ STEP 4: Fetch existing task
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

    // ✅ STEP 5: Authorization check
    if (existingTask.user_id !== user.id) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to update this task." },
        { status: 403 }
      );
    }

    // ✅ STEP 6: Prepare database update (core fields only)
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

    // ✅ STEP 7: Database update (fast operation)
    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update(updatesToDB)
      .eq("id", taskId)
      .eq("user_id", user.id)
      .select()
      .single();

    if (updateError) {
      console.error("Supabase update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update task in database. Please try again later." },
        { status: 500 }
      );
    }

    // ✅ STEP 8: Trigger background job for reminder management (fire-and-forget)
    const needsReminderProcessing =
      showReminder === true ||
      existingTask.remind_method ||
      updatedTask.remind_method;

    if (needsReminderProcessing) {
      try {
        console.log(
          `🚀 Triggering background reminder update for task ${taskId}`
        );

        // Get user details first (this is fast, usually cached)
        const { data: userProfile } = await supabase
          .from("users")
          .select("name, email, phone_number")
          .eq("id", user.id)
          .single();

        const userDetails = userProfile || {
          name: user.user_metadata?.full_name || null,
          email: user.email,
          phone_number: user.user_metadata?.phone_number || null,
        };

        // Fire-and-forget background job
        updateReminderJob
          .trigger({
            taskId: taskId,
            existingTask: {
              id: existingTask.id,
              title: existingTask.title,
              description: existingTask.description,
              deadline: existingTask.deadline,
              reminder_days: existingTask.reminder_days,
              remind_method: existingTask.remind_method,
              target_contact: existingTask.target_contact,
              trigger_handle_id: existingTask.trigger_handle_id,
            },
            updatedTask: {
              id: updatedTask.id,
              title: updatedTask.title,
              description: updatedTask.description,
              deadline: updatedTask.deadline!,
              reminder_days: updatedTask.reminder_days,
              remind_method: updatedTask.remind_method,
              target_contact: updatedTask.target_contact,
            },
            userDetails: userDetails,
          })
          .catch((error) => {
            // Log error but don't fail response
            console.error(
              `❌ Failed to trigger background reminder update for task ${taskId}:`,
              error
            );
          });

        console.log(
          `✅ Background reminder update job triggered for task ${taskId}`
        );
      } catch (error) {
        // Log error but don't fail response
        console.error(
          `❌ Error triggering background reminder update for task ${taskId}:`,
          error
        );
      }
    }

    // ✅ STEP 9: Return response immediately (ultra fast)
    return NextResponse.json(
      {
        success: true,
        message: needsReminderProcessing
          ? "Task updated successfully! Reminder changes are being processed in the background."
          : "Task updated successfully!",
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
