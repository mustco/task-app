// src/trigger/scheduler.ts
import { task } from "@trigger.dev/sdk/v3";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTaskReminder } from "./task";

interface ScheduleReminderPayload {
  taskId: string;
  taskData: {
    title: string;
    description?: string;
    deadline: string;
    reminder_days: number;
  };
  reminderData: {
    recipientEmailForReminder?: string;
    recipientPhoneForReminder?: string;
  };
  firstName: string;
}

export const scheduleReminderJob = task({
  id: "schedule-reminder-job",
  run: async (payload: ScheduleReminderPayload) => {
    const startTime = Date.now();

    try {
      console.log(
        `🔄 Background scheduling reminder for task ${payload.taskId}...`
      );

      // Validasi data yang diperlukan
      if (!payload.taskData.deadline || !payload.taskData.reminder_days) {
        throw new Error("Missing required reminder data");
      }

      // Hitung tanggal reminder
      const deadlineDate = new Date(payload.taskData.deadline);
      const reminderDate = new Date(
        deadlineDate.getTime() -
          payload.taskData.reminder_days * 24 * 60 * 60 * 1000
      );

      // Validasi reminder date
      const now = new Date();
      if (reminderDate <= now) {
        console.warn(
          `⚠️ Reminder date is in the past for task ${payload.taskId}`
        );
        // Update task status tapi jangan fail
        await supabaseAdmin
          .from("tasks")
          .update({
            trigger_handle_id: null,
            // Bisa tambah field untuk track error ini
          })
          .eq("id", payload.taskId);

        return {
          success: false,
          error: "Reminder date is in the past",
          taskId: payload.taskId,
        };
      }

      console.log(`📅 Scheduling reminder for ${reminderDate.toISOString()}`);

      // Schedule reminder dengan sendTaskReminder
      const handle = await sendTaskReminder.trigger(
        {
          taskId: payload.taskId,
          title: payload.taskData.title,
          description: payload.taskData.description || "",
          deadline: payload.taskData.deadline,
          recipientEmail: payload.reminderData.recipientEmailForReminder || "",
          recipientPhone: payload.reminderData.recipientPhoneForReminder,
          firstName: payload.firstName,
        },
        {
          delay: reminderDate,
        }
      );

      console.log(`✅ Reminder scheduled with handle: ${handle.id}`);

      // Update trigger_handle_id di database
      const { error: updateError } = await supabaseAdmin
        .from("tasks")
        .update({ trigger_handle_id: handle.id })
        .eq("id", payload.taskId);

      if (updateError) {
        console.error("Failed to update trigger_handle_id:", updateError);
        // Jangan throw error, biarkan reminder tetap jalan
      } else {
        console.log(`✅ Task ${payload.taskId} updated with trigger handle`);
      }

      const executionTime = Date.now() - startTime;
      console.log(`📊 Background scheduling completed in ${executionTime}ms`);

      return {
        success: true,
        handleId: handle.id,
        taskId: payload.taskId,
        reminderDate: reminderDate.toISOString(),
        executionTime,
      };
    } catch (error: any) {
      console.error(
        `❌ Background scheduling failed for task ${payload.taskId}:`,
        error
      );

      // Update task untuk mark bahwa scheduling gagal
      try {
        await supabaseAdmin
          .from("tasks")
          .update({
            trigger_handle_id: null,
            // Bisa tambah field error_message: error.message
          })
          .eq("id", payload.taskId);
      } catch (dbError) {
        console.error("Failed to update task after scheduling error:", dbError);
      }

      // Re-throw error supaya Trigger.dev bisa retry
      throw new Error(`Scheduling failed: ${error.message}`);
    }
  },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
  },
  machine: {
    preset: "micro", // Pakai preset kecil untuk job ringan
  },
});
