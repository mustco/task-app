// lib/gemini/client.ts - Token Optimized Version
import { GoogleGenerativeAI } from "@google/generative-ai";
import { TZ, ensureISOWIB, nowISO } from "@/lib/utils/time";

if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// TOKEN OPTIMIZATION: Create model with strict limits
const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-exp", // Use experimental for better efficiency
  generationConfig: {
    temperature: 0.1, // Lower = more deterministic = fewer retries
    maxOutputTokens: 200, // Reduced from 450
    responseMimeType: "application/json",
    candidateCount: 1, // Only one candidate
  },
});

// TOKEN OPTIMIZATION: Aggressive caching
const parseCache = new Map<string, { result: ParsedTask; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 1000;

// TOKEN OPTIMIZATION: Pre-categorize common patterns
const QUICK_PATTERNS = {
  greetings: /^(hi|hai|halo|hello|pagi|siang|malam)$/i,
  thanks: /^(thanks?|makasih|terima kasih|thx)$/i,
  help: /^(help|tutorial|panduan|cara|gimana)$/i,
  view: /^(lihat|cek|show|tampil).*(tugas|task)/i,
  delete: /^(hapus|delete|remove).*(tugas|task)/i,
};

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
    user_mood?:
      | "excited"
      | "stressed"
      | "casual"
      | "grateful"
      | "frustrated"
      | "confused";
    needs_encouragement?: boolean;
    needs_guidance?: boolean;
  };
}

// TOKEN OPTIMIZATION: Ultra-compact prompt
const buildCompactPrompt = (msg: string) => `
Parse Indonesian text to JSON. Now: ${nowISO().slice(0, 16)}. TZ: ${TZ}.

Rules:
- "tambah/ada X besok" → add_task
- "lihat tugas" → view_task  
- "hapus X" → delete_task
- Greeting/chat → none

JSON (minified):
{"action":"","title":"","description":"","deadline":"","reminder_days":0,"remind_method":"whatsapp","target_contact":"","conversation_context":{"is_casual_chat":false,"user_mood":"casual"}}

Parse: "${msg}"
`;

// TOKEN OPTIMIZATION: Pre-filter before Gemini call
function quickPatternMatch(msg: string): ParsedTask | null {
  const clean = msg.toLowerCase().trim();

  // Quick pattern matching to avoid Gemini calls
  if (QUICK_PATTERNS.greetings.test(clean)) {
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
      },
    };
  }

  if (QUICK_PATTERNS.thanks.test(clean)) {
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
        user_mood: "grateful",
      },
    };
  }

  if (QUICK_PATTERNS.help.test(clean)) {
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
        user_mood: "confused",
        needs_guidance: true,
      },
    };
  }

  if (QUICK_PATTERNS.view.test(clean)) {
    return {
      action: "view_task",
      title: "",
      description: null,
      deadline: null,
      reminder_days: 0,
      remind_method: "whatsapp",
      target_contact: null,
      conversation_context: {
        is_casual_chat: false,
        user_mood: "casual",
      },
    };
  }

  return null; // Needs Gemini processing
}

// TOKEN OPTIMIZATION: Smart cache cleanup
function cleanCache() {
  if (parseCache.size < MAX_CACHE_SIZE) return;

  const now = Date.now();
  const entries = Array.from(parseCache.entries());

  // Remove expired entries first
  entries.forEach(([key, value]) => {
    if (now - value.timestamp > CACHE_TTL) {
      parseCache.delete(key);
    }
  });

  // If still too large, remove oldest entries
  if (parseCache.size >= MAX_CACHE_SIZE) {
    const sorted = entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = sorted.slice(0, parseCache.size - MAX_CACHE_SIZE + 100);
    toRemove.forEach(([key]) => parseCache.delete(key));
  }
}

export async function parseTextWithGemini(
  message: string
): Promise<ParsedTask | null> {
  try {
    // TOKEN OPTIMIZATION: Normalize input for better caching
    const normalizedMsg = message.trim().toLowerCase();
    const cacheKey = normalizedMsg;

    // Check cache first
    const cached = parseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log("🎯 Cache hit - Gemini call saved!");
      return cached.result;
    }

    // TOKEN OPTIMIZATION: Quick pattern matching
    const quickResult = quickPatternMatch(message);
    if (quickResult) {
      console.log("⚡ Quick pattern match - Gemini call saved!");
      parseCache.set(cacheKey, { result: quickResult, timestamp: Date.now() });
      cleanCache();
      return quickResult;
    }

    // TOKEN OPTIMIZATION: Only call Gemini for complex parsing
    console.log("🤖 Calling Gemini for complex parsing...");

    const resp = (await Promise.race([
      model.generateContent([buildCompactPrompt(message)]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Gemini timeout")), 8000)
      ),
    ])) as any;

    const text = resp.response.text().trim();

    // TOKEN OPTIMIZATION: Robust JSON parsing
    let cleanText = text;
    if (text.startsWith("```json")) {
      cleanText = text.replace(/```json\s*|\s*```/g, "");
    }
    if (text.startsWith("```")) {
      cleanText = text.replace(/```\s*|\s*```/g, "");
    }

    const json = JSON.parse(cleanText) as ParsedTask;

    // Apply defaults and validation
    if (!json.action) json.action = "none";
    if (json.reminder_days == null || json.reminder_days < 0) {
      json.reminder_days = 0;
    }
    if (!json.remind_method) json.remind_method = "whatsapp";

    json.title = (json.title ?? "").trim();
    if (json.description !== null && json.description !== undefined) {
      json.description = String(json.description).trim() || null;
    }

    if (json.deadline) {
      json.deadline = ensureISOWIB(json.deadline, 9);
    }

    if (!json.conversation_context) {
      json.conversation_context = {
        is_casual_chat: json.action === "none",
        user_mood: "casual",
        needs_encouragement: false,
      };
    }

    // Validation by action
    switch (json.action) {
      case "view_task":
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
        break;
      default:
        return null;
    }

    // TOKEN OPTIMIZATION: Cache successful results
    parseCache.set(cacheKey, { result: json, timestamp: Date.now() });
    cleanCache();

    return json;
  } catch (e) {
    console.error("Gemini parse error:", e);

    // TOKEN OPTIMIZATION: Return safe fallback without retry
    const fallback: ParsedTask = {
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
      },
    };

    return fallback;
  }
}
