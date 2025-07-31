// app/api/delete-task/route.ts (UPDATED VERSION)

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin"; // Untuk operasi yang membutuhkan hak admin (misal: membatalkan trigger)
import { createClient } from "@/lib/supabase/server"; // Untuk klien yang diautentikasi (mematuhi RLS)
import { z } from "zod"; // Untuk validasi input

// --- Skema Validasi Input dengan Zod ---
const DeleteTaskSchema = z.object({
  taskId: z.string().uuid("Invalid taskId format. Must be a UUID."), // Pastikan taskId adalah UUID yang valid
});

export async function DELETE(request: NextRequest) {
  try {
    // 1. Validasi Input Body
    const body = await request.json();
    const validationResult = DeleteTaskSchema.safeParse(body);

    if (!validationResult.success) {
      // Mengembalikan error validasi yang spesifik dari Zod
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { taskId } = validationResult.data;

    // 2. Autentikasi Pengguna
    // Menggunakan `createClient()` untuk mendapatkan session pengguna dari cookies request.
    const supabase = await createClient(); // Asumsikan Anda memiliki 'lib/supabase/server.ts' seperti yang dijelaskan sebelumnya
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("Authentication error:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 3. Ambil data task (termasuk user_id untuk otorisasi)
    // Gunakan `supabase` client yang diautentikasi (bukan `supabaseAdmin`)
    // agar Row-Level Security (RLS) pada tabel `tasks` dapat diterapkan.
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("id, trigger_handle_id, title, user_id") // Pastikan Anda mengambil `user_id`
      .eq("id", taskId)
      .single();

    if (fetchError || !task) {
      console.error("Supabase fetch error:", fetchError);
      // Penting: Jangan berikan detail error yang terlalu spesifik jika task tidak ditemukan.
      // Mengembalikan 404 jika task tidak ada, atau jika user tidak punya akses (karena RLS).
      return NextResponse.json(
        { error: "Task not found or you do not have permission to delete it." },
        { status: 404 }
      );
    }

    // 4. Otorisasi: Pastikan task ini milik pengguna yang diautentikasi.
    // Ini adalah lapisan keamanan kedua setelah RLS.
    if (task.user_id !== user.id) {
      console.warn(
        `User ${user.id} attempted to delete task ${taskId} belonging to user ${task.user_id}`
      );
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to delete this task." },
        { status: 403 }
      );
    }

    // 5. Batalkan pengingat jika ada, menggunakan `supabaseAdmin`
    // SupabaseAdmin digunakan di sini karena pembatalan trigger mungkin memerlukan hak akses yang lebih tinggi
    // atau melewati RLS untuk memastikan trigger dapat dibatalkan terlepas dari siapa pemilik task-nya,
    // asalkan permintaan penghapusan task itu sendiri sudah terotorisasi.
    let reminderCancelled = false;
    if (task.trigger_handle_id) {
      try {
        const triggerCancelResponse = await fetch(
          `${process.env.TRIGGER_API_URL}/api/v2/runs/${task.trigger_handle_id}/cancel`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
              "Content-Type": "application/json",
            },
            // Timeout untuk request eksternal
            signal: AbortSignal.timeout(5000), // 5 detik timeout
          }
        );

        if (!triggerCancelResponse.ok) {
          console.warn(
            `Failed to cancel reminder for task ${taskId}. Status: ${triggerCancelResponse.status}, Message: ${await triggerCancelResponse.text()}`
          );
          // Log warning tapi tetap lanjutkan penghapusan task
        } else {
          console.log(`Cancelled reminder for deleted task ${taskId}`);
          reminderCancelled = true;
        }
      } catch (cancelError: any) {
        if (cancelError.name === "AbortError") {
          console.warn(
            `Timeout when trying to cancel reminder for task ${taskId}.`
          );
        } else {
          console.warn(
            `Failed to cancel reminder for task ${taskId}:`,
            cancelError
          );
        }
        // Lanjutkan dengan hapus task meskipun gagal cancel reminder
      }
    }

    // 6. Hapus task dari database
    // Gunakan kembali `supabase` client yang diautentikasi (mematuhi RLS).
    // Ini mengharuskan Anda memiliki kebijakan RLS `DELETE` untuk user_id yang cocok.
    const { error: deleteError } = await supabase
      .from("tasks")
      .delete()
      .eq("id", taskId);

    if (deleteError) {
      console.error(`Failed to delete task ${taskId} from DB:`, deleteError);
      throw deleteError; // Rethrow untuk ditangkap oleh catch global
    }

    return NextResponse.json({
      success: true,
      message: "Task deleted successfully",
      taskId: taskId,
      title: task.title,
      reminderCancelled: reminderCancelled, // Menggunakan status aktual
    });
  } catch (error: any) {
    console.error("Error deleting task:", error);
    // Hindari mengekspos detail error sensitif ke klien
    return NextResponse.json(
      { error: "Failed to delete task due to an internal server error." },
      { status: 500 }
    );
  }
}
