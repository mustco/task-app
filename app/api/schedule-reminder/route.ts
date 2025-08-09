// app/api/schedule-reminder/route.ts (FINAL - HANYA LOGIKA KONTAK YANG DIUBAH)

import { NextRequest, NextResponse } from "next/server";
import { scheduleTaskReminder } from "../../../src/trigger/task";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import validator from "validator";

const ScheduleReminderSchema = z.object({
  taskId: z.string().uuid("Invalid taskId format. Must be a UUID."),
});

// ✅ PERUBAHAN 1: Interface disesuaikan
interface TaskWithUser {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  deadline: string;
  reminder_days: number;
  remind_method: "email" | "whatsapp" | "both";
  target_email: string | null; // Kolom baru
  target_phone: string | null; // Kolom baru
  users: {
    name: string;
    email: string;
    phone_number?: string;
  } | null;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Validasi Input Body (Tidak ada perubahan)
    const body = await request.json();
    const validationResult = ScheduleReminderSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }
    const { taskId } = validationResult.data;

    // 2. Autentikasi Pengguna (Tidak ada perubahan)
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
        remind_method, 
        target_email, 
        target_phone,
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

    // 4. Otorisasi (Tidak ada perubahan)
    if (task.user_id !== user.id) {
      console.warn(
        `User ${user.id} attempted to access task ${taskId} belonging to user ${task.user_id}`
      );
      return NextResponse.json(
        {
          error:
            "Forbidden: You do not have permission to schedule a reminder for this task.",
        },
        { status: 403 }
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

    // Ambil kontak dari task, atau fallback ke profil user jika tidak ada
    if (task.remind_method === "email" || task.remind_method === "both") {
      recipientEmail = task.target_email || userDetails.email;
    }
    if (task.remind_method === "whatsapp" || task.remind_method === "both") {
      recipientPhone = task.target_phone || userDetails.phone_number;
    }

    // Validasi dan normalisasi setelah mendapatkan nilainya
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
      // Normalisasi nomor telepon
      if (recipientPhone.startsWith("0")) {
        recipientPhone = "62" + recipientPhone.substring(1);
      }
    }

    // 5. Validasi Akhir untuk Ketersediaan Kontak (Tidak ada perubahan)
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
    if (task.remind_method === "both" && (!recipientEmail || !recipientPhone)) {
      return NextResponse.json(
        {
          error:
            "Valid email and phone number are required for both reminder methods.",
        },
        { status: 400 }
      );
    }

    // 6. Validasi `reminder_days` (Tidak ada perubahan)
    if (task.reminder_days < 0 || task.reminder_days > 365) {
      return NextResponse.json(
        { error: "Reminder days must be between 0 and 365." },
        { status: 400 }
      );
    }

    const firstName = (userDetails.name || "User").split(" ")[0];

    // 7. Jadwalkan Pengingat (Tidak ada perubahan)
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

    // 8. Simpan trigger_handle_id (Tidak ada perubahan)
    const { error: updateError } = await supabaseAdmin
      .from("tasks")
      .update({ trigger_handle_id: handle.id })
      .eq("id", task.id);

    if (updateError) {
      console.error(
        `Failed to save trigger_handle_id for task ${task.id}:`,
        updateError
      );
    }

    return NextResponse.json({
      success: true,
      message: "Reminder scheduled successfully",
      taskId: task.id,
      triggerHandle: handle.id,
      scheduledFor: {
        email: recipientEmail,
        whatsapp: recipientPhone,
        method: task.remind_method,
      },
    });
  } catch (error: any) {
    console.error("Error scheduling reminder:", error);
    return NextResponse.json(
      { error: "Failed to schedule reminder due to an internal server error." },
      { status: 500 }
    );
  }
}
