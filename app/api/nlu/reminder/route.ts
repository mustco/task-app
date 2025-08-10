import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import dayjs from "dayjs";
import "dayjs/locale/id";

const schema = z.object({
  intent: z.enum(["create_reminder", "unknown"]),
  title: z.string().min(1).max(120),
  event_time: z.string().datetime().optional(), // ISO
  remind_time: z.string().datetime(), // ISO
  tz: z.string().default("Asia/Jakarta"),
  notes: z.string().optional(),
  confidence: z.number().min(0).max(1),
  needs_clarification: z.string().optional(),
});

const SYS = `
Kamu adalah parser pengingat berbahasa Indonesia.
Tugas: ubah kalimat bebas menjadi JSON valid (bukan markdown).
Aturan:
- tz default "Asia/Jakarta".
- Gunakan format waktu ISO 8601 lengkap (contoh: 2025-08-28T07:00:00+07:00).
- Jika user bilang "besok/minggu depan/hari minggu besok", hitung relatif dari now.
- Jika hanya minta "ingetin jam 7" tanpa tanggal, anggap hari yang disebut (mis. "besok"); jika benar-benar tidak jelas, isi needs_clarification.
- intent: "create_reminder" kalau minta pengingat; selain itu "unknown".
- title ringkas: 2-5 kata, misal "meeting", "kerja kelompok", "ulang tahun".
- remind_time = kapan bot harus mengirim WA (boleh sama dengan event_time atau sebelumnya).
Keluarkan hanya JSON murni.
`;

async function extractWithGemini(text: string, nowISO: string) {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

  const prompt = [
    SYS,
    `NOW (ISO): ${nowISO}`,
    `USER: ${text}`,
    `Contoh keluaran:
{"intent":"create_reminder","title":"meeting","event_time":"2025-06-02T08:00:00+07:00","remind_time":"2025-06-02T07:00:00+07:00","tz":"Asia/Jakarta","confidence":0.9}`,
  ].join("\n");

  const resp = await model.generateContent(prompt);
  const out = resp.response.text().trim();

  // pastikan benar-benar JSON
  const jsonStart = out.indexOf("{");
  const jsonEnd = out.lastIndexOf("}");
  const jsonText = out.slice(jsonStart, jsonEnd + 1);

  return JSON.parse(jsonText);
}

export async function POST(req: NextRequest) {
  try {
    const { text, tz = "Asia/Jakarta" } = await req.json();
    if (!text)
      return NextResponse.json({ error: "text required" }, { status: 400 });

    const now = dayjs().locale("id");
    const raw = await extractWithGemini(text, now.toDate().toISOString());

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid LLM JSON", details: parsed.error.format() },
        { status: 422 }
      );
    }

    const data = parsed.data;

    // aturan bisnis kecil: kalau masih ambigu → minta klarifikasi
    if (data.intent !== "create_reminder" || data.needs_clarification) {
      return NextResponse.json({ ok: false, need: "clarify", data });
    }

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: "nlu_failed", details: e.message },
      { status: 500 }
    );
  }
}
