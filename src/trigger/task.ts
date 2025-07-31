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
  recipientEmail: string; // Bisa kosong untuk WhatsApp only
  recipientPhone?: string;
  firstName: string;
}

// Fungsi untuk membuat format pesan WhatsApp
function createWhatsAppMessage(payload: {
  firstName: string;
  title: string;
  deadline: string;
  description?: string;
}): string {
  const formattedDeadline = new Date(payload.deadline).toLocaleString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

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

  return message;
}

// Fungsi untuk mengirim pesan via Fonnte
async function sendWhatsAppReminder(phone: string, message: string) {
  if (!fonnteToken) {
    console.warn(
      "FONNTE_API_TOKEN is not set. Skipping WhatsApp notification."
    );
    return { success: false, error: "Fonnte token not configured." };
  }

  try {
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
    });

    const result = await response.json();
    if (!response.ok || result.status === false) {
      console.error("Fonnte API Error:", result);
      throw new Error(
        `Failed to send WhatsApp: ${result.reason || "Unknown error"}`
      );
    }

    console.log("WhatsApp message sent successfully:", result);
    return { success: true, data: result };
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    return { success: false, error: (error as Error).message };
  }
}

// Task utama yang dimodifikasi
export const sendTaskReminder = task({
  id: "send-task-reminder",
  run: async (payload: TaskPayload) => {
    let emailStatus: any = null;
    let whatsappStatus: any = null;

    // 1. Kirim Email Reminder (hanya jika ada email)
    if (payload.recipientEmail && payload.recipientEmail.trim() !== "") {
      try {
        const { ReminderTemplate } = await import(
          "@/components/email-template"
        );
        const { data, error } = await resend.emails.send({
          from: "ListKu <reminders-noreply@listku.my.id>",
          to: [payload.recipientEmail],
          subject: `⏰ Reminder: ${payload.title}`,
          react: ReminderTemplate({
            firstName: payload.firstName,
            title: payload.title,
            deadline: payload.deadline,
            description: payload.description,
          }),
        });

        if (error) throw error;
        emailStatus = { success: true, id: data?.id };
        console.log(`Email sent successfully to ${payload.recipientEmail}`);
      } catch (error: any) {
        console.error(
          `Failed to send email to ${payload.recipientEmail}:`,
          error.message
        );
        emailStatus = { success: false, error: error.message };
      }
    } else {
      console.log("No email recipient provided, skipping email notification");
    }

    // 2. Kirim WhatsApp Reminder (hanya jika ada nomor telepon)
    if (payload.recipientPhone && payload.recipientPhone.trim() !== "") {
      const waMessage = createWhatsAppMessage(payload);
      whatsappStatus = await sendWhatsAppReminder(
        payload.recipientPhone,
        waMessage
      );

      if (whatsappStatus.success) {
        console.log(`WhatsApp sent successfully to ${payload.recipientPhone}`);
      }
    } else {
      console.log(
        "No phone recipient provided, skipping WhatsApp notification"
      );
    }

    // 3. Update status di database (jika salah satu berhasil)
    const anySuccess = emailStatus?.success || whatsappStatus?.success;
    if (anySuccess) {
      try {
        const { error: updateError } = await supabaseAdmin
          .from("tasks")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", payload.taskId);
        if (updateError) {
          console.error("Failed to update task status:", updateError.message);
        } else {
          console.log(`Task ${payload.taskId} reminder status updated`);
        }
      } catch (error) {
        console.error("Error updating task status:", error);
      }
    }

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
    };
  },
});

// Fungsi scheduler yang dimodifikasi
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

  if (reminderDate.getTime() - new Date().getTime() <= 0) {
    throw new Error(
      `Reminder time has already passed for task ${taskData.id}.`
    );
  }

  console.log(`Scheduling reminder for task ${taskData.id}:`, {
    email: taskData.recipientEmail || "none",
    phone: taskData.recipientPhone || "none",
    reminderDate: reminderDate.toISOString(),
  });

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

  return handle;
}
