// app/api/tasks/create/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { z } from "zod";
import validator from "validator";
import { scheduleTaskReminder } from "@/src/trigger/task";
import type { User, Task, ErrorLog } from "@/lib/types";
import { ratelimit } from "@/lib/upstash-ratelimit";

// --- Server-side Zod Schema for Task Creation ---
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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("Authentication error in create task API:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const identifier = user.id || request.ip || "anonymous";

    const {
      success: rateLimitPassed,
      pending, // Added pending as it's part of the RatelimitResult, though not directly used here
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

    const body = await request.json();
    const parsed = ServerTaskCreateSchema.safeParse(body);

    if (!parsed.success) {
      console.error("Server-side validation failed:", parsed.error.flatten());
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

    type TaskInsertPayload = {
      user_id: string;
      title: string;
      description: string | null;
      deadline: string;
      status: "pending" | "in_progress" | "completed" | "overdue";
      remind_method: "email" | "whatsapp" | "both" | null;
      target_contact: string | null;
      reminder_days: number | null;
      trigger_handle_id?: string | null; // Optional, will be set asynchronously
    };

    const taskToInsert: TaskInsertPayload = {
      user_id: user.id,
      title: title,
      description: description || null,
      deadline: new Date(deadline).toISOString(),
      status: "pending",
      remind_method: null,
      target_contact: null,
      reminder_days: null,
    };

    let recipientEmailForReminder: string | undefined;
    let recipientPhoneForReminder: string | undefined;
    let finalTargetContactForDB: string | null = null;

    if (showReminder) {
      taskToInsert.remind_method = remindMethod!;
      taskToInsert.reminder_days = reminderDays!;

      if (remindMethod === "email") {
        recipientEmailForReminder = targetContact!;
        finalTargetContactForDB = targetContact!;
      } else if (remindMethod === "whatsapp") {
        let normalizedPhone = targetContact!;
        if (normalizedPhone.startsWith("0")) {
          normalizedPhone = "62" + normalizedPhone.substring(1);
        } else if (
          !normalizedPhone.startsWith("62") &&
          normalizedPhone.length < 15
        ) {
          console.warn(
            `Phone number ${normalizedPhone} does not start with 62. Assuming local and prepending 62 for reminder.`
          );
          normalizedPhone = "62" + normalizedPhone;
        }
        recipientPhoneForReminder = normalizedPhone;
        finalTargetContactForDB = normalizedPhone;
      } else if (remindMethod === "both") {
        recipientEmailForReminder = emailContact!;
        let normalizedWhatsapp = whatsappContact!;
        if (normalizedWhatsapp.startsWith("0")) {
          normalizedWhatsapp = "62" + normalizedWhatsapp.substring(1);
        } else if (
          !normalizedWhatsapp.startsWith("62") &&
          normalizedWhatsapp.length < 15
        ) {
          console.warn(
            `Phone number ${normalizedWhatsapp} does not start with 62. Assuming local and prepending 62 for reminder.`
          );
          normalizedWhatsapp = "62" + normalizedWhatsapp;
        }
        recipientPhoneForReminder = normalizedWhatsapp;
        finalTargetContactForDB = `${recipientEmailForReminder}|${recipientPhoneForReminder}`;
      }
      taskToInsert.target_contact = finalTargetContactForDB;
    }

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

    // Schedule Reminder ASYNCHRONOUSLY without awaiting
    if (showReminder) {
      const firstName =
        (user as any).name?.split(" ")[0] ||
        user?.email?.split("@")[0] ||
        "User";

      // IMPORTANT: Do NOT await scheduleTaskReminder here.
      // This allows the API response to return immediately.
      scheduleTaskReminder({
        id: newTask.id,
        title: newTask.title,
        description: newTask.description,
        deadline: newTask.deadline,
        reminderDays: newTask.reminder_days!,
        recipientEmail: recipientEmailForReminder || "",
        recipientPhone: recipientPhoneForReminder,
        firstName: firstName,
      })
        .then(async (handle) => {
          // This code runs in the background after the API has responded.
          // Use supabaseAdmin to update the task with the trigger_handle_id.
          const { error: updateTriggerHandleError } = await supabaseAdmin
            .from("tasks")
            .update({ trigger_handle_id: handle.id })
            .eq("id", newTask.id);

          if (updateTriggerHandleError) {
            console.error(
              `Failed to save trigger_handle_id for task ${newTask.id}:`,
              updateTriggerHandleError
            );
          }
        })
        .catch((scheduleError) => {
          console.error(
            `Error scheduling reminder for task ${newTask.id} (async):`,
            scheduleError
          );
          // You might log this to an error tracking service like Sentry or Datadog
        });
    }

    // Return success response immediately after database insert.
    return NextResponse.json(
      {
        success: true,
        message: "Note created successfully.",
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
