// app/api/webhooks/fonnte/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureISOWIB } from "@/lib/utils/time";
import { phoneVariants } from "@/lib/utils/phone";
import { scheduleTaskReminder } from "../../../../src/trigger/task";
import validator from "validator";
import { timingSafeEqual } from "crypto";
import { ratelimit } from "@/lib/upstash-ratelimit"; // <- punyamu


// ====== SECURITY CONFIG ======
const WEBHOOK_SECRET = process.env.FONNTE_WEBHOOK_SECRET || "";
const ALLOWED_DEVICES = (process.env.FONNTE_DEVICE_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_IPS = (process.env.FONNTE_ALLOWED_IPS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// constant-time compare
function safeEq(a: string, b: string) {
  const A = Buffer.from(a || "");
  const B = Buffer.from(b || "");
  if (A.length !== B.length) return false;
  try {
    return timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

// read client IP from common proxies (Netlify/CF)
function getClientIP(req: Request) {
  const h = req.headers;
  return (
    h.get("x-nf-client-connection-ip") ||
    h.get("cf-connecting-ip") ||
    (h.get("x-forwarded-for") || "").split(",")[0].trim() ||
    h.get("x-real-ip") ||
    ""
  );
}

// --- helpers (punyamu)
const to62 = (p?: string | null) => {
  if (!p) return undefined;
  let s = String(p).replace(/[^\d+]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("0")) s = "62" + s.slice(1);
  return s.startsWith("62") ? s : s;
};

async function cancelTrigger(handleId?: string | null) {
  if (!handleId) return false;
  if (!process.env.TRIGGER_SECRET_KEY) {
    console.warn("TRIGGER_SECRET_KEY not set; skip cancel");
    return false;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(
      `https://api.trigger.dev/api/v2/runs/${handleId}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    return resp.ok;
  } catch (e) {
    clearTimeout(timeout);
    console.error("Cancel trigger failed:", e);
    return false;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new NextResponse("OK", { status: 200 });
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

const fonnteSchema = z.object({
  device_id: z.string(), // kita map dari device|deviceId juga
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

// label reminder cantik
const reminderLabel = (days: number, method: string) =>
  days === 0
    ? `saat waktu tugas via ${method}`
    : days === 1
      ? `1 hari sblm via ${method}`
      : `${days} hari sblm via ${method}`;

// Format tanggal: "26/08/2025, 19.09"
const fmtID = (iso: string) => {
  const d = new Date(iso);
  const date = d.toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = d
    .toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(":", ".");
  return `${date}, ${time}`;
};

// --- tutorial (paragraf singkat)
const HOWTO_TEXT = `📗 Panduan Bot Listku

➕ Tambah Tugas
• "besok jam 1 siang ada meeting" → diingatkan besok jam 1 siang  
• "tanggal 23 jam 1 siang mau mancing, ingetin 2 hari sebelumnya" → diingatkan 2 hari sebelumnya  
• "lusa ada acara keluarga" → Kalau tidak tulis jam maka akan diingatkan jam 9 pagi
• "ambil paket hari ini jam 1, tolong ingetin 1 hari sebelumnya" → tidak akan diingatkan karena sudah lewat

📋 Lihat Tugas
• "lihat tugas" atau "daftar tugas" → tampilkan semua tugas aktif

🗑️ Hapus Tugas
• "hapus tugas 3" → hapus sesuai nomor  
• "hapus tugas meeting" → hapus yang mengandung kata tersebut

ℹ️ Catatan
• Kalau tidak tulis “ingetin…”, pengingat akan dikirim tepat di waktu tugas  
• Bisa minta diingatkan X hari sebelumnya (hanya kelipatan hari, misal 1, 2, 3…)  
• Kalau waktu pengingat sudah lewat, akan diingatkan tepat di waktu tugas
• Bot ini hanya bisa mengingatkan via WhatsApp, tidak bisa email
`;

export async function POST(request: Request) {
  try {
    // ===== 0) SECURITY: Secret check =====
    const url = new URL(request.url);
    const providedSecret =
      url.searchParams.get("secret") ||
      request.headers.get("x-fonnte-secret") ||
      request.headers.get("x-webhook-secret") ||
      ""; // (hindari baca dari body sebelum valid, tapi boleh ditambah)

    if (!WEBHOOK_SECRET || !safeEq(providedSecret, WEBHOOK_SECRET)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // (opsional) IP allowlist
    if (ALLOWED_IPS.length) {
      const ip = getClientIP(request);
      if (!ip || !ALLOWED_IPS.includes(ip)) {
        return NextResponse.json({ error: "Forbidden (ip)" }, { status: 403 });
      }
    }

    // ===== 1) Parse body =====
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

    // ===== 2) SECURITY: Device check =====
    // Fonnte mengirim "device" (nomor WA). Kita map ke device_id untuk zod.
    const rawDevice =
      body.device ?? body.device_id ?? body.deviceId ?? body.deviceID ?? "";
    const device = String(rawDevice).replace(/[^\d]/g, ""); // normalisasi 628xxxx

    if (ALLOWED_DEVICES.length && !ALLOWED_DEVICES.includes(device)) {
      return NextResponse.json(
        { error: "Forbidden (device)" },
        { status: 403 }
      );
    }

    // map payload minimal untuk zod
    const payload = {
      device_id: device,
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
    const { e164, local, intlNoPlus, raw } = phoneVariants(sender);

    try {
      // limit per device (nomor WA bot kamu)
      const keyDevice = `fonnte:dev:${device || getClientIP(request) || "unknown"}`;
      const rl1 = await ratelimit.limit(keyDevice);
      if (!rl1.success) {
        const retryAfter = Math.max(
          1,
          Math.ceil((rl1.reset - Date.now()) / 1000)
        );
        return new NextResponse(
          JSON.stringify({ error: "Too Many Requests (device)" }),
          {
            status: 429,
            headers: { "Retry-After": String(retryAfter) },
          }
        );
      }

      // opsional: limit per device+sender (biar 1 user nggak spam)
      const senderKey = (sender || "").replace(/[^\d+]/g, "");
      if (senderKey) {
        const keyPair = `fonnte:dev:${device}:sender:${senderKey}`;
        const rl2 = await ratelimit.limit(keyPair);
        if (!rl2.success) {
          const retryAfter = Math.max(
            1,
            Math.ceil((rl2.reset - Date.now()) / 1000)
          );
          return new NextResponse(
            JSON.stringify({ error: "Too Many Requests (sender)" }),
            {
              status: 429,
              headers: { "Retry-After": String(retryAfter) },
            }
          );
        }
      }
    } catch (e) {
      // kalau upstash error, jangan matiin webhook—cukup log
      console.error("Webhook ratelimit error:", e);
    }
    // ===== 3) Command: tutorial/help =====
    const text = String(message || "").trim();
    const cmd = text.toLowerCase();
    if (
      [
        "!tutorial",
        "tutorial",
        "/help",
        "!help",
        "help",
        "!menu",
        "menu",
      ].includes(cmd)
    ) {
      await sendReply(sender, HOWTO_TEXT);
      return NextResponse.json({ status: "ok", handled: "tutorial" });
    }

    // ===== 4) User lookup =====
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .in("phone_number", [e164, local, intlNoPlus, raw])
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

    // ===== 5) NLU =====
    const nluUrl = new URL("/api/nlu", request.url);
    const nluRes = await fetch(nluUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_NLU_SECRET || "",
      },
      cache: "no-store",
      body: JSON.stringify({ message }),
    });

    if (!nluRes.ok) {
      if (nluRes.status === 422) {
        await sendReply(
          sender,
          'Sip! Untuk bikin tugas, coba: "tambah tugas bayar listrik besok jam 9" atau ketik "tutorial".'
        );
        return NextResponse.json({ status: "ignored" });
      }
      await sendReply(
        sender,
        "Lagi ada gangguan memproses pesan. Coba lagi ya."
      );
      return NextResponse.json({ error: "NLU failed" }, { status: 500 });
    }

    const task = await nluRes.json();

    // ===== 6) Default target & method =====
    let target_contact: string | null = task.target_contact || e164;
    let target_phone: string | null = target_contact?.startsWith("+62")
      ? target_contact.replace(/^\+62/, "0")
      : (target_contact ?? null);

    const remind_method: "whatsapp" | "email" | "both" =
      task.remind_method || "whatsapp";

    if (task.action === "none") {
      await sendReply(
        sender,
        'Halo! Aku bisa bantu bikin & kelola tugas langsung dari WhatsApp. Ketik "tutorial" untuk memulai.'
      );
      return NextResponse.json({ status: "ok", handled: "none" });
    }

    // ===== 7) Business logic (punyamu) — TIDAK DIUBAH =====
    let replyMessage = "Maaf, saya tidak mengerti maksud Anda.";

    switch (task.action) {
      case "add_task": {
        const title = String(task.title || "").trim();
        if (!title) {
          replyMessage = "Tolong sebutkan judul tugasnya.";
          break;
        }

        const deadlineISO = ensureISOWIB(task.deadline, 9);
        const reminderDays =
          task.reminder_days == null
            ? 0
            : Math.max(0, Math.trunc(Number(task.reminder_days)));

        const { data: inserted, error } = await supabaseAdmin
          .from("tasks")
          .insert([
            {
              user_id: userRow.id,
              title,
              description: task.description ?? null,
              deadline: deadlineISO,
              remind_method,
              reminder_days: reminderDays,
              target_contact,
              target_phone,
            },
          ])
          .select(
            "id, title, description, deadline, reminder_days, remind_method, target_email, target_phone, user_id"
          )
          .single();

        if (error || !inserted) {
          replyMessage = "Gagal menambahkan tugas.";
          break;
        }

        const { data: profile } = await supabaseAdmin
          .from("users")
          .select("name, email, phone_number")
          .eq("id", userRow.id)
          .single();

        let recipientEmail: string | undefined;
        let recipientPhone: string | undefined;

        if (
          inserted.remind_method === "email" ||
          inserted.remind_method === "both"
        ) {
          recipientEmail = inserted.target_email || profile?.email || undefined;
          if (recipientEmail && !validator.isEmail(recipientEmail))
            recipientEmail = undefined;
        }
        if (
          inserted.remind_method === "whatsapp" ||
          inserted.remind_method === "both"
        ) {
          recipientPhone = to62(
            inserted.target_phone || profile?.phone_number || e164
          );
          if (recipientPhone && !/^\d{8,15}$/.test(recipientPhone))
            recipientPhone = undefined;
        }

        const msDay = 24 * 60 * 60 * 1000;
        const deadlineDate = new Date(inserted.deadline);
        const intendedReminderDate = new Date(
          deadlineDate.getTime() - inserted.reminder_days * msDay
        );
        const now = new Date();

        let scheduled = false;
        let scheduleNote = "";
        let effectiveReminderDays = inserted.reminder_days;

        try {
          if (!(recipientEmail || recipientPhone)) {
            scheduleNote =
              "\n⚠️ Pengingat tidak dijadwalkan karena kontak tidak valid.";
          } else if (intendedReminderDate <= now) {
            if (deadlineDate <= now) {
              scheduleNote =
                "\n⚠️ Pengingat tidak dijadwalkan karena waktu pengingat dan deadlinenya sudah lewat.";
            } else {
              const handle = await scheduleTaskReminder({
                id: inserted.id,
                title: inserted.title,
                description: inserted.description ?? undefined,
                deadline: inserted.deadline,
                reminderDays: 0,
                recipientEmail: recipientEmail || "",
                recipientPhone: recipientPhone,
                firstName: (profile?.name || "User").split(" ")[0],
              });
              await supabaseAdmin
                .from("tasks")
                .update({ trigger_handle_id: handle.id, reminder_days: 0 })
                .eq("id", inserted.id);
              scheduled = true;
              effectiveReminderDays = 0;
              scheduleNote = `\nℹ️ Waktu pengingat H-${inserted.reminder_days} sudah lewat (seharusnya: ${fmtID(
                intendedReminderDate.toISOString()
              )}). Pengingat dijadwalkan saat deadline: ${fmtID(inserted.deadline)}.`;
            }
          } else {
            const handle = await scheduleTaskReminder({
              id: inserted.id,
              title: inserted.title,
              description: inserted.description ?? undefined,
              deadline: inserted.deadline,
              reminderDays: inserted.reminder_days,
              recipientEmail: recipientEmail || "",
              recipientPhone: recipientPhone,
              firstName: (profile?.name || "User").split(" ")[0],
            });
            await supabaseAdmin
              .from("tasks")
              .update({ trigger_handle_id: handle.id })
              .eq("id", inserted.id);
            scheduled = true;
          }
        } catch (e) {
          console.error("Schedule from webhook failed:", e);
          scheduleNote = "\n⚠️ Terjadi error saat penjadwalan.";
        }

        replyMessage =
          `✅ Tugas "${title}" dibuat. Reminder ${reminderLabel(
            effectiveReminderDays,
            inserted.remind_method
          )}.` + (scheduleNote || "");
        break;
      }

      case "view_task":
      case "view_tasks":
      case "view": {
        const { data: tasks, error } = await supabaseAdmin
          .from("tasks")
          .select("id, title, deadline, remind_method, reminder_days, status")
          .eq("user_id", userRow.id)
          .in("status", ["pending", "in_progress"])
          .order("created_at", { ascending: true });

        replyMessage = error
          ? "Gagal mengambil daftar tugas."
          : !tasks?.length
            ? "Anda tidak memiliki tugas aktif."
            : "Tugas aktif:\n" +
              tasks
                .map(
                  (t: any, i: number) =>
                    `${i + 1}. ${t.title} — ${fmtID(t.deadline)} (${reminderLabel(
                      t.reminder_days,
                      t.remind_method
                    )})`
                )
                .join("\n");
        break;
      }

      case "delete_task": {
        const term = String(task.title || "").trim();
        if (!term) {
          replyMessage = "Sebutkan nomor atau judul tugas yang ingin dihapus.";
          break;
        }

        const isIndex = /^\d+$/.test(term);

        if (isIndex) {
          const idx = parseInt(term, 10) - 1;
          const { data: list, error: listErr } = await supabaseAdmin
            .from("tasks")
            .select("id, title, trigger_handle_id")
            .eq("user_id", userRow.id)
            .in("status", ["pending", "in_progress"])
            .order("created_at", { ascending: true });

          if (listErr) {
            replyMessage = "Gagal mengambil daftar tugas.";
            break;
          }
          if (!list?.length) {
            replyMessage = "Tidak ada tugas aktif.";
            break;
          }
          if (idx < 0 || idx >= list.length) {
            replyMessage = `Nomor ${term} di luar jangkauan (1–${list.length}).`;
            break;
          }

          const target = list[idx];
          await cancelTrigger((target as any).trigger_handle_id);

          const { error: delErr } = await supabaseAdmin
            .from("tasks")
            .delete()
            .eq("id", target.id)
            .eq("user_id", userRow.id);

          replyMessage = delErr
            ? "Gagal menghapus tugas."
            : `✅ Tugas dihapus: "${target.title}".`;
          break;
        }

        const { data: matches, error: findErr } = await supabaseAdmin
          .from("tasks")
          .select("id, title, trigger_handle_id")
          .eq("user_id", userRow.id)
          .in("status", ["pending", "in_progress"])
          .ilike("title", `%${term}%`)
          .order("created_at", { ascending: true });

        if (findErr) {
          replyMessage = "Gagal mencari tugas.";
          break;
        }
        if (!matches?.length) {
          replyMessage = `Tugas dengan kata "${term}" tidak ditemukan.`;
          break;
        }

        await Promise.allSettled(
          matches.map((t) => cancelTrigger((t as any).trigger_handle_id))
        );

        const { data: deleted, error } = await supabaseAdmin
          .from("tasks")
          .delete()
          .eq("user_id", userRow.id)
          .ilike("title", `%${term}%`)
          .select("id");

        replyMessage = error
          ? "Gagal menghapus tugas."
          : deleted?.length
            ? `✅ ${deleted.length} tugas yang memuat "${term}" dihapus.`
            : `Tugas dengan kata "${term}" tidak ditemukan.`;
        break;
      }

      case "update_task": {
        replyMessage =
          "Fitur ubah tugas segera hadir. Untuk sekarang, hapus lalu buat ulang ya.";
        break;
      }

      default:
        replyMessage =
          'Aku bisa: "tambah tugas ...", "lihat tugas", "hapus tugas ...", atau ketik "tutorial" untuk panduan.';
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
