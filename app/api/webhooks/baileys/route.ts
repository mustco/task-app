// app/api/webhooks/wa/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureISOWIB } from "@/lib/utils/time";
import { phoneVariants } from "@/lib/utils/phone";
import { scheduleTaskReminder } from "../../../../src/trigger/task";
import validator from "validator";
import crypto from "node:crypto";
import { ratelimit } from "@/lib/upstash-ratelimit";

// ====== SECURITY CONFIG (Baileys → Next.js) ======
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ""; // <-- samakan dengan service Baileys
const MAX_SKEW_SEC = Number(process.env.WEBHOOK_MAX_SKEW_SEC || 300); // 5 menit

// HMAC: hex( HMAC_SHA256( WEBHOOK_SECRET, `${ts}.${rawBody}` ) )
function signBody(rawBody: string, ts: string) {
  const h = crypto.createHmac("sha256", WEBHOOK_SECRET);
  h.update(ts);
  h.update(".");
  h.update(rawBody);
  return h.digest("hex");
}

// constant-time compare
function safeEq(a: string, b: string) {
  const A = Buffer.from(a || "");
  const B = Buffer.from(b || "");
  if (A.length !== B.length) return false;
  try {
    return crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

// --- helpers (punyamu) ---
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

// ====== Schema payload dari service Baileys ======
const mediaSchema = z
  .object({
    kind: z.string().optional(), // "image" | "document" | "video" | ...
    url: z.string().url().optional(),
    data: z.string().optional(), // base64 (kalau kamu kirim inline)
    size: z.number().optional(),
    mimetype: z.string().optional(),
    fileName: z.string().optional(),
    sha256: z.string().optional(),
  })
  .partial();

const baileysSchema = z.object({
  event: z.literal("message"),
  instance: z.string(),
  messageId: z.string(),
  timestamp: z.union([z.number(), z.string()]).optional(),
  from: z.string(), // jidNormalizedUser, contoh: "62812xxxx@s.whatsapp.net" atau "62812xxxx"
  chatJid: z.string(),
  isGroup: z.boolean(),
  pushName: z.string().optional(),
  type: z.string(), // "text" | "imageMessage" | "documentMessage" | ...
  text: z.string().optional().default(""),
  media: mediaSchema.optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new NextResponse("OK", { status: 200 });
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: Request) {
  try {
    // ===== 0) SECURITY: HMAC header check =====
    if (!WEBHOOK_SECRET) {
      return NextResponse.json(
        { error: "Misconfig (secret)" },
        { status: 500 }
      );
    }
    const ts = request.headers.get("x-webhook-timestamp") || "";
    const sig = request.headers.get("x-webhook-signature") || "";
    const eventName = request.headers.get("x-webhook-event") || "";
    const idem = request.headers.get("x-webhook-id") || ""; // bisa dipakai untuk idempotensi

    // Ambil RAW body supaya signature valid
    const raw = await request.text();
    const expect = signBody(raw, ts);
    if (!safeEq(sig, expect)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    // Skew check
    const nowSec = Math.floor(Date.now() / 1000);
    const reqSec = Number(ts || 0);
    if (!reqSec || Math.abs(nowSec - reqSec) > MAX_SKEW_SEC) {
      return NextResponse.json({ error: "Timestamp skew" }, { status: 401 });
    }
    if (eventName !== "message") {
      // kita cuma handle pesan masuk
      return NextResponse.json({ status: "ignored", reason: "event" });
    }

    // Parse JSON setelah verifikasi
    let body: any = {};
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
    }

    const parsed = baileysSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // ===== 1) Normalisasi nomor pengirim =====
    const { from, text, isGroup } = parsed.data;
    const senderJid = String(from || "");
    // ambil hanya digit: "62812..." dari "62812...@s.whatsapp.net"
    const senderDigits = senderJid.replace(/[^\d]/g, "");
    const {
      e164,
      local,
      intlNoPlus,
      raw: rawVariant,
    } = phoneVariants(
      senderDigits
        ? `+${senderDigits.startsWith("62") ? senderDigits : senderDigits}`
        : senderJid
    );

    // ===== 2) Rate limit =====
    try {
      // Limit per instance atau jid chat
      const devKey = `baileys:chat:${parsed.data.chatJid}`;
      const rl1 = await ratelimit.limit(devKey);
      if (!rl1.success) {
        const retryAfter = Math.max(
          1,
          Math.ceil((rl1.reset - Date.now()) / 1000)
        );
        return new NextResponse(
          JSON.stringify({ error: "Too Many Requests (chat)" }),
          {
            status: 429,
            headers: { "Retry-After": String(retryAfter) },
          }
        );
      }

      // Limit per pengirim (user)
      const sKey = senderDigits || parsed.data.from;
      if (sKey) {
        const rl2 = await ratelimit.limit(`baileys:sender:${sKey}`);
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
      console.error("Webhook ratelimit error:", e);
    }

    // ===== 3) Commands (tutorial/help) =====
    const msgText = String(text || "").trim();
    const cmd = msgText.toLowerCase();
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
      // BALAS SINKRON lewat Baileys (replies array)
      return NextResponse.json({
        replies: [{ type: "text", text: HOWTO_TEXT }],
      });
    }

    // ===== 4) User lookup =====
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .in("phone_number", [e164, local, intlNoPlus, rawVariant])
      .maybeSingle();

    if (userErr) {
      return NextResponse.json({
        replies: [
          { type: "text", text: "Terjadi kesalahan mencari data pengguna." },
        ],
      });
    }
    if (!userRow?.id) {
      return NextResponse.json({
        replies: [
          {
            type: "text",
            text: "Nomor Anda tidak terdaftar. Silakan daftar melalui web terlebih dahulu.",
          },
        ],
      });
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
      body: JSON.stringify({ message: msgText }),
    });

    if (!nluRes.ok) {
      if (nluRes.status === 422) {
        return NextResponse.json({
          replies: [
            {
              type: "text",
              text: 'Sip! Untuk bikin tugas, coba: "tambah tugas bayar listrik besok jam 9" atau ketik "tutorial".',
            },
          ],
        });
      }
      return NextResponse.json({
        replies: [
          {
            type: "text",
            text: "Lagi ada gangguan memproses pesan. Coba lagi ya.",
          },
        ],
      });
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
      return NextResponse.json({
        replies: [
          {
            type: "text",
            text: 'Halo! Aku bisa bantu bikin & kelola tugas langsung dari WhatsApp. Ketik "tutorial" untuk memulai.',
          },
        ],
      });
    }

    // ===== 7) Business logic (sama seperti punyamu) =====
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

    // ===== 8) Balas sinkron ke Baileys service =====
    return NextResponse.json({
      replies: [{ type: "text", text: replyMessage }],
    });
  } catch (e) {
    console.error("Baileys webhook error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
