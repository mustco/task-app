// app/api/reschedule-reminder/route.ts (SECURE VERSION)

import { NextRequest, NextResponse } from "next/server";
import { scheduleTaskReminder } from "../../../src/trigger/task"; // Pastikan path ini benar
import { supabaseAdmin } from "@/lib/supabase/admin"; // Untuk operasi admin (misal: update trigger_handle_id)
import { createClient } from "@/lib/supabase/server"; // Untuk klien yang diautentikasi (mematuhi RLS)
import { z } from "zod"; // Untuk validasi input yang kuat
import validator from "validator"; // Untuk validasi email dan nomor telepon

// --- Skema Validasi Input dengan Zod ---
const RescheduleReminderSchema = z.object({
  taskId: z.string().uuid("Invalid taskId format. Must be a UUID."),
  hasReminder: z.boolean(), // Menunjukkan apakah reminder baru harus dijadwalkan
});

// --- Interface untuk Task dengan User dan metode pengingat ---
interface TaskWithUser {
  id: string;
  user_id: string; // Tambahkan user_id untuk otorisasi
  title: string;
  description?: string;
  deadline: string;
  reminder_days: number;
  remind_method: "email" | "whatsapp" | "both" | null; // Bisa null jika tidak ada reminder
  target_contact?: string; // Bisa email, nomor WA, atau "email|whatsapp"
  trigger_handle_id?: string | null; // Bisa null jika belum ada atau sudah dicancel
  users: {
    name: string;
    email: string;
    phone_number?: string;
  } | null;
}

// Fungsi untuk cancel trigger
async function cancelTriggerHandle(handleId: string): Promise<boolean> {
  const url = `https://api.trigger.dev/api/v2/runs/${handleId}/cancel`; // Hanya menggunakan API v2
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(5000), // Timeout 5 detik
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

export async function POST(request: NextRequest) {
  try {
    // 1. Validasi Input Body
    const body = await request.json();
    const validationResult = RescheduleReminderSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { taskId, hasReminder } = validationResult.data;

    // 2. Autentikasi Pengguna
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("Authentication error:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 3. Ambil data task terbaru dengan klien yang diautentikasi (mematuhi RLS)
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select(
        `
        id, title, description, deadline, reminder_days, user_id,
        remind_method, target_contact, trigger_handle_id,
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

    // 4. Otorisasi: Pastikan task ini milik pengguna yang diautentikasi.
    if (task.user_id !== user.id) {
      console.warn(
        `User ${user.id} attempted to reschedule reminder for task ${taskId} belonging to user ${task.user_id}`
      );
      return NextResponse.json(
        {
          error:
            "Forbidden: You do not have permission to reschedule reminders for this task.",
        },
        { status: 403 }
      );
    }

    let cancelResult = { success: false, attempted: false };

    // 5. HAPUS JADWAL LAMA (jika ada trigger_handle_id)
    if (task.trigger_handle_id) {
      cancelResult.attempted = true;
      console.log(
        `🔄 Attempting to cancel old reminder: ${task.trigger_handle_id}`
      );
      cancelResult.success = await cancelTriggerHandle(task.trigger_handle_id);
      if (cancelResult.success) {
        console.log(`✅ Old reminder cancelled successfully`);
      } else {
        console.warn(
          `⚠️ Could not cancel old reminder ${task.trigger_handle_id} - might already be executed or expired`
        );
      }
    }

    // 6. BUAT JADWAL BARU (jika hasReminder = true)
    let newTriggerHandleId: string | null = null;
    let scheduleResult = { success: false, error: null as string | null };
    let scheduledFor = {
      email: undefined as string | undefined,
      whatsapp: undefined as string | undefined,
      method: undefined as string | undefined,
    };

    if (hasReminder) {
      // Hanya proses penjadwalan jika hasReminder true
      if (!task.remind_method) {
        return NextResponse.json(
          {
            error:
              "Remind method not set for this task. Cannot schedule a reminder.",
          },
          { status: 400 }
        );
      }

      const userDetails = task.users;
      if (!userDetails) {
        return NextResponse.json(
          { error: "Task has no associated user details." },
          { status: 404 }
        );
      }

      const userName = userDetails.name || "User";
      const userEmail = userDetails.email;

      let userPhone = userDetails.phone_number;
      if (userPhone && userPhone.startsWith("0")) {
        userPhone = "62" + userPhone.substring(1);
      }

      let recipientEmail: string | undefined;
      let recipientPhone: string | undefined;

      // Logika penentuan dan validasi kontak sama seperti di `schedule-reminder`
      if (task.remind_method === "email") {
        recipientEmail = task.target_contact || userEmail;
        if (!validator.isEmail(recipientEmail)) {
          return NextResponse.json(
            { error: "Invalid email address for reminder." },
            { status: 400 }
          );
        }
        recipientPhone = undefined;
      } else if (task.remind_method === "whatsapp") {
        recipientPhone = task.target_contact || userPhone;
        if (
          !recipientPhone ||
          !/^\d{8,15}$/.test(recipientPhone.replace(/\+/g, ""))
        ) {
          return NextResponse.json(
            { error: "Invalid WhatsApp phone number for reminder." },
            { status: 400 }
          );
        }
        if (recipientPhone.startsWith("0")) {
          recipientPhone = "62" + recipientPhone.substring(1);
        } else if (
          !recipientPhone.startsWith("62") &&
          recipientPhone.length < 15
        ) {
          console.warn(
            `Phone number ${recipientPhone} does not start with 62. Assuming local and prepending 62.`
          );
          recipientPhone = "62" + recipientPhone;
        }
        recipientEmail = undefined;
      } else if (task.remind_method === "both") {
        if (task.target_contact && task.target_contact.includes("|")) {
          const [emailPart, whatsappPart] = task.target_contact
            .split("|")
            .map((s) => s.trim());

          recipientEmail = emailPart || userEmail;
          recipientPhone = whatsappPart || userPhone;

          if (!validator.isEmail(recipientEmail)) {
            return NextResponse.json(
              {
                error:
                  "Invalid email address in target_contact for 'both' reminder.",
              },
              { status: 400 }
            );
          }

          if (
            !recipientPhone ||
            !/^\d{8,15}$/.test(recipientPhone.replace(/\+/g, ""))
          ) {
            return NextResponse.json(
              {
                error:
                  "Invalid WhatsApp phone number in target_contact for 'both' reminder.",
              },
              { status: 400 }
            );
          }
          if (recipientPhone.startsWith("0")) {
            recipientPhone = "62" + recipientPhone.substring(1);
          } else if (
            !recipientPhone.startsWith("62") &&
            recipientPhone.length < 15
          ) {
            console.warn(
              `Phone number ${recipientPhone} does not start with 62. Assuming local and prepending 62.`
            );
            recipientPhone = "62" + recipientPhone;
          }
        } else {
          recipientEmail = userEmail;
          recipientPhone = userPhone;

          if (
            !validator.isEmail(recipientEmail) ||
            !recipientPhone ||
            !/^\d{8,15}$/.test(recipientPhone.replace(/\+/g, ""))
          ) {
            return NextResponse.json(
              {
                error:
                  "Missing or invalid default email/phone for 'both' reminder when target_contact is malformed.",
              },
              { status: 400 }
            );
          }
          if (recipientPhone.startsWith("0")) {
            recipientPhone = "62" + recipientPhone.substring(1);
          } else if (
            !recipientPhone.startsWith("62") &&
            recipientPhone.length < 15
          ) {
            console.warn(
              `Phone number ${recipientPhone} does not start with 62. Assuming local and prepending 62.`
            );
            recipientPhone = "62" + recipientPhone;
          }
        }
      }

      // Validasi Akhir untuk Ketersediaan Kontak
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
      if (
        task.remind_method === "both" &&
        (!recipientEmail || !recipientPhone)
      ) {
        return NextResponse.json(
          {
            error:
              "Valid email and phone number are required for both reminder methods.",
          },
          { status: 400 }
        );
      }

      // Validasi `reminder_days`
      if (task.reminder_days < 0 || task.reminder_days > 365) {
        // Contoh: batasi antara 0 hingga 365 hari
        return NextResponse.json(
          { error: "Reminder days must be between 0 and 365." },
          { status: 400 }
        );
      }

      const firstName = userName.split(" ")[0] || "User";

      // Cek apakah reminder time masih valid (belum lewat)
      const deadlineDate = new Date(task.deadline);
      const reminderTimestamp =
        deadlineDate.getTime() - task.reminder_days * 24 * 60 * 60 * 1000;
      const reminderDate = new Date(reminderTimestamp);

      if (reminderDate.getTime() <= new Date().getTime()) {
        return NextResponse.json(
          {
            error:
              "The calculated reminder time has already passed. Cannot schedule reminder for a past date.",
          },
          { status: 400 }
        );
      }

      try {
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

        newTriggerHandleId = handle.id;
        scheduleResult.success = true;
        scheduledFor = {
          email: recipientEmail,
          whatsapp: recipientPhone,
          method: task.remind_method,
        };
        console.log(`✅ New reminder scheduled: ${newTriggerHandleId}`);
      } catch (error: any) {
        scheduleResult.error = error.message;
        console.error("Error scheduling new reminder:", error);
        return NextResponse.json(
          { error: "Failed to schedule new reminder", details: error.message },
          { status: 500 }
        );
      }
    } else {
      // Jika hasReminder false, berarti tujuannya hanya membatalkan reminder lama
      console.log("hasReminder is false. No new reminder will be scheduled.");
    }

    // 7. UPDATE TRIGGER_HANDLE_ID DI DATABASE
    // Menggunakan supabaseAdmin karena ini adalah operasi internal sistem
    // yang mungkin perlu melewati RLS untuk memperbarui kolom trigger_handle_id.
    const { error: updateError } = await supabaseAdmin
      .from("tasks")
      .update({ trigger_handle_id: newTriggerHandleId }) // newTriggerHandleId bisa null jika reminder dibatalkan atau gagal dijadwalkan
      .eq("id", taskId);

    if (updateError) {
      console.error("Failed to update trigger_handle_id in DB:", updateError);
      // Ini adalah error internal server, tetapi proses inti (cancel/schedule) mungkin sudah berhasil.
      // Kita bisa tetap memberikan response sukses, tetapi log error ini penting.
    }

    return NextResponse.json({
      success: true,
      message: hasReminder
        ? "Reminder rescheduled successfully"
        : "Reminder cancelled successfully",
      taskId: task.id,
      oldTriggerHandle: task.trigger_handle_id,
      newTriggerHandle: newTriggerHandleId,
      cancelResult: cancelResult,
      scheduleResult: scheduleResult,
      action: hasReminder ? "rescheduled" : "cancelled",
      scheduledFor: scheduledFor, // Berikan informasi kontak yang dijadwalkan
    });
  } catch (error: any) {
    console.error("Error in reschedule-reminder API:", error);
    return NextResponse.json(
      { error: "Failed to process reminder request", details: error.message },
      { status: 500 }
    );
  }
}
