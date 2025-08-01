// src/trigger/task.ts

import { task } from "@trigger.dev/sdk/v3";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase/admin";

const resend = new Resend(process.env.RESEND_API_KEY);
const fonnteToken = process.env.FONNTE_API_TOKEN;

interface TaskPayload {
  taskId: string;
  title: string;
  description?: string;
  deadline: string;
  recipientEmail: string;
  recipientPhone?: string;
  firstName: string;
}

// ✅ OPTIMIZATION 1: Cached message template function
const createWhatsAppMessage = (() => {
  const memoizedMessages = new Map<string, string>();

  return (payload: {
    firstName: string;
    title: string;
    deadline: string;
    description?: string;
  }): string => {
    const key = `${payload.firstName}-${payload.title}-${payload.deadline}-${payload.description || ""}`;

    if (memoizedMessages.has(key)) {
      return memoizedMessages.get(key)!;
    }

    const formattedDeadline = new Date(payload.deadline).toLocaleString(
      "id-ID",
      {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }
    );

    let message = `*👋 Halo ${payload.firstName || "User"}!*\n\n`;
    message += `*ListKu* bantu ingetin catatan penting kamu nih! 😌\n\n`;
    message += `📌 *Catatan:*\n${payload.title}\n\n`;
    message += `⏰ *Deadline:*\n${formattedDeadline}\n\n`;

    if (payload.description) {
      message += `📝 *Deskripsi:*\n_${payload.description}_\n\n`;
    }

    message += `Ayo jangan lupa segera diselesaikan! 💪\n`;
    message += `🔗 https://listku.my.id/dashboard\n\n`;
    message += `Terima kasih sudah menggunakan *ListKu*! 🙌`;

    memoizedMessages.set(key, message);
    return message;
  };
})();

// ✅ OPTIMIZATION 2: Improved WhatsApp sending with retry logic
async function sendWhatsAppReminder(
  phone: string,
  message: string,
  retries = 2
) {
  if (!fonnteToken) {
    console.warn(
      "FONNTE_API_TOKEN is not set. Skipping WhatsApp notification."
    );
    return { success: false, error: "Fonnte token not configured." };
  }

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: fonnteToken,
        },
        body: JSON.stringify({
          target: phone,
          message: message,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const result = await response.json();

      if (!response.ok || result.status === false) {
        throw new Error(
          `Failed to send WhatsApp: ${result.reason || "Unknown error"}`
        );
      }

      console.log(
        `✅ WhatsApp message sent successfully on attempt ${attempt}:`,
        result
      );
      return { success: true, data: result };
    } catch (error: any) {
      console.error(`❌ WhatsApp attempt ${attempt} failed:`, error.message);

      if (attempt === retries + 1) {
        return { success: false, error: error.message };
      }

      // Wait before retry (exponential backoff)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }

  return { success: false, error: "Max retries exceeded" };
}

// ✅ OPTIMIZATION 3: Improved email sending with better error handling
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
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for email

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
  } catch (error: any) {
    console.error(
      `❌ Failed to send email to ${recipientEmail}:`,
      error.message
    );
    return { success: false, error: error.message };
  }
}

// ✅ OPTIMIZATION 4: Main task with parallel execution
export const sendTaskReminder = task({
  id: "send-task-reminder",
  run: async (payload: TaskPayload) => {
    const startTime = Date.now();

    // ✅ OPTIMIZATION 5: Parallel execution of email and WhatsApp
    const promises: Promise<any>[] = [];

    // Email promise
    if (payload.recipientEmail && payload.recipientEmail.trim() !== "") {
      promises.push(
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

    // WhatsApp promise
    if (payload.recipientPhone && payload.recipientPhone.trim() !== "") {
      const waMessage = createWhatsAppMessage({
        firstName: payload.firstName,
        title: payload.title,
        deadline: payload.deadline,
        description: payload.description,
      });

      promises.push(
        sendWhatsAppReminder(payload.recipientPhone, waMessage).then(
          (result) => ({ type: "whatsapp", result })
        )
      );
    } else {
      console.log(
        "No phone recipient provided, skipping WhatsApp notification"
      );
    }

    // ✅ OPTIMIZATION 6: Execute all promises in parallel
    const results = await Promise.allSettled(promises);

    let emailStatus: any = null;
    let whatsappStatus: any = null;

    // Process results
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        if (result.value.type === "email") {
          emailStatus = result.value.result;
        } else if (result.value.type === "whatsapp") {
          whatsappStatus = result.value.result;
        }
      } else {
        console.error(`Promise ${index} rejected:`, result.reason);
        if (index === 0)
          emailStatus = { success: false, error: result.reason?.message };
        if (index === 1)
          whatsappStatus = { success: false, error: result.reason?.message };
      }
    });

    // ✅ OPTIMIZATION 7: Update database status if any notification succeeded
    const anySuccess = emailStatus?.success || whatsappStatus?.success;
    if (anySuccess) {
      try {
        // Use Promise.race with timeout for database update
        const updatePromise = supabaseAdmin
          .from("tasks")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", payload.taskId);

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Database update timeout")), 5000)
        );

        await Promise.race([updatePromise, timeoutPromise]);
        console.log(`✅ Task ${payload.taskId} reminder status updated`);
      } catch (error: any) {
        console.error("❌ Error updating task status:", error.message);
        // Don't fail the entire task for database update errors
      }
    }

    const executionTime = Date.now() - startTime;
    console.log(`📊 Task reminder completed in ${executionTime}ms`);

    return {
      success: anySuccess,
      taskId: payload.taskId,
      message: `Reminder attempt for: ${payload.title}`,
      email: emailStatus,
      whatsapp: whatsappStatus,
      sentVia: {
        email: emailStatus?.success || false,
        whatsapp: whatsappStatus?.success || false,
      },
      executionTime: executionTime,
    };
  },
});

// ✅ OPTIMIZATION 8: Improved scheduler with better validation
export async function scheduleTaskReminder(taskData: {
  id: string;
  title: string;
  description?: string;
  deadline: string;
  reminderDays: number;
  recipientEmail: string;
  recipientPhone?: string;
  firstName: string;
}) {
  const deadlineDate = new Date(taskData.deadline);
  const reminderDate = new Date(
    deadlineDate.getTime() - taskData.reminderDays * 24 * 60 * 60 * 1000
  );

  // ✅ Better time validation
  const now = new Date();
  const timeDifference = reminderDate.getTime() - now.getTime();

  if (timeDifference <= 0) {
    throw new Error(
      `Reminder time has already passed for task ${taskData.id}. ` +
        `Reminder was scheduled for ${reminderDate.toISOString()}, current time is ${now.toISOString()}`
    );
  }

  // Log scheduling details
  console.log(`📅 Scheduling reminder for task ${taskData.id}:`, {
    email: taskData.recipientEmail || "none",
    phone: taskData.recipientPhone || "none",
    reminderDate: reminderDate.toISOString(),
    timeUntilReminder: `${Math.round(timeDifference / (1000 * 60 * 60))} hours`,
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
      {
        delay: reminderDate,
      }
    );

    console.log(`✅ Reminder scheduled successfully with handle: ${handle.id}`);
    return handle;
  } catch (error: any) {
    console.error(
      `❌ Failed to schedule reminder for task ${taskData.id}:`,
      error
    );
    throw new Error(`Scheduling failed: ${error.message}`);
  }
}
