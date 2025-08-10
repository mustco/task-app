// app/api/webhooks/fonnte/route.ts
import { NextRequest, NextResponse } from "next/server";

// ---- Types ---------------------------------------------------------------
type FonnteWebhook = {
  device?: string;
  sender: string; // nomor WA pengirim (wajib)
  name?: string;
  message?: string; // pesan text biasa
  text?: string; // tombol / interactive
  caption?: string; // caption media
  button?: string; // quick reply label
  list?: string; // list selection label
  url?: string;
  filename?: string;
  extension?: string;
  location?: string;
  member?: string; // jika dari group
  inboxid?: string; // untuk quote reply
  secret?: string; // optional: secret via body
};

// ---- Helpers -------------------------------------------------------------
function pickText(b: Partial<FonnteWebhook>) {
  // pilih text dari beberapa candidate field
  const cand = [b.text, b.message, b.caption, b.button, b.list].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0
  );
  const raw = cand[0] ?? "";
  const norm = raw.toString().normalize("NFKC").replace(/\s+/g, " ").trim();
  return { raw, lower: norm.toLowerCase() };
}

function verifySecret(req: NextRequest, body: Partial<FonnteWebhook>) {
  const expected = process.env.FONNTE_WEBHOOK_SECRET;
  if (!expected) return true;
  if (body.secret && body.secret === expected) return true;
  const h =
    req.headers.get("x-fonnte-secret") || req.headers.get("x-fonnte-signature");
  if (h && h === expected) return true;
  return false;
}

async function fonnteSend(payload: {
  target: string;
  message?: string;
  url?: string;
  filename?: string;
  typing?: boolean;
  inboxid?: string;
}) {
  const token = process.env.FONNTE_API_TOKEN;
  if (!token) throw new Error("Missing FONNTE_API_TOKEN");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token, // TANPA "Bearer"
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.status === false) {
      throw new Error(json?.reason || `Fonnte send failed (${res.status})`);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

// ---- Route: POST ---------------------------------------------------------
export async function POST(req: NextRequest) {
  let body: FonnteWebhook;

  try {
    body = (await req.json()) as FonnteWebhook;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 }
    );
  }

  if (!verifySecret(req, body)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  if (!body?.sender) {
    return NextResponse.json(
      { ok: false, error: "missing sender" },
      { status: 400 }
    );
  }

  // log ringan
  console.log(
    "[FONNTE IN]",
    JSON.stringify({ sender: body.sender, keys: Object.keys(body) })
  );

  const name = body.name || "Kak";
  const { raw, lower: text } = pickText(body);
  let reply: string | undefined;

  // perintah bantuan sederhana
  if (["hi", "halo", "hai"].includes(text)) {
    reply = `Halo ${name}, ada yang bisa kubantu? 👋\nKetik *menu* untuk bantuan.`;
  } else if (text === "menu") {
    reply =
      `📌 Menu cepat:\n` +
      `• Tulis pengingat bebas: *"Ingetin besok jam 7 rapat online"* → aku pahami & jadwalkan\n` +
      `• Ketik *debug* → cek payload yang diterima`;
  }

  // debug: kirim balik sebagian payload
  if (text === "debug") {
    try {
      await fonnteSend({
        target: body.sender,
        message:
          `DEBUG ✅\nkeys: ${Object.keys(body).join(", ")}\n` +
          `raw: ${raw || "(kosong)"}\n` +
          `inboxid: ${body.inboxid || "(none)"}\n`,
        inboxid: body.inboxid,
      });
    } catch (e) {
      console.error("debug send failed", e);
    }
    return NextResponse.json({ ok: true });
  }

  // --- Jika belum ada jawaban, serahkan ke NLU (chatbot-first) -------------
  if (!reply && raw) {
    try {
      const h = req.headers;
      const host = h.get("x-forwarded-host") || h.get("host");
      const proto = h.get("x-forwarded-proto") || "https";
      const base = `${proto}://${host}`;
      const url = `${base}/api/nlu/reminder`;

      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: raw,
          tz: process.env.TZ || "Asia/Jakarta",
        }),
        signal: AbortSignal.timeout(12_000),
      });

      if (r.ok) {
        const data = await r.json();
        // log singkat tanpa PII
        console.log(
          "[NLU OUT]",
          JSON.stringify({
            ok: data?.ok,
            mode: data?.data?.mode,
            intent: data?.data?.intent,
          })
        );

        if (data?.ok && data?.data?.mode === "reminder") {
          const d = data.data as {
            title: string;
            event_time?: string;
            remind_time: string;
          };
          const when = new Date(d.remind_time).toLocaleString("id-ID");
          reply = `Siap! Aku ingetin **${d.title}** pada ${when} ✅`;
        } else if (data?.ok && data?.data?.mode === "chat") {
          reply = data.data.reply as string;
        } else if (data?.need === "clarify") {
          reply =
            `${data?.message || "Boleh diperjelas sedikit?"}\n` +
            `Contoh: "Minggu 07.00 upacara" atau "28/08 07:00 meeting".`;
        }
      }
    } catch (e) {
      console.warn("NLU call failed:", (e as Error).message);
    }
  }

  if (!reply) {
    reply = `Pesan kamu sudah kuterima ✅\nKetik *menu* untuk bantuan.`;
  }

  try {
    await fonnteSend({
      target: body.sender,
      message: reply,
      inboxid: body.inboxid,
      typing: true,
    });
  } catch (e) {
    console.error("send failed:", e);
  }

  return NextResponse.json({ ok: true });
}

// health check
export async function GET() {
  return NextResponse.json({ ok: true });
}
