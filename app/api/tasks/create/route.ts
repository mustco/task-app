// app/api/tasks/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import validator from "validator";

// Skema validasi yang sangat ketat untuk data task yang masuk
const CreateTaskSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(255, "Title is too long"),
    description: z.string().max(1000, "Description is too long").nullable(),
    deadline: z.string().refine((val) => {
      // Memastikan deadline adalah tanggal yang valid dan di masa depan
      const date = new Date(val);
      return !isNaN(date.getTime()) && date > new Date();
    }, "Deadline must be a valid future date and time."),
    showReminder: z.boolean(),
    remindMethod: z.enum(["email", "whatsapp", "both"]).optional().nullable(),
    targetContact: z.string().optional().nullable(),
    reminderDays: z
      .number()
      .min(0, "Cannot be negative")
      .max(365, "Max 365 days")
      .optional()
      .nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.showReminder) {
      if (!data.remindMethod) {
        ctx.addIssue({
          code: "custom",
          message: "Reminder method is required",
          path: ["remindMethod"],
        });
      }
      if (data.reminderDays === undefined || data.reminderDays === null) {
        ctx.addIssue({
          code: "custom",
          message: "Reminder days are required",
          path: ["reminderDays"],
        });
      }

      // Validasi kontak berdasarkan metode
      if (data.remindMethod === "email") {
        if (!data.targetContact || !validator.isEmail(data.targetContact)) {
          ctx.addIssue({
            code: "custom",
            message: "A valid email is required",
            path: ["targetContact"],
          });
        }
      } else if (data.remindMethod === "whatsapp") {
        // Validasi nomor WhatsApp: harus angka, 8-15 digit, bisa diawali 0, 62, atau +62
        if (
          !data.targetContact ||
          !/^(0|62|\+62)[\d]{8,15}$/.test(
            data.targetContact.replace(/[\s-]/g, "")
          )
        ) {
          ctx.addIssue({
            code: "custom",
            message: "A valid WhatsApp number is required",
            path: ["targetContact"],
          });
        }
      } else if (data.remindMethod === "both") {
        const [email, phone] = data.targetContact?.split("|") || [];
        if (!email || !validator.isEmail(email)) {
          ctx.addIssue({
            code: "custom",
            message: "A valid email is required for 'both' method",
            path: ["targetContact"],
          });
        }
        if (
          !phone ||
          !/^(0|62|\+62)[\d]{8,15}$/.test(phone.replace(/[\s-]/g, ""))
        ) {
          ctx.addIssue({
            code: "custom",
            message: "A valid WhatsApp number is required for 'both' method",
            path: ["targetContact"],
          });
        }
      }
    }
  });

export async function POST(request: NextRequest) {
  try {
    // 1. Autentikasi Pengguna
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Validasi Body Request
    const body = await request.json();
    const validationResult = CreateTaskSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const validatedData = validationResult.data;

    // 3. Menyiapkan data untuk dimasukkan ke Supabase
    const taskPayload = {
      user_id: user.id,
      title: validatedData.title,
      description: validatedData.description,
      deadline: new Date(validatedData.deadline).toISOString(),
      status: "pending" as const, // Pastikan tipe status sesuai
      remind_method: validatedData.showReminder
        ? validatedData.remindMethod
        : null,
      target_contact: validatedData.showReminder
        ? validatedData.targetContact
        : null,
      reminder_days: validatedData.showReminder
        ? validatedData.reminderDays
        : null,
    };

    // 4. Insert Task ke Database
    const { data: newTask, error: insertError } = await supabase
      .from("tasks")
      .insert(taskPayload)
      .select()
      .single();

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to create task", details: insertError.message },
        { status: 500 }
      );
    }

    // 5. Trigger Reminder Scheduling (FIXED: Menggunakan await)
    // Fungsi ini sekarang akan menunggu (await) sampai proses fetch selesai.
    if (validatedData.showReminder && newTask) {
      try {
        // Dapatkan URL basis dari request untuk memanggil API lain
        const baseUrl = new URL(request.url).origin;

        const scheduleResponse = await fetch(
          `${baseUrl}/api/schedule-reminder`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Penting: Teruskan cookie otentikasi agar schedule-reminder tahu siapa user-nya
              Cookie: request.headers.get("cookie") || "",
            },
            body: JSON.stringify({ taskId: newTask.id }),
          }
        );

        // Jika penjadwalan gagal, log errornya tapi jangan hentikan proses utama
        if (!scheduleResponse.ok) {
          const errorBody = await scheduleResponse.json();
          console.error(
            "Failed to trigger reminder scheduling. Status:",
            scheduleResponse.status,
            "Body:",
            errorBody
          );
        } else {
          console.log(`Successfully triggered reminder for task ${newTask.id}`);
        }
      } catch (err) {
        // Log error jika trigger gagal, tapi jangan sampai membuat request utama gagal
        console.error("Error during fetch to schedule-reminder:", err);
      }
    }

    // 6. Kembalikan task yang baru dibuat
    return NextResponse.json(newTask, { status: 201 });
  } catch (error: any) {
    console.error("Error creating task:", error);
    return NextResponse.json(
      { error: "An internal server error occurred." },
      { status: 500 }
    );
  }
}
