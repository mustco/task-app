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

// ---------- Schema: dua mode (reminder | chat) ----------------------------
const iso = z
  .string()
  .refine(
    (s) => typeof s === "string" && !Number.isNaN(Date.parse(s)),
    "Invalid datetime"
  );

const reminder = z.object({
  mode: z.literal("reminder"),
  intent: z.literal("create_reminder"),
  title: z.string().min(1).max(120),
  event_time: iso.optional(),
  remind_time: iso,
  tz: z.string().default(DEFAULT_TZ),
  notes: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

const chat = z.object({
  mode: z.literal("chat"),
  intent: z.literal("chitchat"),
  reply: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const schema = z.discriminatedUnion("mode", [reminder, chat]);

// ---------- Helper: konversi teks tanggal ID → ISO ------------------------
function toISO(input?: string, now = dayjs().tz(DEFAULT_TZ)) {
  if (!input) return undefined;
  const t = input.toLowerCase().trim();

  // terima besok/bsok/lusa
  const relWord = /(besok|bsok|lusa)/.exec(t)?.[1];
  const rel = relWord === "bsok" ? "besok" : relWord;
  const relBase =
    rel === "besok"
      ? now.add(1, "day")
      : rel === "lusa"
        ? now.add(2, "day")
        : undefined;

  // jam (7 / 07:30 / 7.30) + meridiem lokal
  const time = /jam\s*(\d{1,2})(?:[:.](\d{1,2}))?/.exec(t);
  const mer = /(pagi|siang|sore|malam)/.exec(t)?.[1] as
    | "pagi"
    | "siang"
    | "sore"
    | "malam"
    | undefined;
  const hh = time ? Number(time[1]) : undefined;
  const mm = time ? Number(time[2] || 0) : undefined;

  function applyMeridiem(d: dayjs.Dayjs) {
    if (!mer) return d;
    let h = d.hour();
    // jika user tulis 7 malam → 19
    if (mer === "pagi") h = h % 12; // 0–11
    if (mer === "siang") h = h === 12 ? 12 : (h % 12) + 12; // sekitar 12–15
    if (mer === "sore") h = (h % 12) + 12; // 15–18
    if (mer === "malam") h = (h % 12) + 12; // 18–23
    return d.hour(h);
  }

  // absolut (ID locale)
  const candidates = [
    "D MMMM YYYY HH:mm",
    "D MMMM YYYY H:mm",
    "DD/MM/YYYY HH:mm",
    "DD/MM/YYYY H:mm",
    "D MMMM HH:mm",
    "D MMMM H:mm",
    "D MMMM YYYY",
    "DD/MM/YYYY",
  ];

  let d: dayjs.Dayjs | undefined;

  for (const fmt of candidates) {
    const parsed = dayjs(input, fmt, "id").tz(DEFAULT_TZ);
    if (parsed.isValid()) {
      d = parsed;
      if (!/Y/.test(fmt)) d = d.year(now.year());
      if (!/H/.test(fmt)) d = d.hour(9).minute(0).second(0);
      d = applyMeridiem(d);
      break;
    }
  }

  // relatif + jam
  if (!d && relBase && hh != null) {
    d = relBase
      .hour(hh)
      .minute(mm || 0)
      .second(0);
    d = applyMeridiem(d);
  }

  // nama hari (boleh tanpa kata "hari")
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
      while (base.day() !== target) base = base.add(1, "day");
      d = base
        .hour(hh ?? 9)
        .minute(mm ?? 0)
        .second(0);
      d = applyMeridiem(d);
    }
  }

  // fallback hanya HH:mm → pakai hari ini
  if (!d && hh != null) {
    d = now
      .hour(hh)
      .minute(mm || 0)
      .second(0);
    d = applyMeridiem(d);
  }

  return d?.isValid() ? d.toDate().toISOString() : undefined;
}

// ---------- Gemini: router reminder/chat -----------------------------------
async function runGemini(text: string, nowISO: string) {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: { responseMimeType: "application/json" },
  });

  const SYS = `
Kamu adalah NLU + chatbot bahasa Indonesia.
KELUARKAN JSON MURNI (tanpa markdown).
Dua kemungkinan keluaran:
1) {"mode":"reminder","intent":"create_reminder","title":"...","event_time":"ISO optional","remind_time":"ISO","tz":"${DEFAULT_TZ}","confidence":0..1}
2) {"mode":"chat","intent":"chitchat","reply":"balasan natural ke user","confidence":0..1}

Aturan:
- Pahami bahasa sehari-hari, termasuk typo umum (besok/bsok), "lusa", nama hari tanpa "hari".
- Mengerti "pagi/siang/sore/malam".
- Jika kalimat TIDAK mengandung permintaan pengingat, pilih mode "chat".
- Gunakan ISO 8601 lengkap dengan offset zona.`;

  const prompt = [
    SYS,
    `NOW: ${nowISO} (${DEFAULT_TZ})`,
    `USER: ${text}`,
    `Contoh reminder: {"mode":"reminder","intent":"create_reminder","title":"rapat online","event_time":"2025-08-11T08:00:00+07:00","remind_time":"2025-08-11T07:00:00+07:00","tz":"${DEFAULT_TZ}","confidence":0.9}`,
    `Contoh chat: {"mode":"chat","intent":"chitchat","reply":"Siap, ada yang bisa kubantu?","confidence":0.9}`,
  ].join("\n");

  const resp = await model.generateContent(prompt);
  const json = resp.response.text(); // sudah berupa JSON
  return JSON.parse(json);
}

// ---------- Handler --------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const { text, tz = DEFAULT_TZ } = await req.json();
    if (!text)
      return NextResponse.json({ error: "text required" }, { status: 400 });

    const nowISO = dayjs().tz(tz).toDate().toISOString();

    let raw = await runGemini(text, nowISO);

    // Jika mode reminder → paksa waktu valid + fallback title
    if (raw?.mode === "reminder") {
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
      if (!raw?.title || !raw.title.trim()) {
        raw.title =
          text
            .replace(/\b(ingat(?:kan)?|tolong ingat(?:kan)?)\b/gi, "")
            .replace(
              /\b(hari\s+)?(minggu|senin|selasa|rabu|kamis|jum'?at|sabtu|depan)\b/gi,
              ""
            )
            .replace(
              /jam\s*\d{1,2}([:.]\d{1,2})?\s*(pagi|siang|sore|malam)?/gi,
              ""
            )
            .replace(/\b(besok|bsok|lusa)\b/gi, "")
            .replace(/\s+/g, " ")
            .trim() || "Pengingat";
      }
      raw.tz = tz;
    }

    // Validasi akhir (dua mode)
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          need: "clarify",
          data: raw,
          details: parsed.error.format(),
          message: "Informasinya belum lengkap.",
        },
        { status: 200 }
      );
    }

    const data = parsed.data;
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
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
