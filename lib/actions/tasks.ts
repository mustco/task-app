// lib/actions/tasks.ts
"use server";

import { createClient } from "@/lib/supabase/server";

/** Util: normalisasi nomor HP dari Fonnte */
function normalizePhone(input: string) {
  const raw = String(input).replace(/\s+/g, "").replace(/^\+/, "");
  const normalized = raw.startsWith("62") ? "0" + raw.slice(2) : raw;
  return { raw, normalized };
}

/**
 * Cari user by phone_number (tabel: public.users).
 * Return { user_id } supaya cocok dengan pemakaian di webhook.
 */
export async function getUserByPhone(phoneNumber: string) {
  const supabase = await createClient();

  const { raw, normalized } = normalizePhone(phoneNumber);

  const { data, error } = await supabase
    .from("users")
    .select("id")
    .or(`phone_number.eq.${normalized},phone_number.eq.${raw}`)
    .single();

  // PGRST116 = no rows with .single()
  if (error && (error as any).code !== "PGRST116") {
    console.error("Error fetching user by phone:", error);
    return null;
  }
  if (!data?.id) return null;

  return { user_id: data.id };
}

/**
 * Buat task baru.
 * NOTE: schema butuh deadline NOT NULL → kasih default (mis. +1 hari) jika tidak dikirim.
 */
export async function createTask(
  userId: string,
  title: string,
  opts?: { description?: string; deadline?: string | Date }
) {
  const supabase = await createClient();

  const cleanTitle = title?.trim();
  if (!cleanTitle) {
    throw new Error("Judul tugas tidak boleh kosong.");
  }

  // default deadline: sekarang + 1 hari (ubah sesuai kebutuhanmu)
  const deadline = opts?.deadline
    ? new Date(opts.deadline)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);

  if (isNaN(deadline.getTime())) {
    throw new Error("Deadline tidak valid.");
  }

  const payload = {
    user_id: userId,
    title: cleanTitle,
    description: opts?.description ?? null,
    deadline: deadline.toISOString(),
    // kolom lain pakai default dari schema: status, remind_method, reminder_days, dst.
  };

  const { data, error } = await supabase
    .from("tasks")
    .insert([payload])
    .select()
    .single();

  if (error) {
    console.error("Error creating task:", error);
    throw new Error("Gagal membuat tugas di database.");
  }
  return data;
}

/**
 * Ambil semua task aktif (pending/in_progress) milik user.
 */
export async function getActiveTasks(userId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, deadline")
    .eq("user_id", userId)
    .in("status", ["pending", "in_progress"])
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching tasks:", error);
    throw new Error("Gagal mengambil daftar tugas.");
  }
  return data ?? [];
}

/**
 * Hapus task berdasarkan judul (contains, case-insensitive) milik user.
 */
export async function deleteTaskByTitle(userId: string, title: string) {
  const supabase = await createClient();

  const term = title?.trim();
  if (!term) {
    throw new Error("Judul tugas yang akan dihapus tidak boleh kosong.");
  }

  const { data, error } = await supabase
    .from("tasks")
    .delete()
    .eq("user_id", userId)
    .ilike("title", `%${term}%`)
    .select();

  if (error) {
    console.error("Error deleting task:", error);
    throw new Error("Gagal menghapus tugas.");
  }
  return data ?? [];
}
