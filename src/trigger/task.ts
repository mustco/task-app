// src/trigger/task.ts
import { task } from "@trigger.dev/sdk/v3";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { ReminderTemplate } from "@/components/email-template";

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface TaskPayload {
  taskId: string;
  title: string;
  description?: string;
  deadline: string;
  recipientEmail: string;
  firstName: string;
}

// Task untuk mengirim reminder email
export const sendTaskReminder = task({
  id: "send-task-reminder",
  run: async (payload: TaskPayload) => {
    try {
      // Kirim email reminder
      const { data: emailData, error: emailError } = await resend.emails.send({
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

      if (emailError) {
        throw new Error(`Failed to send email: ${emailError.message}`);
      }

      // Update status di database
      const { error: updateError } = await supabase
        .from("tasks")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", payload.taskId);

      if (updateError) {
        console.error("Failed to update task:", updateError.message);
      }

      return {
        success: true,
        taskId: payload.taskId,
        emailId: emailData?.id,
        message: `Reminder sent for: ${payload.title}`,
      };
    } catch (error) {
      console.error("Error in sendTaskReminder:", error);
      throw error;
    }
  },
});

// Fungsi helper untuk schedule reminder dari aplikasi utama
export async function scheduleTaskReminder(taskData: {
  id: string;
  title: string;
  description?: string;
  deadline: string;
  reminderDays: number;
  recipientEmail: string;
  firstName: string;
}) {
  const deadlineDate = new Date(taskData.deadline);
  const reminderDate = new Date(
    deadlineDate.getTime() - taskData.reminderDays * 24 * 60 * 60 * 1000
  );

  const now = new Date();
  const delayMs = reminderDate.getTime() - now.getTime();

  console.log(`DEBUG Schedule Reminder:
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
  const handle = await sendTaskReminder.trigger(
    {
      taskId: taskData.id,
      title: taskData.title,
      description: taskData.description,
      deadline: taskData.deadline,
      recipientEmail: taskData.recipientEmail,
      firstName: taskData.firstName,
    },
    {
      delay: reminderDate, // Gunakan number langsung, bukan string
    }
  );

  return handle;
}
