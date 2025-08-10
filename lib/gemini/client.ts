import { GoogleGenerativeAI } from "@google/generative-ai";
import { TZ, ensureISOWIB, nowISO } from "@/lib/utils/time";

if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    temperature: 0.15,
    maxOutputTokens: 400,
    responseMimeType: "application/json",
  },
});

export type Action = "add_task" | "update_task" | "view_task" | "delete_task";

export interface ParsedTask {
  action: Action;
  title: string;
  description: string | null;
  deadline: string | null; // ISO 8601 +07:00
  reminder_days: number; // default 1
  remind_method: "whatsapp" | "email" | "both";
  target_contact: string | null; // null → nanti server isi nomor pengirim
}

const buildPrompt = (msg: string) => `
Kamu parser Bahasa Indonesia informal untuk manajemen tugas WA.
Zona waktu: ${TZ}. Sekarang: ${nowISO()}.
BALAS **HANYA** JSON minified sesuai skema berikut (tanpa teks lain):

{"action":"","title":"","description":"","deadline":"","reminder_days":1,"remind_method":"","target_contact":""}

Aturan:
- action: add_task | update_task | view_task | delete_task.
  - Jika user bilang "ingatkan/ingetin" → add_task.
- title: ringkas & jelas, tanpa kata pengantar ("tolong", "dong", dsb).
- description: ringkas kalimat user (boleh null).
- deadline:
  - Weekday ("hari Selasa/Minggu") → occurrence terdekat >= sekarang, jam default 09:00 jika tak disebut.
  - Tanggal tanpa tahun → pakai tahun berjalan; jika sudah lewat hari ini, pakai tahun berikutnya.
  - Relatif ("besok/lusa/minggu depan") → konversi dari ${TZ}.
  - Jika user sebut jam (“jam 3 sore”) → gunakan itu.
  - Format **wajib** ISO 8601 dengan offset +07:00.
- reminder_days: dari frasa "ingetin X hari sebelumnya" (integer). Jika tak disebut → 1.
- remind_method: "whatsapp" jika platform WA, kecuali user minta email/both.
- target_contact: isi jika user menyebut nomor/email penerima spesifik; jika tidak, null.

Contoh:
USER: "hari minggu gua ada meet sama temen kantor, ingetin 2 hari sebelumnya"
{"action":"add_task","title":"Meet teman kantor","description":"Janji ketemu teman kantor hari Minggu","deadline":"(ISO WIB Minggu 09:00)","reminder_days":2,"remind_method":"whatsapp","target_contact":null}

USER: "ingetin saya 1 hari sebelumnya di tgl 30 agustus ya"
{"action":"add_task","title":"Pengingat","description":"Pengingat tanggal 30 Agustus","deadline":"(ISO WIB 30 Agustus 09:00)","reminder_days":1,"remind_method":"whatsapp","target_contact":null}
END PROMPT.
USER: ${msg}
JSON:
`;

export async function parseTextWithGemini(
  message: string
): Promise<ParsedTask | null> {
  try {
    const resp = await model.generateContent([buildPrompt(message)]);
    const text = resp.response.text().trim();
    const json = JSON.parse(text) as ParsedTask;

    // Hardening defaults
    if (!json.reminder_days || json.reminder_days < 0) json.reminder_days = 1;
    if (!json.remind_method) json.remind_method = "whatsapp";
    json.deadline = ensureISOWIB(json.deadline, 9);
    json.title = (json.title ?? "").trim();
    if (json.description !== null && json.description !== undefined) {
      json.description = String(json.description).trim();
    } else {
      json.description = null;
    }
    if (!json.action) json.action = "add_task";

    // Valid minimal
    if (!json.title || !json.deadline) return null;

    return json;
  } catch (e) {
    console.error("Gemini parse error:", e);
    return null;
  }
}
