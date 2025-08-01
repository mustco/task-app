// app/api/tasks/create/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import validator from "validator";

// Schema validasi untuk create task
const CreateTaskSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(255, "Title too long"),
    description: z
      .string()
      .max(1000, "Description too long")
      .nullable()
      .optional(),
    deadline: z.string().refine((val) => {
      const date = new Date(val);
      return !isNaN(date.getTime()) && date > new Date();
    }, "Deadline must be a valid future date"),
    remind_method: z.enum(["email", "whatsapp", "both"]).nullable().optional(),
    target_contact: z.string().nullable().optional(),
    reminder_days: z.number().min(0).max(365).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // Validasi reminder fields jika remind_method ada
    if (data.remind_method) {
      if (data.reminder_days === null || data.reminder_days === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reminder days required when reminder method is set",
          path: ["reminder_days"],
        });
      }

      if (!data.target_contact) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Target contact required when reminder method is set",
          path: ["target_contact"],
        });
      } else {
        // Validasi format target_contact berdasarkan method
        if (data.remind_method === "email") {
          if (!validator.isEmail(data.target_contact)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Invalid email format",
              path: ["target_contact"],
            });
          }
        } else if (data.remind_method === "whatsapp") {
          if (!/^\+?\d{8,15}$/.test(data.target_contact)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Invalid phone number format",
              path: ["target_contact"],
            });
          }
        } else if (data.remind_method === "both") {
          const parts = data.target_contact.split("|");
          if (parts.length !== 2) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Both method requires email|phone format",
              path: ["target_contact"],
            });
          } else {
            const [email, phone] = parts.map((p) => p.trim());
            if (!validator.isEmail(email)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Invalid email in both format",
                path: ["target_contact"],
              });
            }
            if (!/^\+?\d{8,15}$/.test(phone)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Invalid phone in both format",
                path: ["target_contact"],
              });
            }
          }
        }
      }
    }
  });

export async function POST(request: NextRequest) {
  try {
    // 1. Parse dan validasi input
    const body = await request.json();
    const validationResult = CreateTaskSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const validatedData = validationResult.data;

    // 2. Autentikasi user
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 3. Prepare task payload
    const taskPayload = {
      user_id: user.id,
      title: validatedData.title,
      description: validatedData.description || null,
      deadline: new Date(validatedData.deadline).toISOString(),
      status: "pending" as const,
      remind_method: validatedData.remind_method || null,
      target_contact: validatedData.target_contact || null,
      reminder_days: validatedData.reminder_days || null,
    };

    // 4. Insert task ke database
    const { data: task, error: insertError } = await supabase
      .from("tasks")
      .insert(taskPayload)
      .select()
      .single();

    if (insertError) {
      console.error("Database insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to create task" },
        { status: 500 }
      );
    }

    // 5. Schedule reminder jika ada (FIRE AND FORGET)
    if (task.remind_method && task.reminder_days !== null) {
      // Tidak menunggu response dari schedule-reminder
      fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin}/api/schedule-reminder`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Forward cookies untuk auth
            Cookie: request.headers.get("cookie") || "",
          },
          body: JSON.stringify({ taskId: task.id }),
        }
      ).catch((error) => {
        // Log error tapi jangan block response
        console.error("Background reminder scheduling failed:", error);
        // Bisa tambah monitoring/alert di sini
      });
    }

    // 6. Return response segera
    return NextResponse.json(
      {
        success: true,
        message: "Task created successfully",
        data: task,
        reminderScheduled: !!task.remind_method, // Info apakah reminder dijadwalkan
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error creating task:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
