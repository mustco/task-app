import { NextRequest, NextResponse } from "next/server";

type FonnteWebhook = {
  device?: string;
  sender: string; // nomor pengirim WA (wajib)
  name?: string;
  message?: string; // text biasa
  text?: string; // tombol/interactive
  caption?: string; // caption media
  button?: string; // quick reply button label
  list?: string; // list selection label
  url?: string; // media inbound (kalau ada)
  filename?: string;
  extension?: string;
  location?: string; // "lat,lon"
  member?: string; // jika dari group
  inboxid?: string; // untuk quote reply
  secret?: string; // optional: secret dikirim via body
};

function pickText(b: Partial<FonnteWebhook>) {
  // ambil teks dari beberapa kandidat field
  const cand = [b.text, b.message, b.caption, b.button, b.list].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0
  );

  const raw = cand[0] ?? "";
  const norm = raw.toString().normalize("NFKC").replace(/\s+/g, " ").trim();

  return { raw, lower: norm.toLowerCase() };
}

// verifikasi sederhana: cocokkan body.secret / header x-fonnte-secret
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
  const t = setTimeout(() => controller.abort(), 10_000);

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

  // verifikasi asal webhook (opsional)
  if (!verifySecret(req, body)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  // guard minimal
  if (!body?.sender) {
    return NextResponse.json(
      { ok: false, error: "missing sender" },
      { status: 400 }
    );
  }

  // log ringkas untuk debug (hindari log token/PII)
  console.log(
    "[FONNTE IN]",
    JSON.stringify({
      sender: body.sender,
      keys: Object.keys(body),
    })
  );

  const name = body.name || "Kak";
  const { raw, lower: text } = pickText(body);
  let reply: string | undefined;

  // --- perintah debug untuk lihat key & isi raw text ---
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

  // --- router sederhana (contoh baseline) ---
  if (["hi", "halo", "hai"].includes(text)) {
    reply = `Halo ${name}, ada yang bisa kubantu? 👋\nKetik *menu* untuk bantuan.`;
  } else if (text === "menu") {
    reply =
      `📌 Menu cepat:\n` +
      `• Ketik *ingatkan besok jam 7 meeting* → bot jadwalkan pengingat\n` +
      `• Ketik *debug* → cek field payload yg diterima`;
  }

  // --- (opsional) kirim ke NLU/LLM kamu untuk ekstraksi reminder ---
  // contoh: kalau tidak match router sederhana, coba proses sebagai reminder bebas
  if (!reply && raw) {
    try {
      // kalau kamu punya endpoint NLU internal
      const h     = req.headers;
      const host  = h.get("x-forwarded-host") || h.get("host");
      const proto = h.get("x-forwarded-proto") || "https";
      const base  = `${proto}://${host}`; 
      const url   = `${base}/api/nlu/reminder`;


      // const app = process.env.APP_BASE_URL || "http://localhost:3000" || ;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // kirim raw text asli
        body: JSON.stringify({
          text: raw,
          tz: process.env.TZ || "Asia/Jakarta",
        }),
        // jangan bikin webhook lama: timeout singkat
        signal: AbortSignal.timeout(6000),
      });

      if (r.ok) {
        const data = await r.json();

        if (data?.ok) {
          const d = data.data as {
            title: string;
            event_time?: string;
            remind_time: string;
          };

          // TODO: di sini kamu bisa langsung:
          // - simpan ke DB (tasks)
          // - panggil Trigger.dev (scheduleTaskReminder)
          // Untuk demo kita balas konfirmasi saja:
          const when = new Date(d.remind_time).toLocaleString("id-ID");
          reply = `Siap! Aku ingetin **${d.title}** pada ${when} ✅`;
        } else if (data?.need === "clarify") {
          reply =
            `Bisa diperjelas waktunya? ${data?.data?.needs_clarification ?? ""}\n` +
            `Contoh: "hari Minggu jam 7 pagi" atau "28 Agustus jam 07.00".`;
        }
      }
    } catch (e) {
      console.warn("NLU call skipped/failed:", (e as Error).message);
    }
  }

  // fallback kalau tetap gak ada reply
  if (!reply) {
    reply = `Halo! Pesan kamu sudah kami terima ✅\nKetik *menu* untuk bantuan.`;
  }

  // --- kirim balasan ---
  try {
    await fonnteSend({
      target: body.sender,
      message: reply,
      inboxid: body.inboxid, // kalau Inbox aktif, ini akan nge-quote
      typing: true,
    });
  } catch (e) {
    console.error("send failed:", e);
    // tetap 200 supaya Fonnte tidak retry berlebihan
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
