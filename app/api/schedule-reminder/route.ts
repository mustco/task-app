// app/api/schedule-reminder/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scheduleTaskReminder } from "../../../src/trigger/task";

// Interface diperbarui untuk menyertakan remind_method
interface TaskWithUser {
  id: string;
  title: string;
  description?: string;
  deadline: string;
  reminder_days: number;
  remind_method: "email" | "whatsapp" | "both";
  target_contact?: string;
  users: {
    name: string;
    email: string;
    phone_number?: string;
  } | null;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { taskId } = await request.json();
    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 }
      );
    }

    // Ambil data task dan user, termasuk nomor telepon
    const { data: task, error } = await supabase
      .from("tasks")
      .select(
        `
        id, title, description, deadline, reminder_days,
        remind_method, 
        target_contact,
        users(name, email, phone_number) 
      `
      )
      .eq("id", taskId)
      .single<TaskWithUser>();

    if (error || !task) {
      console.error("Supabase error:", error);
      return NextResponse.json(
        { error: "Task not found or failed to fetch" },
        { status: 404 }
      );
    }

    const user = task.users;
    if (!user) {
      return NextResponse.json(
        { error: "Task has no associated user" },
        { status: 404 }
      );
    }

    const userName = user.name || "User";
    const userEmail = user.email;
    // Normalisasi nomor telepon
    const userPhone = user.phone_number?.startsWith("0")
      ? "62" + user.phone_number.substring(1)
      : user.phone_number;

    // --- LOGIKA BARU BERDASARKAN REMIND_METHOD ---
    let recipientEmail: string | undefined;
    let recipientPhone: string | undefined;

    if (task.remind_method === "email") {
      // Untuk email only: gunakan target_contact jika ada, jika tidak gunakan user email
      recipientEmail = task.target_contact || userEmail;
      recipientPhone = undefined;
    } else if (task.remind_method === "whatsapp") {
      // Untuk whatsapp only: gunakan target_contact jika ada, jika tidak gunakan user phone
      recipientEmail = undefined;
      recipientPhone = task.target_contact || userPhone;
    } else if (task.remind_method === "both") {
      // Untuk both: pisahkan dari target_contact yang formatnya "email|whatsapp"
      if (task.target_contact && task.target_contact.includes("|")) {
        const [emailPart, whatsappPart] = task.target_contact.split("|");
        recipientEmail = emailPart.trim() || userEmail;
        recipientPhone = whatsappPart.trim() || userPhone;
      } else {
        // Fallback jika format tidak sesuai
        recipientEmail = userEmail;
        recipientPhone = userPhone;
      }
    }

    // Normalisasi nomor telepon jika ada
    if (recipientPhone) {
      recipientPhone = recipientPhone.startsWith("0")
        ? "62" + recipientPhone.substring(1)
        : recipientPhone;
    }

    // Validasi: pastikan ada kontak yang valid sesuai dengan remind_method
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
            "Valid email and phone number are required for both reminders.",
        },
        { status: 400 }
      );
    }

    const firstName = userName.split(" ")[0] || "User";

    // Schedule reminder
    const handle = await scheduleTaskReminder({
      id: task.id,
      title: task.title,
      description: task.description,
      deadline: task.deadline,
      reminderDays: task.reminder_days,
      recipientEmail: recipientEmail || "", // Berikan string kosong jika undefined
      recipientPhone: recipientPhone,
      firstName: firstName,
    });

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
      { error: "Failed to schedule reminder", details: error.message },
      { status: 500 }
    );
  }
}
