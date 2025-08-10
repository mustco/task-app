// app/api/nlu/reminder/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import dayjs from "dayjs";
import "dayjs/locale/id";
import customParse from "dayjs/plugin/customParseFormat";
import utc from "dayjs/plugin/utc";
import tzPlugin from "dayjs/plugin/timezone";
dayjs.extend(customParse);
dayjs.extend(utc);
dayjs.extend(tzPlugin);

const DEFAULT_TZ = process.env.DEFAULT_TZ || "Asia/Jakarta";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

// ---------- Schema (lebih toleran) ----------
const iso = z
  .string()
  .refine(
    (s) => typeof s === "string" && !Number.isNaN(Date.parse(s)),
    "Invalid datetime"
  );

const schema = z.object({
  intent: z.enum(["create_reminder", "unknown"]),
  title: z.string().min(1).max(120),
  event_time: iso.optional(),
  remind_time: iso,
  tz: z.string().default(DEFAULT_TZ),
  notes: z.string().optional(),
  confidence: z.number().min(0).max(1),
  needs_clarification: z.string().optional(),
});

// ---------- Helper: konversi teks tanggal Indonesia → ISO ----------
function toISO(input?: string, now = dayjs().tz(DEFAULT_TZ)) {
  if (!input) return undefined;
  const t = input.toLowerCase().trim();

  // relatif: besok / lusa
  const rel = /(besok|lusa)/.exec(t)?.[1];
  const relBase =
    rel === "besok"
      ? now.add(1, "day")
      : rel === "lusa"
        ? now.add(2, "day")
        : undefined;

  // jam (7 / 07:30 / 7.30)
  const time = /jam\s*(\d{1,2})(?:[:.](\d{1,2}))?/.exec(t);
  const hh = time ? Number(time[1]) : undefined;
  const mm = time ? Number(time[2] || 0) : undefined;

  // format absolut “28 Agustus 2025 07:00”, “28/08/2025 07:00”, “28 Agustus 07:00”
  const candidates = [
    "D MMMM YYYY HH:mm",
    "D MMMM YYYY H:mm",
    "DD/MM/YYYY HH:mm",
    "DD/MM/YYYY H:mm",
    "D MMMM HH:mm", // tanpa tahun → anggap tahun ini
    "D MMMM H:mm",
    "D MMMM YYYY", // tanpa jam
    "DD/MM/YYYY",
  ];

  let d: dayjs.Dayjs | undefined;

  // 1) absolute dengan locale Indonesia
  for (const fmt of candidates) {
    const parsed = dayjs(input, fmt, "id").tz(DEFAULT_TZ);
    if (parsed.isValid()) {
      d = parsed;
      // jika format tanpa tahun → pakai tahun sekarang
      if (!/Y/.test(fmt)) d = d.year(now.year());
      // jika format tanpa jam → default 09:00
      if (!/H/.test(fmt)) d = d.hour(9).minute(0).second(0);
      break;
    }
  }

  // 2) relatif + jam
  if (!d && relBase && hh != null) {
    d = relBase
      .hour(hh)
      .minute(mm || 0)
      .second(0);
  }

  // 3) hanya nama hari (minggu/senin/…)
  if (!d) {
    const hari = /(minggu|senin|selasa|rabu|kamis|jumat|jum'at|sabtu)/.exec(
      t
    )?.[1];
    if (hari) {
      const map: Record<string, number> = {
        minggu: 0,
        senin: 1,
        selasa: 2,
        rabu: 3,
        kamis: 4,
        jumat: 5,
        "jum'at": 5,
        sabtu: 6,
      };
      const target = map[hari];
      let base = now;
      // cari occurrence berikutnya
      while (base.day() !== target) base = base.add(1, "day");
      d = base
        .hour(hh ?? 9)
        .minute(mm ?? 0)
        .second(0);
    }
  }

  // 4) fallback hanya HH:mm → pakai hari ini
  if (!d && hh != null) {
    d = now
      .hour(hh)
      .minute(mm || 0)
      .second(0);
  }

  return d?.isValid() ? d.toDate().toISOString() : undefined;
}

// ---------- Gemini: paksa output JSON ----------
async function extractWithGemini(text: string, nowISO: string) {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json", // JSON murni
    },
  });

  const SYS = `
Kamu adalah parser pengingat berbahasa Indonesia.
Keluarkan JSON murni (tanpa markdown/penjelasan). Gunakan ISO 8601 RFC3339 lengkap (contoh 2025-08-28T07:00:00+07:00).
Field: intent("create_reminder"|"unknown"), title, event_time(optional ISO), remind_time(ISO), tz("${DEFAULT_TZ}"), confidence(0..1), needs_clarification(optional).
Jika kurang info, isi intent="unknown" dan needs_clarification.`;

  const prompt = [
    SYS,
    `NOW (ISO): ${nowISO}`,
    `TZ DEFAULT: ${DEFAULT_TZ}`,
    `USER: ${text}`,
    `Contoh keluaran: {"intent":"create_reminder","title":"meeting","event_time":"2025-06-02T08:00:00+07:00","remind_time":"2025-06-02T07:00:00+07:00","tz":"${DEFAULT_TZ}","confidence":0.9}`,
  ].join("\n");

  const resp = await model.generateContent(prompt);
  const json = resp.response.text(); // sudah JSON
  return JSON.parse(json);
}

// ---------- Handler ----------
export async function POST(req: NextRequest) {
  try {
    const { text, tz = DEFAULT_TZ } = await req.json();
    if (!text)
      return NextResponse.json({ error: "text required" }, { status: 400 });

    const nowISO = dayjs().tz(tz).toDate().toISOString();

    let raw = await extractWithGemini(text, nowISO);

    // Coerce: pastikan waktu ISO kalau model masih kasih teks
    if (!raw?.remind_time || Number.isNaN(Date.parse(raw.remind_time))) {
      raw.remind_time =
        toISO(raw.remind_time ?? text, dayjs(nowISO).tz(tz)) ||
        toISO(text, dayjs(nowISO).tz(tz));
    }
    if (raw?.event_time && Number.isNaN(Date.parse(raw.event_time))) {
      const coerced = toISO(raw.event_time, dayjs(nowISO).tz(tz));
      if (coerced) raw.event_time = coerced;
      else delete raw.event_time;
    }
    raw.tz = tz;

    // Validasi akhir
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          need: "clarify",
          data: raw,
          details: parsed.error.format(),
        },
        { status: 200 }
      );
    }

    const data = parsed.data;
    if (data.intent !== "create_reminder" || data.needs_clarification) {
      return NextResponse.json(
        { ok: false, need: "clarify", data },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    // kalau quota 429 dsb., balas sinyal aman
    if (e?.status === 429) {
      return NextResponse.json(
        { ok: false, need: "retry", reason: "quota" },
        { status: 429 }
      );
    }
    console.error(e);
    return NextResponse.json(
      { error: "nlu_failed", details: e.message },
      { status: 500 }
    );
  }
}
