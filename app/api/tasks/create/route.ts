// app/api/tasks/create/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server"; // Server-side Supabase client (for user context with RLS)
import { supabaseAdmin } from "@/lib/supabase/admin"; // Supabase Admin client (for internal system updates like trigger_handle_id)
import { z } from "zod"; // For validation
import validator from "validator"; // For email/phone validation
import { scheduleTaskReminder } from "@/src/trigger/task";
import type { User, Task, ErrorLog } from "@/lib/types";
import { ratelimit } from "@/lib/upstash-ratelimit";

// --- Server-side Zod Schema for Task Creation ---
// This schema should mirror the client-side validation but is the definitive source of truth
// for what data is acceptable for task creation on the server.
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
      // Ensure deadline is a valid date and in the future
      return !isNaN(date.getTime()) && date > new Date();
    }, "Deadline must be a valid future date and time."),
    showReminder: z.boolean(),
    remindMethod: z.enum(["email", "whatsapp", "both"]).optional(), // Optional if showReminder is false
    targetContact: z.string().optional(), // Used for single email/whatsapp
    emailContact: z.string().email("Invalid email format.").optional(), // Used for 'both' method
    whatsappContact: z.string().optional(), // Used for 'both' method
    reminderDays: z
      .number()
      .min(0, "Reminder days cannot be negative.")
      .max(365, "Reminder days cannot exceed 365 days.") // Match UI/business logic limits
      .optional(),
  })
  .superRefine((data, ctx) => {
    // Conditional validation for reminder fields if showReminder is true
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
        // Basic phone number validation (allowing optional '+' prefix, then 8-15 digits)
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

// --- Main POST handler for task creation ---
export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate User (Server-side)
    // This uses the client created with cookies, which ensures session validity.
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("Authentication error in create task API:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Rate Limiting (Placeholder)
    // Implement actual rate limiting here, e.g., using Upstash Ratelimit or a custom solution.
    // Example:
    // const { success: rateLimitPassed } = await ratelimit.limit(user.id);
    // if (!rateLimitPassed) {
    //   console.warn(`Rate limit exceeded for user: ${user.id}`);
    //   return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    // }
    // --- RATE LIMITING IMPLEMENTATION ---
    // Gunakan user.id sebagai identifier unik untuk rate limit per pengguna.
    // Jika user.id tidak ada (misal, sesi guest), bisa gunakan IP address.
    const identifier = user.id || request.ip || "anonymous"; // Fallback to IP or anonymous

    const {
      success: rateLimitPassed,
      pending,
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
          reset: reset, // Waktu reset dalam detik
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
    // --- END RATE LIMITING ---

    // 3. Server-side Input Validation with Zod
    const body = await request.json();
    const parsed = ServerTaskCreateSchema.safeParse(body);

    if (!parsed.success) {
      console.error("Server-side validation failed:", parsed.error.flatten()); // Log flattened errors for clarity
      return NextResponse.json(
        {
          error: "Invalid input data",
          // Return flattened field errors to the client for better feedback
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    // Destructure validated data
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

    // 4. Prepare Task Payload for Database Insertion
    // `user_id` is derived securely from the authenticated session on the server, not from client input.
    type TaskInsertPayload = {
      user_id: string;
      title: string;
      description: string | null;
      deadline: string;
      status: "pending" | "in_progress" | "completed" | "overdue"; // Status is set by server
      remind_method: "email" | "whatsapp" | "both" | null;
      target_contact: string | null;
      reminder_days: number | null;
      // Add trigger_handle_id here if you want to initially set it to null
      // trigger_handle_id?: string | null;
    };

    const taskToInsert: TaskInsertPayload = {
      user_id: user.id,
      title: title,
      description: description || null, // Ensure empty string becomes null
      deadline: new Date(deadline).toISOString(), // Convert to ISO string for DB
      status: "pending", // Default status for new tasks
      remind_method: null,
      target_contact: null,
      reminder_days: null,
    };

    // Prepare reminder-specific fields if reminder is enabled
    let recipientEmailForReminder: string | undefined;
    let recipientPhoneForReminder: string | undefined;
    let finalTargetContactForDB: string | null = null; // To store in DB

    if (showReminder) {
      taskToInsert.remind_method = remindMethod!; // Assert non-null after validation
      taskToInsert.reminder_days = reminderDays!; // Assert non-null after validation

      if (remindMethod === "email") {
        recipientEmailForReminder = targetContact!;
        finalTargetContactForDB = targetContact!;
      } else if (remindMethod === "whatsapp") {
        // Normalize WhatsApp number for consistency (e.g., convert 08xx to 628xx)
        let normalizedPhone = targetContact!;
        if (normalizedPhone.startsWith("0")) {
          normalizedPhone = "62" + normalizedPhone.substring(1);
        } else if (
          !normalizedPhone.startsWith("62") &&
          normalizedPhone.length < 15
        ) {
          // Fallback normalization if it doesn't start with 62 but might be local
          console.warn(
            `Phone number ${normalizedPhone} does not start with 62. Assuming local and prepending 62 for reminder.`
          );
          normalizedPhone = "62" + normalizedPhone;
        }
        recipientPhoneForReminder = normalizedPhone;
        finalTargetContactForDB = normalizedPhone; // Store normalized phone in DB
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
        finalTargetContactForDB = `${recipientEmailForReminder}|${recipientPhoneForReminder}`; // Store combined and normalized
      }
      taskToInsert.target_contact = finalTargetContactForDB;
    }

    // 5. Insert Task into Supabase
    // This uses the server-side client which respects RLS.
    // Ensure your RLS policy allows users to INSERT tasks where user_id matches auth.uid().
    const { data: newTask, error: supabaseError } = await supabase
      .from("tasks")
      .insert(taskToInsert)
      .select()
      .single();

    if (supabaseError) {
      console.error("Supabase insert error:", supabaseError);
      // Return a generic error to the client, details logged internally
      return NextResponse.json(
        { error: "Failed to create task in database. Please try again later." },
        { status: 500 }
      );
    }

    // 6. Schedule Reminder (if applicable) Directly within this API
    // This eliminates the need for an internal fetch call and its associated authentication issues.
    if (showReminder) {
      try {
        const firstName =
          (user as any).name?.split(" ")[0] ||
          user?.email?.split("@")[0] ||
          "User";

        const handle = await scheduleTaskReminder({
          id: newTask.id, // Use the ID of the newly created task
          title: newTask.title,
          description: newTask.description,
          deadline: newTask.deadline,
          reminderDays: newTask.reminder_days!,
          recipientEmail: recipientEmailForReminder || "", // Ensure string, even if undefined
          recipientPhone: recipientPhoneForReminder, // Can be undefined, scheduleTaskReminder handles it
          firstName: firstName,
        });

        // Update the task in Supabase with the trigger_handle_id
        // Use supabaseAdmin here as this is an internal system update,
        // which might bypass RLS for this specific column.
        const { error: updateTriggerHandleError } = await supabaseAdmin
          .from("tasks")
          .update({ trigger_handle_id: handle.id })
          .eq("id", newTask.id);

        if (updateTriggerHandleError) {
          console.error(
            `Failed to save trigger_handle_id for task ${newTask.id}:`,
            updateTriggerHandleError
          );
          // Log the error, but don't fail the main response as the task is created and reminder is likely scheduled.
        }
      } catch (scheduleError) {
        console.error(
          "Error scheduling reminder during task creation:",
          scheduleError
        );
        // Log this error. You might consider sending a warning to the client or an admin notification.
      }
    }

    // 7. Return Success Response
    return NextResponse.json(
      {
        success: true,
        message: "Task created successfully",
        task: newTask, // Return the newly created task object
      },
      { status: 201 } // 201 Created status
    );
  } catch (error: any) {
    console.error("Unhandled error in create task API:", error);
    // Return a generic 500 error for unhandled exceptions
    return NextResponse.json(
      { error: "An unexpected server error occurred.", details: error.message },
      { status: 500 }
    );
  }
}
