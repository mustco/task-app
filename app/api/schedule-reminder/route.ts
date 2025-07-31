// app/api/schedule-reminder/route.ts

import { NextRequest, NextResponse } from "next/server";
import { scheduleTaskReminder } from "../../../src/trigger/task"; // Pastikan path ini benar
import { supabaseAdmin } from "@/lib/supabase/admin"; // Untuk operasi admin (bypass RLS)
import { createClient } from "@/lib/supabase/server"; // Untuk klien yang diautentikasi (mematuhi RLS)
import { z } from "zod"; // Untuk validasi input yang kuat
import validator from 'validator'; // Untuk validasi email dan nomor telepon

// --- Skema Validasi Input dengan Zod ---
// Zod membantu kita mendefinisikan bentuk data yang diharapkan dan memvalidasinya.
const ScheduleReminderSchema = z.object({
  taskId: z.string().uuid("Invalid taskId format. Must be a UUID."), // Pastikan taskId adalah UUID yang valid
});

// --- Interface untuk Task dengan User dan metode pengingat ---
interface TaskWithUser {
  id: string;
  user_id: string; // Tambahkan user_id untuk otorisasi
  title: string;
  description?: string;
  deadline: string;
  reminder_days: number;
  remind_method: "email" | "whatsapp" | "both";
  target_contact?: string; // Bisa email, nomor WA, atau "email|whatsapp"
  users: {
    name: string;
    email: string;
    phone_number?: string;
  } | null;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Validasi Input Body
    const body = await request.json();
    const validationResult = ScheduleReminderSchema.safeParse(body);

    if (!validationResult.success) {
      // Mengembalikan error validasi yang spesifik dari Zod
      return NextResponse.json(
        { 
          error: "Invalid request payload", 
          details: validationResult.error.flatten().fieldErrors 
        },
        { status: 400 }
      );
    }

    const { taskId } = validationResult.data;

    // 2. Autentikasi Pengguna
    // Menggunakan `createClient()` yang akan mendapatkan session pengguna dari cookies request.
    // Ini mengasumsikan pengguna sudah login di sisi client dan cookie sesinya dikirimkan.
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("Authentication error:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 3. Ambil data task dan user (termasuk nomor telepon)
    // Gunakan `supabase` client yang diautentikasi untuk memanfaatkan RLS.
    // Pastikan tabel `tasks` Anda memiliki RLS yang membatasi akses ke task milik user tersebut.
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select(
        `
        id, title, description, deadline, reminder_days, user_id,
        remind_method, 
        target_contact,
        users(name, email, phone_number) 
        `
      )
      .eq("id", taskId)
      .single<TaskWithUser>();

    if (fetchError || !task) {
      console.error("Supabase fetch error:", fetchError);
      // Penting: Jangan berikan detail error yang terlalu spesifik jika task tidak ditemukan.
      // Mengembalikan 404 jika task tidak ada, atau jika user tidak punya akses ke task tersebut (karena RLS).
      return NextResponse.json(
        { error: "Task not found or you do not have permission to access it." },
        { status: 404 }
      );
    }

    // 4. Otorisasi: Pastikan task ini milik pengguna yang diautentikasi.
    // Ini adalah lapisan keamanan ekstra jika RLS tidak sepenuhnya menangkap semua skenario,
    // atau jika Anda ingin validasi eksplisit di kode aplikasi.
    if (task.user_id !== user.id) {
      console.warn(`User ${user.id} attempted to access task ${taskId} belonging to user ${task.user_id}`);
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to schedule a reminder for this task." },
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

    const userName = userDetails.name || "User";
    const userEmail = userDetails.email;
    
    // Normalisasi nomor telepon pengguna dari database (62xxxx)
    let userPhone = userDetails.phone_number;
    if (userPhone && userPhone.startsWith("0")) {
        userPhone = "62" + userPhone.substring(1);
    }

    // --- LOGIKA BERDASARKAN REMIND_METHOD & Validasi Kontak ---
    let recipientEmail: string | undefined;
    let recipientPhone: string | undefined;

    if (task.remind_method === "email") {
      recipientEmail = task.target_contact || userEmail;
      if (!validator.isEmail(recipientEmail)) {
        return NextResponse.json(
          { error: "Invalid email address for reminder." },
          { status: 400 }
        );
      }
      recipientPhone = undefined; // Pastikan undefined jika hanya email
    } else if (task.remind_method === "whatsapp") {
      recipientPhone = task.target_contact || userPhone;
      // Validasi nomor telepon: hanya digit, minimal 8 digit (contoh), dimulai dengan 62
      if (!recipientPhone || !/^\d{8,15}$/.test(recipientPhone.replace(/\+/g, ''))) { // Hapus '+' jika ada
        return NextResponse.json(
          { error: "Invalid WhatsApp phone number for reminder." },
          { status: 400 }
        );
      }
      // Normalisasi nomor telepon target_contact jika ada
      if (recipientPhone.startsWith("0")) {
        recipientPhone = "62" + recipientPhone.substring(1);
      } else if (!recipientPhone.startsWith("62") && recipientPhone.length < 15) {
        // Asumsi default ke 62 jika tidak dimulai dengan itu, tapi bukan format internasional penuh
        // Logika ini bisa disesuaikan lebih lanjut
        console.warn(`Phone number ${recipientPhone} does not start with 62. Assuming local and prepending 62.`);
        recipientPhone = "62" + recipientPhone; 
      }
      recipientEmail = undefined; // Pastikan undefined jika hanya whatsapp
    } else if (task.remind_method === "both") {
      if (task.target_contact && task.target_contact.includes("|")) {
        const [emailPart, whatsappPart] = task.target_contact.split("|").map(s => s.trim());
        
        recipientEmail = emailPart || userEmail;
        recipientPhone = whatsappPart || userPhone;

        if (!validator.isEmail(recipientEmail)) {
          return NextResponse.json(
            { error: "Invalid email address in target_contact for 'both' reminder." },
            { status: 400 }
          );
        }

        if (!recipientPhone || !/^\d{8,15}$/.test(recipientPhone.replace(/\+/g, ''))) {
          return NextResponse.json(
            { error: "Invalid WhatsApp phone number in target_contact for 'both' reminder." },
            { status: 400 }
          );
        }
        // Normalisasi nomor telepon dari target_contact (jika ada)
        if (recipientPhone.startsWith("0")) {
          recipientPhone = "62" + recipientPhone.substring(1);
        } else if (!recipientPhone.startsWith("62") && recipientPhone.length < 15) {
          console.warn(`Phone number ${recipientPhone} does not start with 62. Assuming local and prepending 62.`);
          recipientPhone = "62" + recipientPhone; 
        }

      } else {
        // Fallback jika format target_contact tidak sesuai untuk 'both'
        recipientEmail = userEmail;
        recipientPhone = userPhone;

        if (!validator.isEmail(recipientEmail) || !recipientPhone || !/^\d{8,15}$/.test(recipientPhone.replace(/\+/g, ''))) {
            return NextResponse.json(
                { error: "Missing or invalid default email/phone for 'both' reminder when target_contact is malformed." },
                { status: 400 }
            );
        }
        // Normalisasi nomor telepon fallback
        if (recipientPhone.startsWith("0")) {
          recipientPhone = "62" + recipientPhone.substring(1);
        } else if (!recipientPhone.startsWith("62") && recipientPhone.length < 15) {
          console.warn(`Phone number ${recipientPhone} does not start with 62. Assuming local and prepending 62.`);
          recipientPhone = "62" + recipientPhone; 
        }
      }
    }

    // 5. Validasi Akhir untuk Ketersediaan Kontak
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

    // 6. Validasi `reminder_days`
    if (task.reminder_days < 0 || task.reminder_days > 365) { // Contoh: batasi antara 0 hingga 365 hari
      return NextResponse.json(
        { error: "Reminder days must be between 0 and 365." }, // Sesuaikan batas Anda
        { status: 400 }
      );
    }

    const firstName = userName.split(" ")[0] || "User";

    // 7. Jadwalkan Pengingat
    // Pastikan `scheduleTaskReminder` menangani potensi undefined dengan baik,
    // atau gunakan string kosong sesuai kebutuhan fungsi tersebut.
    const handle = await scheduleTaskReminder({
      id: task.id,
      title: task.title,
      description: task.description,
      deadline: task.deadline,
      reminderDays: task.reminder_days,
      recipientEmail: recipientEmail || "", 
      recipientPhone: recipientPhone, // Bisa undefined, fungsi harus menanganinya
      firstName: firstName,
    });

    // 8. Simpan trigger_handle_id ke database menggunakan `supabaseAdmin`
    // SupabaseAdmin digunakan di sini karena mungkin perlu menulis ke kolom yang tidak bisa diakses user biasa
    // atau untuk melakukan operasi yang tidak melalui RLS (misalnya untuk ID trigger).
    // Pastikan `supabaseAdmin` memiliki policy untuk update kolom ini.
    const { error: updateError } = await supabaseAdmin
      .from("tasks")
      .update({ trigger_handle_id: handle.id })
      .eq("id", task.id);

    if (updateError) {
      console.error(`Failed to save trigger_handle_id for task ${task.id}:`, updateError);
      // Ini adalah error internal server, tetapi reminder sudah terjadwal.
      // Kita bisa tetap memberikan response sukses, tetapi log error ini penting.
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
    // Hindari mengekspos detail error sensitif ke klien
    return NextResponse.json(
      { error: "Failed to schedule reminder due to an internal server error." },
      { status: 500 }
    );
  }
}