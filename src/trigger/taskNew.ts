// src/trigger/task.ts

import { task } from "@trigger.dev/sdk/v3";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase/admin";

const resend = new Resend(process.env.RESEND_API_KEY);

// ===== Baileys config (ganti Fonnte) =====
const BAILEYS_BASE_URL = (process.env.BAILEYS_BASE_URL || "").replace(
  /\/+$/,
  ""
);
const BAILEYS_API_KEY = process.env.BAILEYS_API_KEY || "";

interface TaskPayload {
  taskId: string;
  title: string;
  description?: string;
  deadline: string; // ISO
  recipientEmail: string; // bisa kosong
  recipientPhone?: string;
  firstName: string;
}

/* ============ Utils ============ */
function to62Digits(input?: string | null): string | null {
  if (!input) return null;
  let s = String(input).trim();
  // keep digits & plus, lalu normalisasi
  s = s.replace(/[^\d+]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("0")) s = "62" + s.slice(1);
  if (!s.startsWith("62")) return null;
  // batas aman 8–15 digit
  if (!/^\d{8,15}$/.test(s)) return null;
  return s;
}

/* ============ Template WhatsApp (cached) ============ */
const createWhatsAppMessage = (() => {
  const memo = new Map<string, string>();
  return (p: {
    firstName: string;
    title: string;
    deadline: string;
    description?: string;
  }): string => {
    const key = `${p.firstName}-${p.title}-${p.deadline}-${p.description || ""}`;
    if (memo.has(key)) return memo.get(key)!;

    const formattedDeadline = new Date(p.deadline).toLocaleString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta", // pastikan WIB
    });

    let message = `*👋 Halo ${p.firstName || "User"}!*\n\n`;
    message += `*ListKu* bantu ingetin catatan penting kamu nih! 😌\n\n`;
    message += `📌 *Catatan:*\n${p.title}\n\n`;
    message += `⏰ *Deadline:*\n${formattedDeadline}\n\n`;

    if (p.description) {
      message += `📝 *Deskripsi:*\n_${p.description}_\n\n`;
    }

    message += `Ayo jangan lupa segera diselesaikan! 💪\n`;
    message += `🔗 https://listku.my.id/dashboard\n\n`;
    message += `Terima kasih sudah menggunakan *ListKu*! 🙌`;

    memo.set(key, message);
    return message;
  };
})();

/* ============ Kirim WA via Baileys (retry + timeout) ============ */
async function sendWhatsAppViaBaileys(
  phoneRaw: string,
  message: string,
  retries = 2
) {
  if (!BAILEYS_BASE_URL || !BAILEYS_API_KEY) {
    console.warn("BAILEYS_BASE_URL / BAILEYS_API_KEY belum di-set. Skip WA.");
    return { success: false, error: "Baileys not configured" };
  }

  const to = to62Digits(phoneRaw);
  if (!to) return { success: false, error: "Invalid phone number" };

  const url = `${BAILEYS_BASE_URL}/send`;
  console.log(`[WA->Baileys] POST ${url} to=${to}`);

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000); // 12s

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": BAILEYS_API_KEY, // sesuai service kamu
        },
        body: JSON.stringify({ to, text: message }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || data?.ok !== true) {
        const reason = data?.error || `HTTP ${resp.status}`;
        throw new Error(reason);
      }

      console.log(`✅ WhatsApp sent via Baileys on attempt ${attempt}`, data);
      return { success: true, data };
    } catch (e: any) {
      console.error(
        `❌ Baileys WA attempt ${attempt} failed:`,
        e?.message || e
      );
      if (attempt === retries + 1) {
        return { success: false, error: e?.message || "Unknown error" };
      }
      // exponential backoff
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }

  return { success: false, error: "Max retries exceeded" };
}

/* ============ Email (Resend) ============ */
async function sendEmailReminder(
  recipientEmail: string,
  payload: {
    firstName: string;
    title: string;
    deadline: string;
    description?: string;
  }
) {
  try {
    const { ReminderTemplate } = await import("@/components/email-template");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    const { data, error } = await resend.emails.send({
      from: "ListKu <reminders-noreply@listku.my.id>",
      to: [recipientEmail],
      subject: `⏰ Reminder: ${payload.title}`,
      react: ReminderTemplate({
        firstName: payload.firstName,
        title: payload.title,
        deadline: payload.deadline,
        description: payload.description,
      }),
    });

    clearTimeout(timeoutId);
    if (error) throw error;

    console.log(`✅ Email sent successfully to ${recipientEmail}`);
    return { success: true, id: data?.id };
  } catch (e: any) {
    console.error(
      `❌ Failed to send email to ${recipientEmail}:`,
      e?.message || e
    );
    return { success: false, error: e?.message || "Email error" };
  }
}

/* ============ Main task (parallel) ============ */
export const sendTaskReminder = task({
  id: "send-task-reminder",
  run: async (payload: TaskPayload) => {
    const start = Date.now();

    const jobs: Promise<any>[] = [];

    // Email
    if (payload.recipientEmail && payload.recipientEmail.trim() !== "") {
      jobs.push(
        sendEmailReminder(payload.recipientEmail, {
          firstName: payload.firstName,
          title: payload.title,
          deadline: payload.deadline,
          description: payload.description,
        }).then((result) => ({ type: "email", result }))
      );
    } else {
      console.log("No email recipient provided, skipping email notification");
    }

    // WhatsApp via Baileys
    if (payload.recipientPhone && payload.recipientPhone.trim() !== "") {
      const waMessage = createWhatsAppMessage({
        firstName: payload.firstName,
        title: payload.title,
        deadline: payload.deadline,
        description: payload.description,
      });

      jobs.push(
        sendWhatsAppViaBaileys(payload.recipientPhone, waMessage).then(
          (result) => ({
            type: "whatsapp",
            result,
          })
        )
      );
    } else {
      console.log(
        "No phone recipient provided, skipping WhatsApp notification"
      );
    }

    const results = await Promise.allSettled(jobs);

    let emailStatus: any = null;
    let whatsappStatus: any = null;

    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        if (r.value.type === "email") emailStatus = r.value.result;
        if (r.value.type === "whatsapp") whatsappStatus = r.value.result;
      } else {
        console.error(`Promise ${i} rejected:`, r.reason);
        if (i === 0) emailStatus = { success: false, error: r.reason?.message };
        if (i === 1)
          whatsappStatus = { success: false, error: r.reason?.message };
      }
    });

    // Update DB jika ada yang berhasil
    const anySuccess = emailStatus?.success || whatsappStatus?.success;
    if (anySuccess) {
      try {
        const updatePromise = supabaseAdmin
          .from("tasks")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", payload.taskId);

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Database update timeout")), 5000)
        );

        await Promise.race([updatePromise as any, timeoutPromise]);
        console.log(`✅ Task ${payload.taskId} reminder status updated`);
      } catch (e: any) {
        console.error("❌ Error updating task status:", e?.message || e);
      }
    }

    const ms = Date.now() - start;
    console.log(`📊 Task reminder completed in ${ms}ms`);

    return {
      success: anySuccess,
      taskId: payload.taskId,
      message: `Reminder attempt for: ${payload.title}`,
      email: emailStatus,
      whatsapp: whatsappStatus,
      sentVia: {
        email: !!emailStatus?.success,
        whatsapp: !!whatsappStatus?.success,
      },
      executionTime: ms,
    };
  },
});

/* ============ Scheduler ============ */
export async function scheduleTaskReminder(taskData: {
  id: string;
  title: string;
  description?: string;
  deadline: string; // ISO
  reminderDays: number; // H-X
  recipientEmail: string;
  recipientPhone?: string;
  firstName: string;
}) {
  const deadlineDate = new Date(taskData.deadline);
  const reminderDate = new Date(
    deadlineDate.getTime() - taskData.reminderDays * 24 * 60 * 60 * 1000
  );

  const now = new Date();
  const diff = reminderDate.getTime() - now.getTime();

  if (diff <= 0) {
    throw new Error(
      `Reminder time has already passed for task ${taskData.id}. ` +
        `Reminder was scheduled for ${reminderDate.toISOString()}, current time is ${now.toISOString()}`
    );
  }

  console.log(`📅 Scheduling reminder for task ${taskData.id}:`, {
    email: taskData.recipientEmail || "none",
    phone: taskData.recipientPhone || "none",
    reminderDate: reminderDate.toISOString(),
    timeUntilReminder: `${Math.round(diff / (1000 * 60 * 60))} hours`,
  });

  try {
    const handle = await sendTaskReminder.trigger(
      {
        taskId: taskData.id,
        title: taskData.title,
        description: taskData.description,
        deadline: taskData.deadline,
        recipientEmail: taskData.recipientEmail,
        recipientPhone: taskData.recipientPhone,
        firstName: taskData.firstName,
      },
      { delay: reminderDate }
    );

    console.log(`✅ Reminder scheduled successfully with handle: ${handle.id}`);
    return handle;
  } catch (e: any) {
    console.error(`❌ Failed to schedule reminder for task ${taskData.id}:`, e);
    throw new Error(`Scheduling failed: ${e?.message || e}`);
  }
}
