// app/api/webhooks/fonnte/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ===== Config =====
const TOKEN = process.env.FONNTE_WEBHOOK_TOKEN!;
const SEND_TOKEN = process.env.FONNTE_TOKEN || TOKEN; // fallback aman
const INTERNAL_SECRET = process.env.INTERNAL_CRON_SECRET!;
const BASE_URL =
  process.env.APP_PUBLIC_URL ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");
const ALLOWED_IPS = (process.env.FONNTE_IP_ALLOWLIST || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

// ===== Schema payload =====
const IncomingSchema = z.object({
  id: z.string().optional(),
  sender: z.string().optional(),
  phone: z.string().optional(),
  message: z.string().optional(),
  text: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
});

// ===== Utils =====
const ipAllowed = (req: NextRequest) => {
  if (ALLOWED_IPS.length === 0) return true;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  return ALLOWED_IPS.includes(ip);
};

const normalizePhone = (raw?: string | null) => {
  if (!raw) return undefined;
  let p = raw.replace(/[^\d+]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "62" + p.slice(1);
  return p;
};

async function replyViaFonnte(target62: string, message: string) {
  const form = new URLSearchParams();
  form.set("target", target62);
  form.set("message", message);
  try {
    const r = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: SEND_TOKEN,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureIdempotent(eventId?: string | null) {
  if (!eventId) return { ok: true };
  const { error } = await supabaseAdmin
    .from("webhook_events")
    .insert({ provider: "fonnte", event_id: eventId })
    .select("event_id")
    .single();
  // @ts-ignore 23505 = unique violation
  if (error?.code === "23505") return { ok: false, reason: "duplicate" };
  return { ok: !error, reason: error?.message };
}

async function simpleRateLimit(sender62: string) {
  const since = new Date(Date.now() - 60_000).toISOString(); // 1 menit
  const { count } = await supabaseAdmin
    .from("webhook_audit")
    .select("*", { count: "exact", head: true })
    .eq("sender", sender62)
    .gte("created_at", since);
  return (count ?? 0) <= 15;
}

// Parser sederhana
function parseIdText(text: string, now = new Date()) {
  const lower = text.toLowerCase();
  const base = new Date(now);
  if (lower.includes("lusa")) base.setDate(base.getDate() + 2);
  else if (lower.includes("besok")) base.setDate(base.getDate() + 1);
  const m = /jam\s*(\d{1,2})(?:[:.](\d{2}))?/.exec(lower);
  const h = m ? Math.min(23, Math.max(0, parseInt(m[1], 10))) : 9;
  const mm = m && m[2] ? Math.min(59, Math.max(0, parseInt(m[2], 10))) : 0;
  const deadline = new Date(base);
  deadline.setHours(h, mm, 0, 0);
  const reminderAt = new Date(deadline.getTime() - 60 * 60 * 1000);
  let title = "Task dari WhatsApp";
  const t = /(rapat|meeting|janji temu|appointment|presentasi|deadline)/.exec(
    lower
  );
  if (t)
    title = t[1] === "rapat" ? "Rapat" : t[1][0].toUpperCase() + t[1].slice(1);
  return {
    title,
    deadlineISO: deadline.toISOString(),
    reminderAtISO: reminderAt.toISOString(),
  };
}

const scheduleUrl = () =>
  new URL("/api/schedule-reminder", BASE_URL).toString();

// ===== Handlers =====
export async function GET(req: NextRequest) {
  // sebagian penyedia webhook test via GET
  const token = req.headers.get("token") || req.headers.get("authorization");
  if (!TOKEN || token !== TOKEN)
    return new NextResponse("unauthorized", { status: 401 });
  if (!ipAllowed(req)) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse("ok", { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    // 0) Auth by token
    const token = req.headers.get("token") || req.headers.get("authorization");
    if (!TOKEN || token !== TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // 1) IP allowlist (opsional)
    if (!ipAllowed(req)) {
      return NextResponse.json({ error: "Forbidden (IP)" }, { status: 403 });
    }
    // 2) Baca body: JSON / form-urlencoded
    let body: any = null;
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      body = await req.json();
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const fd = await req.formData();
      body = Object.fromEntries(fd.entries());
    } else {
      body = await req.json();
    }

    const parsed = IncomingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Bad payload" }, { status: 400 });
    }

    const eventId = parsed.data.id;
    const text = (parsed.data.message || parsed.data.text || "").slice(0, 500);
    const sender = normalizePhone(parsed.data.sender || parsed.data.phone);
    if (!sender || !text) return NextResponse.json({ ok: true });

    // 3) Idempotency
    const idem = await ensureIdempotent(eventId);
    if (!idem.ok) return NextResponse.json({ ok: true, dup: true });

    // 4) Rate limit + audit
    if (!(await simpleRateLimit(sender)))
      return NextResponse.json({ ok: true, throttled: true });
    await supabaseAdmin.from("webhook_audit").insert({
      provider: "fonnte",
      event_id: eventId || null,
      sender,
      body_sha256: createHash("sha256")
        .update(JSON.stringify(body))
        .digest("hex"),
    });

    // 5) Cek user & premium
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id, name, phone_number, email, is_premium")
      .eq("phone_number", sender)
      .maybeSingle();

    if (!user) {
      await replyViaFonnte(
        sender,
        "Nomormu belum terdaftar. Daftar di https://listku.my.id/register"
      );
      return NextResponse.json({ ok: true });
    }

    let isPremium = Boolean(user.is_premium);
    if (!isPremium) {
      const { data: sub } = await supabaseAdmin
        .from("subscriptions")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .gt("end_date", new Date().toISOString())
        .maybeSingle();
      isPremium = Boolean(sub);
    }
    if (!isPremium) {
      await replyViaFonnte(
        sender,
        "Fitur ini khusus pengguna Premium. Upgrade di https://listku.my.id/upgrade ✨"
      );
      return NextResponse.json({ ok: true });
    }

    // 6) Parse → task
    const { title, deadlineISO, reminderAtISO } = parseIdText(text);

    // 7) Insert task
    const { data: newTask, error: insErr } = await supabaseAdmin
      .from("tasks")
      .insert({
        user_id: user.id,
        title: title.slice(0, 255),
        description: `Dibuat via WhatsApp (${sender})`,
        deadline: new Date(deadlineISO).toISOString(),
        status: "pending",
        remind_method: "whatsapp",
        reminder_days: 0,
        target_phone: sender,
        target_email: null,
      })
      .select("id, title, deadline")
      .single();

    if (insErr || !newTask) {
      await replyViaFonnte(
        sender,
        "Maaf, gagal membuat catatan. Coba lagi ya."
      );
      return NextResponse.json({ ok: true });
    }

    // 8) Schedule reminder (mode secret)
    await fetch(scheduleUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ taskId: newTask.id, reminderAt: reminderAtISO }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    }).catch(() => null);

    // 9) Balas sukses
    const tglJam = new Date(deadlineISO).toLocaleString("id-ID", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    await replyViaFonnte(
      sender,
      `Siap! Aku bikin “${newTask.title}” utk ${tglJam}.`
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    // fail-closed untuk keamanan, tapi tetap 200 agar Fonnte tidak retry berulang
    console.error("Fonnte webhook error:", e);
    return NextResponse.json({ ok: true });
  }
}
