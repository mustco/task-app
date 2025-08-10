// app/api/webhooks/fonnte/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health-check agar Fonnte gak 405
export async function GET() {
  return new NextResponse("OK", { status: 200 });
}
// Preflight CORS kalau Fonnte pakai OPTIONS
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

const fonnteSchema = z.object({
  device_id: z.string(),
  sender: z.string(),
  message: z.string(),
});

async function sendReply(to: string, message: string) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) return;
  const payload = new URLSearchParams({
    target: to,
    message,
    countryCode: "62",
  });
  await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  }).catch((e) => console.error("Fonnte send error:", e));
}

function normalizePhone(input: string) {
  const raw = String(input).replace(/\s+/g, "").replace(/^\+/, "");
  const normalized = raw.startsWith("62") ? "0" + raw.slice(2) : raw;
  return { raw, normalized };
}

export async function POST(request: Request) {
  try {
    // --- Terima JSON ATAU x-www-form-urlencoded ---
    const ct = request.headers.get("content-type") || "";
    let body: any = {};
    if (ct.includes("application/json")) {
      body = await request.json();
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const fd = await request.formData();
      body = Object.fromEntries(fd.entries());
    } else {
      // fallback: coba json
      try {
        body = await request.json();
      } catch {
        /* ignore */
      }
    }

    // Beberapa akun Fonnte pakai key berbeda → fallback mapping
    const payload = {
      device_id: body.device_id ?? body.deviceId ?? body.device ?? "",
      sender: body.sender ?? body.phone ?? body.from ?? "",
      message: body.message ?? body.msg ?? "",
    };

    const parsed = fonnteSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data format" },
        { status: 400 }
      );
    }

    const { sender, message } = parsed.data;

    // 1) Lookup user
    const { raw, normalized } = normalizePhone(sender);
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .or(`phone_number.eq.${normalized},phone_number.eq.${raw}`)
      .maybeSingle();

    if (userErr) {
      console.error("Lookup user error:", userErr);
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

    // 2) Panggil NLU (URL relatif supaya aman dev/prod)
    const nluUrl = new URL("/api/nlu", request.url);
    const nluRes = await fetch(nluUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ message }),
    });
    if (!nluRes.ok) throw new Error("NLU service failed");
    const nluResult = await nluRes.json();

    // 3) Aksi
    let replyMessage =
      'Maaf, saya tidak mengerti maksud Anda. Gunakan kata kunci seperti "tambah tugas", "lihat tugas", atau "hapus tugas".';

    switch (nluResult.intent) {
      case "CREATE_TASK": {
        const title = nluResult.entities?.title?.trim();
        if (!title) {
          replyMessage =
            "Tolong sebutkan judul tugasnya. Contoh: tambah tugas meeting pagi";
        } else {
          const deadline = new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString();
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
        if (error) replyMessage = "Gagal mengambil daftar tugas.";
        else if (!tasks?.length)
          replyMessage = "Anda tidak memiliki tugas aktif saat ini.";
        else
          replyMessage = `Berikut adalah daftar tugas Anda:\n${tasks.map((t: any, i: number) => `${i + 1}. ${t.title}`).join("\n")}`;
        break;
      }
      case "DELETE_TASK": {
        const title = nluResult.entities?.title?.trim();
        if (!title)
          replyMessage =
            "Tolong sebutkan judul tugas yang ingin dihapus. Contoh: hapus tugas meeting pagi";
        else {
          const { data: deleted, error } = await supabaseAdmin
            .from("tasks")
            .delete()
            .eq("user_id", userRow.id)
            .ilike("title", `%${title}%`)
            .select();
          if (error) replyMessage = "Gagal menghapus tugas.";
          else
            replyMessage = deleted?.length
              ? `✅ Tugas yang mengandung kata "${title}" berhasil dihapus.`
              : `Tugas "${title}" tidak ditemukan.`;
        }
        break;
      }
    }

    // 4) Balas user
    await sendReply(sender, replyMessage);
    return NextResponse.json({ status: "ok" });
  } catch (e) {
    console.error("Fonnte webhook error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
