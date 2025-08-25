// app/api/webhooks/baileys/route.ts - High Performance Optimized Version
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureISOWIB } from "@/lib/utils/time";
import { phoneVariants } from "@/lib/utils/phone";
import { scheduleTaskReminder } from "../../../../src/trigger/task";
import validator from "validator";
import crypto from "node:crypto";
import { ratelimit } from "@/lib/upstash-ratelimit";
import { generateConversationalReply } from "@/lib/gemini/reply";
import { parseTextWithGemini } from "@/lib/gemini/client";

// PERFORMANCE OPTIMIZATION: Enhanced security constants
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const MAX_SKEW_SEC = Number(process.env.WEBHOOK_MAX_SKEW_SEC || 300);

// PERFORMANCE OPTIMIZATION: Pre-compiled regex patterns
const PHONE_CLEANUP_REGEX = /[^\d+]/g;
const DIGITS_ONLY_REGEX = /^\d+$/;
const WA_JID_REGEX = /@s\.whatsapp\.net$/;

// PERFORMANCE OPTIMIZATION: Quick command detection (avoid Gemini calls)
const QUICK_COMMANDS = new Map([
  ["tutorial", "TUTORIAL"],
  ["!tutorial", "TUTORIAL"],
  ["help", "TUTORIAL"],
  ["!help", "TUTORIAL"],
  ["/help", "TUTORIAL"],
  ["menu", "TUTORIAL"],
  ["!menu", "TUTORIAL"],
  ["cara pakai", "TUTORIAL"],
  ["panduan", "TUTORIAL"],
  ["guide", "TUTORIAL"],
  ["lihat tugas", "VIEW_TASKS"],
  ["cek tugas", "VIEW_TASKS"],
  ["show tasks", "VIEW_TASKS"],
  ["daftar tugas", "VIEW_TASKS"],
]);

// PERFORMANCE OPTIMIZATION: Optimized tutorial text
const OPTIMIZED_TUTORIAL = `🤖 *Panduan ListKu AI Assistant*

➕ *Tambah Tugas*
• *besok jam 4 lewat 10 sore mau mancing ingetin* → Reminder besok jam 16.10 sore 
• *tanggal 23 desember stop langganan chatGPT, ingetin 2 hari sebelumnya* → Reminder H-2  
• *lusa ada acara keluarga* → Reminder default lusa jam saat ini
• *hari ini jam 1 ada paket, ingetin 1 hari sebelumnya* → ⚠️ Tidak bisa, karena waktu pengingat sudah lewat  
• *malam ini jam 8 ada meeting* → Reminder jam 20:00 WIB (tepat waktu)

📝 *Commands*
• *lihat tugas* → cek semua tugas aktif  
• *hapus tugas 1* → hapus berdasar nomor  
• *hapus meeting* → hapus berdasar kata kunci  

ℹ️ *Catatan*
• Reminder *belum bisa* untuk jam/menit spesifik → masih terbatas ke H-1, H-2, dst  
• +62 813-8692-6872 Jangan lupa simpan nomor ListKu ya biar gampang kirim pengingat ke kamu ✨
`;



// PERFORMANCE OPTIMIZATION: Security helpers with early returns
function signBody(rawBody: string, ts: string): string {
  const h = crypto.createHmac("sha256", WEBHOOK_SECRET);
  h.update(ts);
  h.update(".");
  h.update(rawBody);
  return h.digest("hex");
}

function safeEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  try {
    return crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

// PERFORMANCE OPTIMIZATION: Fast phone number processing
const to62 = (p?: string | null): string | undefined => {
  if (!p) return undefined;
  let s = String(p).replace(PHONE_CLEANUP_REGEX, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("0")) s = "62" + s.slice(1);
  return s.startsWith("62") && s.length >= 10 ? s : undefined;
};

// PERFORMANCE OPTIMIZATION: Batch database operations
async function batchCancelTriggers(
  handleIds: (string | null)[]
): Promise<void> {
  const validIds = handleIds.filter(Boolean) as string[];
  if (!validIds.length || !process.env.TRIGGER_SECRET_KEY) return;

  // Cancel in parallel with limited concurrency
  const batchSize = 5;
  for (let i = 0; i < validIds.length; i += batchSize) {
    const batch = validIds.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async (handleId) => {
        try {
          const controller = new AbortController();
          setTimeout(() => controller.abort(), 3000); // Shorter timeout

          const resp = await fetch(
            `https://api.trigger.dev/api/v2/runs/${handleId}/cancel`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
                "Content-Type": "application/json",
              },
              signal: controller.signal,
            }
          );
          return resp.ok;
        } catch {
          return false;
        }
      })
    );
  }
}

// PERFORMANCE OPTIMIZATION: Efficient task formatting
const reminderLabel = (days: number, method: string): string =>
  days === 0 ? `saat waktu via ${method}` : `H-${days} via ${method}`;

const fmtID = (iso: string): string => {
  const d = new Date(iso);
  const date = d.toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = d
    .toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(":", ".");
  return `${date}, ${time}`;
};

// PERFORMANCE OPTIMIZATION: Streamlined chunking
const MAX_MSG_CHARS = 3000; // Slightly reduced
const MAX_ITEMS = 15; // Reduced from 20

function chunkTasks(tasks: Array<any>): string[] {
  if (!tasks.length) return [];

  const lines = tasks.map(
    (t: any, i: number) =>
      `${i + 1}. ${t.title} — ${fmtID(t.deadline)} (${reminderLabel(t.reminder_days, t.remind_method)})`
  );

  const chunks: string[] = [];
  let currentChunk = `Tugas aktif (${tasks.length}):\n`;

  for (const line of lines) {
    const testChunk = currentChunk + line + "\n";
    if (testChunk.length > MAX_MSG_CHARS) {
      if (currentChunk.trim() !== `Tugas aktif (${tasks.length}):`) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = line + "\n";
    } else {
      currentChunk = testChunk;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// PERFORMANCE OPTIMIZATION: Baileys schema with strict validation
const baileysSchema = z.object({
  event: z.literal("message"),
  instance: z.string().max(50),
  messageId: z.string().max(100),
  timestamp: z.union([z.number(), z.string()]).optional(),
  from: z.string().max(50),
  chatJid: z.string().max(50),
  isGroup: z.boolean(),
  pushName: z.string().max(100).optional(),
  type: z.string().max(20),
  text: z.string().max(1000).optional().default(""), // Limit message length
  media: z.any().optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new NextResponse("OK", { status: 200 });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    // PERFORMANCE OPTIMIZATION: Early validation
    if (!WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Misconfig" }, { status: 500 });
    }

    // PERFORMANCE OPTIMIZATION: Headers validation
    const headers = {
      timestamp: request.headers.get("x-webhook-timestamp") || "",
      signature: request.headers.get("x-webhook-signature") || "",
      event: request.headers.get("x-webhook-event") || "",
    };

    if (headers.event !== "message") {
      return NextResponse.json({ status: "ignored" });
    }

    // PERFORMANCE OPTIMIZATION: Signature verification
    const raw = await request.text();
    if (raw.length > 5000) {
      // Prevent oversized payloads
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    const expectedSig = signBody(raw, headers.timestamp);
    if (!safeEq(headers.signature, expectedSig)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // PERFORMANCE OPTIMIZATION: Time skew check
    const nowSec = Math.floor(Date.now() / 1000);
    const reqSec = Number(headers.timestamp || 0);
    if (!reqSec || Math.abs(nowSec - reqSec) > MAX_SKEW_SEC) {
      return NextResponse.json({ error: "Timestamp skew" }, { status: 401 });
    }

    // PERFORMANCE OPTIMIZATION: Parse JSON with error handling
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = baileysSchema.safeParse(body);
    if (!parsed.success) {
      console.error("Schema validation failed:", parsed.error.issues);
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    if (parsed.data.isGroup) {
      return NextResponse.json({ status: "ignored", reason: "group message" });
    }

    const { from, text } = parsed.data;
    const msgText = String(text || "").trim();

    if (!msgText) {
      return NextResponse.json({ status: "ignored", reason: "empty message" });
    }

    // PERFORMANCE OPTIMIZATION: Extract sender info
    const senderJid = String(from || "");
    const senderDigits = senderJid
      .replace(WA_JID_REGEX, "")
      .replace(PHONE_CLEANUP_REGEX, "");
    const variants = phoneVariants(
      senderDigits ? `+${senderDigits}` : senderJid
    );

    // PERFORMANCE OPTIMIZATION: Rate limiting with shorter timeout
    try {
      const [chatLimit, senderLimit] = await Promise.all([
        ratelimit.limit(`baileys:chat:${parsed.data.chatJid}`),
        senderDigits
          ? ratelimit.limit(`baileys:sender:${senderDigits}`)
          : { success: true },
      ]);

      if (!chatLimit.success || !senderLimit.success) {
        const retryAfter = Math.max(
          1,
          Math.ceil((chatLimit.reset - Date.now()) / 1000)
        );
        return new NextResponse(JSON.stringify({ error: "Rate limited" }), {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        });
      }
    } catch (e) {
      console.error("Rate limit error:", e);
      // Continue processing if rate limiting fails
    }

    // PERFORMANCE OPTIMIZATION: Quick command detection
    const lowerMsg = msgText.toLowerCase().trim();
    const quickCmd = QUICK_COMMANDS.get(lowerMsg);

    if (quickCmd === "TUTORIAL") {
      return NextResponse.json({
        replies: [{ type: "text", text: OPTIMIZED_TUTORIAL }],
      });
    }

    // PERFORMANCE OPTIMIZATION: User lookup with specific columns
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id, name, email, phone_number")
      .in("phone_number", [
        variants.e164,
        variants.local,
        variants.intlNoPlus,
        variants.raw,
      ])
      .maybeSingle();

    if (userErr) {
      console.error("User lookup error:", userErr);
      return NextResponse.json({
        replies: [
          { type: "text", text: "Oops, technical issue! Try again? 🙏" },
        ],
      });
    }

    if (!userRow?.id) {
      // ✨ jangan balas ke siapapun jika nomor tidak dikenal
      return NextResponse.json({ status: "ignored", reason: "unregistered sender" });
    }
    

    // PERFORMANCE OPTIMIZATION: Handle quick view command
    if (quickCmd === "VIEW_TASKS") {
      const { data: tasks, error } = await supabaseAdmin
        .from("tasks")
        .select("id, title, deadline, remind_method, reminder_days")
        .eq("user_id", userRow.id)
        .in("status", ["pending", "in_progress"])
        .order("created_at", { ascending: true })
        .limit(50); // Limit results

      if (error) {
        return NextResponse.json({
          replies: [{ type: "text", text: "Error getting tasks 😅" }],
        });
      }

      if (!tasks?.length) {
        return NextResponse.json({
          replies: [
            {
              type: "text",
              text: "Clean slate! No pending tasks 🎉 Add something?",
            },
          ],
        });
      }

      const chunks = chunkTasks(tasks);
      const replies = chunks.map((chunk) => ({ type: "text", text: chunk }));

      if (tasks.length <= 5) {
        replies.push({
          type: "text",
          text: 'Need to remove any? Say "hapus tugas 2" 😊',
        });
      }

      return NextResponse.json({ replies });
    }

    // PERFORMANCE OPTIMIZATION: NLU processing with timeout
    let task: any;
    try {
      // Use our optimized parser directly
      task = await Promise.race([
        parseTextWithGemini(msgText),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("NLU timeout")), 10000)
        ),
      ]);

      if (!task) {
        throw new Error("No parse result");
      }
    } catch (e) {
      console.error("NLU processing failed:", e);
      return NextResponse.json({
        replies: [
          {
            type: "text",
            text: 'Hmm, kurang nangkep 😅 Coba "besok meeting jam 2" atau "tutorial"!',
          },
        ],
      });
    }

    // PERFORMANCE OPTIMIZATION: Process task actions
    const firstName = (userRow.name || "User").split(" ")[0];
    let replyText = "Hmm, ada yang aneh nih 🤔";

    try {
      switch (task.action) {
        case "add_task": {
          if (!task.title || !task.deadline) {
            replyText =
              "Title sama deadline-nya kurang jelas nih. Coba spesifik? 😊";
            break;
          }

          const deadlineISO = ensureISOWIB(task.deadline, 9);
          const reminderDays = Math.max(
            0,
            Math.trunc(Number(task.reminder_days) || 0)
          );

          // PERFORMANCE OPTIMIZATION: Single insert with returning
          const { data: inserted, error } = await supabaseAdmin
            .from("tasks")
            .insert([
              {
                user_id: userRow.id,
                title: task.title.slice(0, 200), // Truncate long titles
                description: task.description?.slice(0, 500) || null,
                deadline: deadlineISO,
                remind_method: task.remind_method || "whatsapp",
                reminder_days: reminderDays,
                target_contact: variants.e164,
                target_phone: to62(variants.e164),
              },
            ])
            .select("id, title, deadline, reminder_days, remind_method")
            .single();

          if (error || !inserted) {
            replyText = "Error saving task 😅 Try again?";
            break;
          }

          // PERFORMANCE OPTIMIZATION: Schedule reminder with error handling
          try {
            const recipientPhone = to62(userRow.phone_number || variants.e164);
            const deadlineDate = new Date(inserted.deadline);
            const now = new Date();
            const reminderDate = new Date(
              deadlineDate.getTime() - reminderDays * 24 * 60 * 60 * 1000
            );

            let effectiveReminderDays = reminderDays;
            let scheduleNote = "";

            if (recipientPhone && reminderDate > now && deadlineDate > now) {
              const handle = await scheduleTaskReminder({
                id: inserted.id,
                title: inserted.title,
                description: task.description || undefined,
                deadline: inserted.deadline,
                reminderDays: reminderDays,
                recipientEmail: "",
                recipientPhone: recipientPhone,
                firstName: firstName,
              });

              await supabaseAdmin
                .from("tasks")
                .update({ trigger_handle_id: handle.id })
                .eq("id", inserted.id);
            } else if (deadlineDate <= now) {
              scheduleNote = " (Eh, waktu udah lewat, reminder gak tersimpan 😅)";
            } else if (reminderDate <= now) {
              effectiveReminderDays = 0;
              scheduleNote = " (Reminder disesuaikan jadi pas deadline)";
            }

            replyText =
              `Perfect! "${inserted.title}" tercatat untuk ${fmtID(inserted.deadline)}. ` +
              `Reminder ${reminderLabel(effectiveReminderDays, inserted.remind_method)}!${scheduleNote}`;
          } catch (scheduleErr) {
            console.error("Scheduling failed:", scheduleErr);
            replyText = `"${inserted.title}" tersimpan! Tapi reminder ada masalah. Manual check ya 😊`;
          }
          break;
        }

        case "view_task": {
          // Already handled above for quick commands
          replyText = "Use 'lihat tugas' to view your tasks 📋";
          break;
        }

        case "delete_task": {
          const term = String(task.title || "").trim();
          if (!term) {
            replyText = "Mau hapus yang mana? Kasih nomor atau keyword 🤔";
            break;
          }

          const isIndex = DIGITS_ONLY_REGEX.test(term);

          if (isIndex) {
            // PERFORMANCE OPTIMIZATION: Delete by index with single query
            const idx = parseInt(term, 10) - 1;
            const { data: tasks } = await supabaseAdmin
              .from("tasks")
              .select("id, title, trigger_handle_id")
              .eq("user_id", userRow.id)
              .in("status", ["pending", "in_progress"])
              .order("created_at", { ascending: true })
              .limit(20);

            if (!tasks?.length) {
              replyText = "No tasks to delete! 🎉";
              break;
            }

            if (idx < 0 || idx >= tasks.length) {
              replyText = `Number ${term} out of range (1-${tasks.length}) 🤷‍♀️`;
              break;
            }

            const target = tasks[idx];

            // PERFORMANCE OPTIMIZATION: Parallel delete and cancel
            const [deleteResult] = await Promise.allSettled([
              supabaseAdmin
                .from("tasks")
                .delete()
                .eq("id", target.id)
                .eq("user_id", userRow.id),
              batchCancelTriggers([target.trigger_handle_id]),
            ]);

            if (
              deleteResult.status === "fulfilled" &&
              !deleteResult.value.error
            ) {
              replyText = `Done! Removed "${target.title}" ✨`;
            } else {
              replyText = "Failed to delete task 😅";
            }
          } else {
            // PERFORMANCE OPTIMIZATION: Delete by keyword
            const { data: matches } = await supabaseAdmin
              .from("tasks")
              .select("id, title, trigger_handle_id")
              .eq("user_id", userRow.id)
              .in("status", ["pending", "in_progress"])
              .ilike("title", `%${term}%`)
              .limit(10);

            if (!matches?.length) {
              replyText = `No tasks found with "${term}" 🔍`;
              break;
            }

            // PERFORMANCE OPTIMIZATION: Batch operations
            const handleIds = matches.map((m) => m.trigger_handle_id);
            const [deleteResult] = await Promise.allSettled([
              supabaseAdmin
                .from("tasks")
                .delete()
                .eq("user_id", userRow.id)
                .ilike("title", `%${term}%`)
                .select("id"),
              batchCancelTriggers(handleIds),
            ]);

            const count =
              deleteResult.status === "fulfilled"
                ? deleteResult.value.data?.length || 0
                : 0;

            if (count > 0) {
              replyText =
                count === 1
                  ? `Perfect! Removed 1 task with "${term}" ✨`
                  : `Nice! Removed ${count} tasks with "${term}" 🎯`;
            } else {
              replyText = "Failed to delete tasks 😅";
            }
          }
          break;
        }

        case "none":
        default: {
          // PERFORMANCE OPTIMIZATION: Use our optimized reply generator
          const nlgResult = {
            ok: true,
            summary: "Conversational response needed",
            conversation_context: task.conversation_context,
          };

          replyText = await generateConversationalReply({
            userMessage: msgText,
            action: "none",
            result: nlgResult,
            style: { withEmoji: true },
          });
          break;
        }
      }
    } catch (actionError) {
      console.error("Action processing error:", actionError);
      replyText = "Something went wrong 😅 Try again?";
    }

    // PERFORMANCE OPTIMIZATION: Log performance metrics
    const processingTime = Date.now() - startTime;
    console.log(`✅ Webhook processed in ${processingTime}ms`);

    return NextResponse.json({
      replies: [{ type: "text", text: replyText }],
    });
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ Webhook error after ${processingTime}ms:`, error);

    return NextResponse.json(
      {
        replies: [
          {
            type: "text",
            text: "Oops, technical hiccup! Try again? 🔧",
          },
        ],
      },
      { status: 500 }
    );
  }
}
