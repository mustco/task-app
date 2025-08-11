//lib/gemini/client.ts
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
  reminder_days: number; // default 0
  remind_method: "whatsapp" | "email" | "both";
  target_contact: string | null; // null → nanti server isi nomor pengirim
}

const buildPrompt = (msg: string) => `
Kamu parser Bahasa Indonesia informal untuk manajemen tugas WA.
Zona waktu: ${TZ}. Sekarang: ${nowISO()}.
BALAS **HANYA** JSON minified sesuai skema berikut (tanpa teks lain):

{"action":"","title":"","description":"","deadline":"","reminder_days":0,"remind_method":"","target_contact":""}

Aturan:
- action: add_task | update_task | view_task | delete_task.
  - "ingatkan/ingetin/tambah tugas" → add_task.
  - "lihat tugas/daftar tugas" → view_task.
  - "hapus tugas N" atau "hapus tugas <kata kunci>" → delete_task.
- title: ringkas & jelas; untuk delete boleh angka indeks atau frasa judul.
- description: ringkas (boleh null).
- deadline:
  - Weekday → occurrence terdekat >= sekarang, jam default 09:00 jika tak disebut.
  - Tanggal tanpa tahun → tahun berjalan (kalau sudah lewat → tahun berikutnya).
  - Relatif ("besok/lusa/minggu depan") → konversi dari ${TZ}.
  - Jika user sebut jam (“jam 1 siang/13:00”) → gunakan itu.
  - Format **wajib** ISO 8601 offset +07:00.
- reminder_days: dari frasa "ingetin X hari sebelumnya" (default 0 = ingatkan pas waktu tugas).
- remind_method: "whatsapp" kecuali user minta email/both.
- target_contact: isi jika user menyebut nomor/email lain; jika tidak, null.

Contoh:
USER: "besok jam 1 ada meeting"
{"action":"add_task","title":"Meeting","description":"Meeting besok","deadline":"(ISO WIB besok 13:00)","reminder_days":0,"remind_method":"whatsapp","target_contact":null}

USER: "hari minggu gua ada meet sama temen kantor, ingetin 2 hari sebelumnya"
{"action":"add_task","title":"Meet teman kantor","description":"Janji ketemu teman kantor hari Minggu","deadline":"(ISO WIB Minggu 09:00)","reminder_days":2,"remind_method":"whatsapp","target_contact":null}

USER: "lihat tugas"
{"action":"view_task","title":"","description":null,"deadline":null,"reminder_days":0,"remind_method":"whatsapp","target_contact":null}

USER: "hapus tugas 3"
{"action":"delete_task","title":"3","description":null,"deadline":null,"reminder_days":0,"remind_method":"whatsapp","target_contact":null}
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

    // Defaults (jaga agar 0 tidak di-overwrite)
    if (json.reminder_days == null || json.reminder_days < 0)
      json.reminder_days = 0;
    if (!json.remind_method) json.remind_method = "whatsapp";

    json.title = (json.title ?? "").trim();
    if (json.description !== null && json.description !== undefined) {
      json.description = String(json.description).trim();
    } else {
      json.description = null;
    }
    if (!json.action) json.action = "add_task";

    // Normalisasi deadline hanya jika ada
    if (json.deadline) {
      json.deadline = ensureISOWIB(json.deadline, 9);
    }

    // Valid minimal per action
    switch (json.action) {
      case "view_task":
        // OK tanpa title/deadline
        break;
      case "delete_task":
        if (!json.title) return null; // angka indeks atau kata kunci
        break;
      case "update_task":
        if (!json.title) return null; // minimal butuh target (judul/kunci)
        break;
      case "add_task":
      default:
        if (!json.title || !json.deadline) return null;
        break;
    }

    return json;
  } catch (e) {
    console.error("Gemini parse error:", e);
    return null;
  }
}
