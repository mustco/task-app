// app/api/tasks/create/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { z } from "zod";
import validator from "validator";
import { scheduleTaskReminder } from "@/src/trigger/task";
import type { User, Task, ErrorLog } from "@/lib/types";
import { ratelimit } from "@/lib/upstash-ratelimit";

// Server-side Zod Schema (unchanged)
const ServerTaskCreateSchema = z
  .object({
    title: z
      .string()
      .min(1, "Title is required.")
      .max(255, "Title is too long."),
    description: z
      .string()
      .max(1000, "Description is too long.")
      .nullable()
      .optional(),
    deadline: z.string().refine((val) => {
      const date = new Date(val);
      return !isNaN(date.getTime()) && date > new Date();
    }, "Deadline must be a valid future date and time."),
    showReminder: z.boolean(),
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
    if (data.showReminder) {
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

// ✅ OPTIMIZATION 1: Async reminder scheduling function
async function scheduleReminderAsync(
  newTask: Task,
  user: any,
  reminderData: {
    recipientEmailForReminder?: string;
    recipientPhoneForReminder?: string;
  }
) {
  try {
    const firstName =
      (user as any).name?.split(" ")[0] || user?.email?.split("@")[0] || "User";

    const handle = await scheduleTaskReminder({
      id: newTask.id,
      title: newTask.title,
      description: newTask.description ?? "",
      deadline: newTask.deadline ?? "",
      reminderDays: newTask.reminder_days!,
      recipientEmail: reminderData.recipientEmailForReminder || "",
      recipientPhone: reminderData.recipientPhoneForReminder,
      firstName: firstName,
    });

    // Update trigger_handle_id asynchronously
    await supabaseAdmin
      .from("tasks")
      .update({ trigger_handle_id: handle.id })
      .eq("id", newTask.id);

    console.log(`✅ Reminder scheduled for task ${newTask.id}`);
  } catch (error) {
    console.error(
      `❌ Failed to schedule reminder for task ${newTask.id}:`,
      error
    );
    // Optionally log to error tracking service
  }
}

export async function POST(request: NextRequest) {
  try {
    // ✅ OPTIMIZATION 2: Early authentication check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ✅ OPTIMIZATION 3: Parallel rate limiting & body parsing
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

    // ✅ OPTIMIZATION 4: Fast validation
    const parsed = ServerTaskCreateSchema.safeParse(body);
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
      title,
      description,
      deadline,
      showReminder,
      remindMethod,
      targetContact,
      emailContact,
      whatsappContact,
      reminderDays,
    } = parsed.data;

    // ✅ OPTIMIZATION 5: Prepare data efficiently
    const taskToInsert = {
      user_id: user.id,
      title: title,
      description: description || null,
      deadline: new Date(deadline).toISOString(),
      status: "pending" as const,
      remind_method: null as any,
      target_contact: null as string | null,
      reminder_days: null as number | null,
    };

    let reminderData: {
      recipientEmailForReminder?: string;
      recipientPhoneForReminder?: string;
    } = {};

    if (showReminder) {
      taskToInsert.remind_method = remindMethod!;
      taskToInsert.reminder_days = reminderDays!;

      if (remindMethod === "email") {
        reminderData.recipientEmailForReminder = targetContact!;
        taskToInsert.target_contact = targetContact!;
      } else if (remindMethod === "whatsapp") {
        let normalizedPhone = targetContact!;
        if (normalizedPhone.startsWith("0")) {
          normalizedPhone = "62" + normalizedPhone.substring(1);
        } else if (
          !normalizedPhone.startsWith("62") &&
          normalizedPhone.length < 15
        ) {
          normalizedPhone = "62" + normalizedPhone;
        }
        reminderData.recipientPhoneForReminder = normalizedPhone;
        taskToInsert.target_contact = normalizedPhone;
      } else if (remindMethod === "both") {
        reminderData.recipientEmailForReminder = emailContact!;
        let normalizedWhatsapp = whatsappContact!;
        if (normalizedWhatsapp.startsWith("0")) {
          normalizedWhatsapp = "62" + normalizedWhatsapp.substring(1);
        } else if (
          !normalizedWhatsapp.startsWith("62") &&
          normalizedWhatsapp.length < 15
        ) {
          normalizedWhatsapp = "62" + normalizedWhatsapp;
        }
        reminderData.recipientPhoneForReminder = normalizedWhatsapp;
        taskToInsert.target_contact = `${reminderData.recipientEmailForReminder}|${reminderData.recipientPhoneForReminder}`;
      }
    }

    // ✅ OPTIMIZATION 6: Database insert
    const { data: newTask, error: supabaseError } = await supabase
      .from("tasks")
      .insert(taskToInsert)
      .select()
      .single();

    if (supabaseError) {
      console.error("Supabase insert error:", supabaseError);
      return NextResponse.json(
        { error: "Failed to create task in database. Please try again later." },
        { status: 500 }
      );
    }

    // ✅ OPTIMIZATION 7: Schedule reminder asynchronously (fire-and-forget)
    if (showReminder) {
      // Don't await this - let it run in background
      scheduleReminderAsync(newTask, user, reminderData);
    }

    // ✅ OPTIMIZATION 8: Return response immediately
    return NextResponse.json(
      {
        success: true,
        message: "Task created successfully",
        task: newTask,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Unhandled error in create task API:", error);
    return NextResponse.json(
      { error: "An unexpected server error occurred.", details: error.message },
      { status: 500 }
    );
  }
}
