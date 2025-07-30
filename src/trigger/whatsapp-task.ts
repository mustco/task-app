// src/trigger/whatsapp-task.ts
import { task } from "@trigger.dev/sdk/v3";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface WhatsAppTaskPayload {
  taskId: string;
  title: string;
  description?: string;
  deadline: string;
  recipientPhone: string;
  firstName: string;
}

// Fungsi untuk mengirim pesan WhatsApp via Fonnte
async function sendWhatsAppMessage(phone: string, message: string) {
  const FONNTE_TOKEN = process.env.FONNTE_TOKEN; // Tambahkan di environment variables
  
  if (!FONNTE_TOKEN) {
    throw new Error("FONNTE_TOKEN is not configured");
  }

  const response = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: {
      "Authorization": FONNTE_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      target: phone,
      message: message,
      countryCode: "62", // Indonesia country code
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Fonnte API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

// Fungsi untuk format tanggal ke bahasa Indonesia
function formatDeadlineForWA(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (error) {
    return dateString;
  }
}

// Fungsi untuk membuat template pesan WhatsApp
function createWhatsAppMessage(payload: WhatsAppTaskPayload): string {
  const formattedDeadline = formatDeadlineForWA(payload.deadline);
  
  let message = `🔔 *Reminder dari ListKu*\n\n`;
  message += `Halo ${payload.firstName}! 👋\n\n`;
  message += `ListKu mau ngingetin kamu tentang tugas yang penting nih:\n\n`;
  message += `📋 *${payload.title}*\n`;
  message += `⏰ *Deadline:* ${formattedDeadline}\n\n`;
  
  if (payload.description) {
    message += `📝 *Detail:*\n${payload.description}\n\n`;
  }
  
  message += `Jangan lupa ya! Buka aplikasi ListKu untuk lihat detail lengkapnya 📱\n\n`;
  message += `🔗 https://listku.my.id/dashboard\n\n`;
  message += `_Pesan otomatis dari ListKu - Aplikasi Pengingat Tugas_ ✨`;
  
  return message;
}

// Task untuk mengirim reminder WhatsApp
export const sendWhatsAppTaskReminder = task({
  id: "send-whatsapp-task-reminder",
  run: async (payload: WhatsAppTaskPayload) => {
    try {
      // Buat pesan WhatsApp
      const message = createWhatsAppMessage(payload);
      
      console.log(`Sending WhatsApp reminder to ${payload.recipientPhone}:`, message);
      
      // Kirim pesan WhatsApp via Fonnte
      const whatsappResponse = await sendWhatsAppMessage(
        payload.recipientPhone,
        message
      );

      console.log("WhatsApp response:", whatsappResponse);

      // Update status di database
      const { error: updateError } = await supabase
        .from("tasks")
        .update({ 
          whatsapp_reminder_sent_at: new Date().toISOString(),
          whatsapp_message_id: whatsappResponse.id || whatsappResponse.detail?.id
        })
        .eq("id", payload.taskId);

      if (updateError) {
        console.error("Failed to update task:", updateError.message);
      }

      return {
        success: true,
        taskId: payload.taskId,
        whatsappResponse: whatsappResponse,
        message: `WhatsApp reminder sent for: ${payload.title}`,
      };
    } catch (error) {
      console.error("Error in sendWhatsAppTaskReminder:", error);
      throw error;
    }
  },
});

// Fungsi helper untuk schedule WhatsApp reminder dari aplikasi utama
export async function scheduleWhatsAppTaskReminder(taskData: {
  id: string;
  title: string;
  description?: string;
  deadline: string;
  reminderDays: number;
  recipientPhone: string;
  firstName: string;
}) {
  const deadlineDate = new Date(taskData.deadline);
  const reminderDate = new Date(
    deadlineDate.getTime() - taskData.reminderDays * 24 * 60 * 60 * 1000
  );

  const now = new Date();
  const delayMs = reminderDate.getTime() - now.getTime();

  console.log(`DEBUG Schedule WhatsApp Reminder:
    - Deadline: ${deadlineDate.toLocaleString("id-ID")}
    - Reminder Date: ${reminderDate.toLocaleString("id-ID")}
    - Current Time: ${now.toLocaleString("id-ID")}
    - Delay (ms): ${delayMs}
    - Delay (hours): ${(delayMs / (1000 * 60 * 60)).toFixed(2)}
  `);

  // Jika waktu reminder sudah lewat, jangan jadwalkan
  if (delayMs <= 0) {
    throw new Error(
      `Reminder time has already passed. Reminder should be at ${reminderDate.toLocaleString("id-ID")}, but current time is ${now.toLocaleString("id-ID")}`
    );
  }

  // Schedule task untuk dijalankan pada waktu reminder
  const handle = await sendWhatsAppTaskReminder.trigger(
    {
      taskId: taskData.id,
      title: taskData.title,
      description: taskData.description,
      deadline: taskData.deadline,
      recipientPhone: taskData.recipientPhone,
      firstName: taskData.firstName,
    },
    {
      delay: reminderDate,
    }
  );

  return handle;
}

