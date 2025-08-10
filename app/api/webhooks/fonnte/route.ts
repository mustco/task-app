// app/api/webhooks/fonnte/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
// import { normalizePhone } from "@/lib/utils/phone";
import { ensureISOWIB } from "@/lib/utils/time";
import { phoneVariants } from "@/lib/utils/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new NextResponse("OK", { status: 200 });
}
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

export async function POST(request: Request) {
  try {
    const ct = request.headers.get("content-type") || "";
    let body: any = {};
    if (ct.includes("application/json")) body = await request.json();
    else if (ct.includes("application/x-www-form-urlencoded")) {
      const fd = await request.formData();
      body = Object.fromEntries(fd.entries());
    } else {
      try {
        body = await request.json();
      } catch {}
    }

    // Flexible mapping kunci Fonnte
    const payload = {
      device_id: body.device_id ?? body.deviceId ?? body.device ?? "",
      sender: body.sender ?? body.phone ?? body.from ?? "",
      message: body.message ?? body.msg ?? "",
    };
    const parsed = fonnteSchema.safeParse(payload);
    if (!parsed.success)
      return NextResponse.json(
        { error: "Invalid data format" },
        { status: 400 }
      );

    const { sender, message } = parsed.data;
    // const { e164, local } = normalizePhone(sender);
const { e164, local, intlNoPlus, raw } = phoneVariants(sender);
    // Lookup user
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .in("phone_number", [e164, local, intlNoPlus, raw]) // cek semua bentuk
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

    // NLU (Gemini)
    const nluUrl = new URL("/api/nlu", request.url);
    const nluRes = await fetch(nluUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ message }),
    });
    if (!nluRes.ok) throw new Error("NLU service failed");
    const task = await nluRes.json(); // sesuai ParsedTask

    // Default WA target jika kosong
    let target_contact: string | null = task.target_contact || e164;
    let target_phone: string | null = target_contact?.startsWith("+62")
      ? target_contact.replace(/^\+62/, "0")
      : (target_contact ?? null);

    // Pastikan method whatsapp kalau tak disebut
    const remind_method: "whatsapp" | "email" | "both" =
      task.remind_method || "whatsapp";

    let replyMessage = "Maaf, saya tidak mengerti maksud Anda.";

    switch (task.action) {
      case "add_task": {
        const title = String(task.title || "").trim();
        if (!title) {
          replyMessage = "Tolong sebutkan judul tugasnya.";
          break;
        }
        const deadlineISO = ensureISOWIB(task.deadline, 9);
        const { error } = await supabaseAdmin.from("tasks").insert([
          {
            user_id: userRow.id,
            title,
            description: task.description ?? null,
            deadline: deadlineISO,
            remind_method,
            reminder_days: task.reminder_days ?? 1,
            target_contact,
            target_phone,
            // target_email boleh null; custom_fields/trigger_handle_id biarkan default
          },
        ]);
        replyMessage = error
          ? "Gagal menambahkan tugas."
          : `✅ Tugas "${title}" dibuat. Reminder ${task.reminder_days ?? 1} hari sebelum via ${remind_method}.`;
        break;
      }

      case "view_task":
      case "view_tasks":
      case "view": {
        const { data: tasks, error } = await supabaseAdmin
          .from("tasks")
          .select("title, deadline, remind_method, reminder_days, status")
          .eq("user_id", userRow.id)
          .in("status", ["pending", "in_progress"])
          .order("created_at", { ascending: true });
        if (error) replyMessage = "Gagal mengambil daftar tugas.";
        else if (!tasks?.length)
          replyMessage = "Anda tidak memiliki tugas aktif.";
        else {
          replyMessage =
            "Tugas aktif:\n" +
            tasks
              .map(
                (t: any, i: number) =>
                  `${i + 1}. ${t.title} — ${new Date(t.deadline).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} (${t.reminder_days} hari sblm via ${t.remind_method})`
              )
              .join("\n");
        }
        break;
      }

      case "delete_task": {
        // Hapus dengan fuzzy title pendek dari `title` yang diparsing
        const term = String(task.title || "").trim();
        if (!term) {
          replyMessage = "Sebutkan judul tugas yang ingin dihapus.";
          break;
        }
        const { data: deleted, error } = await supabaseAdmin
          .from("tasks")
          .delete()
          .eq("user_id", userRow.id)
          .ilike("title", `%${term}%`)
          .select();
        replyMessage = error
          ? "Gagal menghapus tugas."
          : deleted?.length
            ? `✅ ${deleted.length} tugas yang memuat "${term}" dihapus.`
            : `Tugas dengan kata "${term}" tidak ditemukan.`;
        break;
      }

      case "update_task": {
        // Skeleton; bisa dilanjutkan (ubah deadline/reminder_days/remind_method)
        replyMessage =
          "Fitur ubah tugas segera hadir. Untuk sekarang, hapus lalu buat ulang ya.";
        break;
      }

      default:
        replyMessage =
          'Saya bisa: "tambah tugas ...", "lihat tugas", "hapus tugas ...", atau kalimat natural seperti "ingetin saya di tgl 30 agustus 1 hari sebelumnya".';
    }

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
