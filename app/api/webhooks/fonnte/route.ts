// app/api/webhooks/fonnte/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fonnteSchema = z.object({
  device_id: z.string(),
  sender: z.string(),
  message: z.string(),
});

async function sendReply(to: string, message: string) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) {
    console.warn("FONNTE_TOKEN not set, skipping sendReply");
    return;
  }
  const url = "https://api.fonnte.com/send";
  const payload = new URLSearchParams({
    target: to,
    message,
    countryCode: "62",
  });
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });
  } catch (error) {
    console.error("Error sending reply via Fonnte:", error);
  }
}

function normalizePhone(input: string) {
  const raw = String(input).replace(/\s+/g, "").replace(/^\+/, "");
  const normalized = raw.startsWith("62") ? "0" + raw.slice(2) : raw;
  return { raw, normalized };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = fonnteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data format" },
        { status: 400 }
      );
    }

    const { sender, message } = parsed.data;

    // --- 1. Cari user pakai supabaseAdmin ---
    const { raw, normalized } = normalizePhone(sender);
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .or(`phone_number.eq.${normalized},phone_number.eq.${raw}`)
      .maybeSingle();

    if (userErr) {
      console.error("Error fetching user:", userErr);
      await sendReply(sender, "Terjadi kesalahan mencari data pengguna.");
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }

    if (!userRow?.id) {
      await sendReply(
        sender,
        "Nomor Anda tidak terdaftar. Silakan daftar melalui web terlebih dahulu."
      );
      return NextResponse.json({ error: "User not found" });
    }

    // --- 2. Panggil service NLU ---
    const nluUrl = new URL("/api/nlu", request.url);
    const nluResponse = await fetch(nluUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      cache: "no-store",
    });

    if (!nluResponse.ok) {
      throw new Error("NLU service failed");
    }
    const nluResult = await nluResponse.json();

    let replyMessage = `Maaf, saya tidak mengerti maksud Anda. Gunakan kata kunci seperti "tambah tugas", "lihat tugas", atau "hapus tugas".`;

    // --- 3. Eksekusi aksi berdasarkan intent ---
    switch (nluResult.intent) {
      case "CREATE_TASK": {
        const title = nluResult.entities.title?.trim();
        if (!title) {
          replyMessage =
            "Tolong sebutkan judul tugasnya. Contoh: tambah tugas meeting pagi";
        } else {
          const deadline = new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString(); // +1 hari
          const { error } = await supabaseAdmin
            .from("tasks")
            .insert([{ user_id: userRow.id, title, deadline }]);
          replyMessage = error
            ? "Gagal menambahkan tugas."
            : `✅ Tugas "${title}" berhasil ditambahkan!`;
        }
        break;
      }
      case "READ_TASKS": {
        const { data: tasks, error } = await supabaseAdmin
          .from("tasks")
          .select("title")
          .eq("user_id", userRow.id)
          .in("status", ["pending", "in_progress"])
          .order("created_at", { ascending: true });
        if (error) {
          replyMessage = "Gagal mengambil daftar tugas.";
        } else if (!tasks?.length) {
          replyMessage = "Anda tidak memiliki tugas aktif saat ini.";
        } else {
          const list = tasks
            .map((t: any, i: number) => `${i + 1}. ${t.title}`)
            .join("\n");
          replyMessage = `Berikut adalah daftar tugas Anda:\n${list}`;
        }
        break;
      }
      case "DELETE_TASK": {
        const title = nluResult.entities.title?.trim();
        if (!title) {
          replyMessage =
            "Tolong sebutkan judul tugas yang ingin dihapus. Contoh: hapus tugas meeting pagi";
        } else {
          const { data: deleted, error } = await supabaseAdmin
            .from("tasks")
            .delete()
            .eq("user_id", userRow.id)
            .ilike("title", `%${title}%`)
            .select();
          if (error) {
            replyMessage = "Gagal menghapus tugas.";
          } else if (deleted?.length) {
            replyMessage = `✅ Tugas yang mengandung kata "${title}" berhasil dihapus.`;
          } else {
            replyMessage = `Tugas dengan judul "${title}" tidak ditemukan.`;
          }
        }
        break;
      }
    }

    // --- 4. Kirim balasan ke user ---
    await sendReply(sender, replyMessage);

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Error in Fonnte webhook:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
