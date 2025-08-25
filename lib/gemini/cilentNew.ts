// lib/gemini/client.ts - Enhanced Natural NLU
import { GoogleGenerativeAI } from "@google/generative-ai";
import { TZ, ensureISOWIB, nowISO } from "@/lib/utils/time";

if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    temperature: 0.2, // lebih stabil untuk parsing tapi tetap fleksibel
    maxOutputTokens: 450,
    responseMimeType: "application/json",
  },
});

export type Action =
  | "add_task"
  | "update_task"
  | "view_task"
  | "delete_task"
  | "none";

export interface ParsedTask {
  action: Action;
  title: string;
  description: string | null;
  deadline: string | null;
  reminder_days: number;
  remind_method: "whatsapp" | "email" | "both";
  target_contact: string | null;
  conversation_context?: {
    is_casual_chat: boolean;
    user_mood?: "excited" | "stressed" | "casual" | "grateful" | "frustrated";
    needs_encouragement?: boolean;
  };
}

const buildEnhancedPrompt = (msg: string) => `
Kamu advanced NLU parser untuk AI assistant task management yang natural dan engaging.
Zona waktu: ${TZ}. Sekarang: ${nowISO()}.

TUGAS: Parse pesan informal Indonesia dan return JSON structure untuk conversational AI response.

OUTPUT WAJIB (JSON minified, no extra text):
{"action":"","title":"","description":"","deadline":"","reminder_days":0,"remind_method":"","target_contact":"","conversation_context":{"is_casual_chat":false,"user_mood":"casual","needs_encouragement":false,"needs_guidance":false}}

PARSING RULES:

1. ACTION DETECTION:
- "tambah/bikin/catat/ingetin tugas", "ada X besok" → add_task
- "lihat/cek/show tugas", "tugas apa aja" → view_task  
- "hapus tugas X", "cancel tugas Y" → delete_task
- Greeting, thanks, casual chat, out-of-scope → none

2. NATURAL LANGUAGE UNDERSTANDING:
- Handle variasi bahasa gaul: "gue ada meeting", "besok gw libur"  
- Detect implied tasks: "besok presentasi" → add_task: "Presentasi"
- Recognize time expressions: "nanti sore", "weekend ini", "senin depan"
- Parse reminder requests: "ingetin 2 hari sebelumnya", "jangan lupa reminder"

3. CONVERSATION CONTEXT (untuk natural responses):
- is_casual_chat: true jika bukan task command (greeting, thanks, small talk)
- user_mood: detect dari tone pesan
  * "excited": "Yes!", "finally!", "let's go!", "mantap!"
  * "stressed": "aduh", "cape", "banyak banget", "deadline", "pusing"
  * "grateful": "makasih", "thanks", "appreciate", "terima kasih"  
  * "frustrated": "susah", "ribet", "error", "gak bisa", "gimana sih"
  * "confused": "gimana", "caranya", "bingung", "gak ngerti", "help"
  * "casual": default untuk chat biasa
- needs_encouragement: true jika user terdengar overwhelmed/stressed
- needs_guidance: true jika user terdengar confused atau first-time user

4. DATETIME PARSING:
- Weekdays → next occurrence, default 09:00 if no time specified
- Relative: "besok" → tomorrow, "lusa" → day after tomorrow  
- Specific: "tanggal 25", "25 Agustus" 
- Time: "jam 2", "14:00", "sore" (17:00), "pagi" (09:00)
- Format output: ISO 8601 with +07:00 offset

5. SMART DEFAULTS:
- reminder_days: 0 (unless specified: "ingetin X hari sebelumnya")
- remind_method: "whatsapp" (unless email requested)
- description: extract from context or null
- target_contact: null (unless other person mentioned)

EXAMPLES:

USER: "halo listku"
→ {"action":"none","title":"","description":null,"deadline":null,"reminder_days":0,"remind_method":"whatsapp","target_contact":null,"conversation_context":{"is_casual_chat":true,"user_mood":"casual","needs_encouragement":false}}

USER: "aduh cape banget, deadline banyak"  
→ {"action":"none","title":"","description":null,"deadline":null,"reminder_days":0,"remind_method":"whatsapp","target_contact":null,"conversation_context":{"is_casual_chat":true,"user_mood":"stressed","needs_encouragement":true}}

USER: "besok gue ada meeting penting jam 2 siang"
→ {"action":"add_task","title":"Meeting penting","description":"Meeting penting besok siang","deadline":"2025-08-24T14:00:00+07:00","reminder_days":0,"remind_method":"whatsapp","target_contact":null,"conversation_context":{"is_casual_chat":false,"user_mood":"casual","needs_encouragement":false}}

USER: "ingetin gw weekend ini ada acara keluarga, 2 hari sebelumnya ya"
→ {"action":"add_task","title":"Acara keluarga","description":"Acara keluarga weekend ini","deadline":"2025-08-24T09:00:00+07:00","reminder_days":2,"remind_method":"whatsapp","target_contact":null,"conversation_context":{"is_casual_chat":false,"user_mood":"casual","needs_encouragement":false}}

USER: "gimana cara pakainya?"
→ {"action":"none","title":"","description":null,"deadline":null,"reminder_days":0,"remind_method":"whatsapp","target_contact":null,"conversation_context":{"is_casual_chat":true,"user_mood":"confused","needs_encouragement":false,"needs_guidance":true}}

USER: "halo"
→ {"action":"none","title":"","description":null,"deadline":null,"reminder_days":0,"remind_method":"whatsapp","target_contact":null,"conversation_context":{"is_casual_chat":true,"user_mood":"casual","needs_encouragement":false,"needs_guidance":true}}

USER: "makasih ya udah diingetin"
→ {"action":"none","title":"","description":null,"deadline":null,"reminder_days":0,"remind_method":"whatsapp","target_contact":null,"conversation_context":{"is_casual_chat":true,"user_mood":"grateful","needs_encouragement":false,"needs_guidance":false}}

USER: "apa itu cryptocurrency?"
→ {"action":"none","title":"","description":null,"deadline":null,"reminder_days":0,"remind_method":"whatsapp","target_contact":null,"conversation_context":{"is_casual_chat":true,"user_mood":"casual","needs_encouragement":false,"needs_guidance":false}}

Now parse this message:
USER: ${msg}
JSON:
`;

export async function parseTextWithGemini(
  message: string
): Promise<ParsedTask | null> {
  try {
    const resp = await model.generateContent([buildEnhancedPrompt(message)]);
    const text = resp.response.text().trim();
    const json = JSON.parse(text) as ParsedTask;

    // Validation & defaults
    if (!json.action) json.action = "none";
    if (json.reminder_days == null || json.reminder_days < 0) {
      json.reminder_days = 0;
    }
    if (!json.remind_method) json.remind_method = "whatsapp";

    // Clean strings
    json.title = (json.title ?? "").trim();
    if (json.description !== null && json.description !== undefined) {
      json.description = String(json.description).trim() || null;
    }

    // Normalize deadline if present
    if (json.deadline) {
      json.deadline = ensureISOWIB(json.deadline, 9);
    }

    // Ensure conversation_context exists with guidance flag
    if (!json.conversation_context) {
      json.conversation_context = {
        is_casual_chat: json.action === "none",
        user_mood: "casual",
        needs_encouragement: false,
        // needs_guidance: false,
      };
    }

    // Validation by action type
    switch (json.action) {
      case "view_task":
        // Always valid
        break;
      case "delete_task":
        if (!json.title) return null;
        break;
      case "update_task":
        if (!json.title) return null;
        break;
      case "add_task":
        if (!json.title || !json.deadline) return null;
        break;
      case "none":
        // Always valid - for conversations
        break;
      default:
        return null;
    }

    return json;
  } catch (e) {
    console.error("Enhanced Gemini parse error:", e);
    // Return safe fallback for conversation
    return {
      action: "none",
      title: "",
      description: null,
      deadline: null,
      reminder_days: 0,
      remind_method: "whatsapp",
      target_contact: null,
      conversation_context: {
        is_casual_chat: true,
        user_mood: "casual",
        needs_encouragement: false,
        // needs_guidance: false,
      },
    };
  }
}
