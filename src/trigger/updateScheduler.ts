// src/trigger/updateScheduler.ts
import { task } from "@trigger.dev/sdk/v3";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTaskReminder } from "./task";

interface UpdateReminderPayload {
  taskId: string;
  existingTask: {
    id: string;
    title: string;
    description?: string;
    deadline: string;
    reminder_days?: number;
    remind_method?: "email" | "whatsapp" | "both" | null;
    target_contact?: string | null;
    trigger_handle_id?: string | null;
  };
  updatedTask: {
    id: string;
    title: string;
    description?: string;
    deadline: string;
    reminder_days?: number;
    remind_method?: "email" | "whatsapp" | "both" | null;
    target_contact?: string | null;
  };
  userDetails: {
    name?: string;
    email: string;
    phone_number?: string;
  };
}

export const updateReminderJob = task({
  id: "update-reminder-job",
  run: async (payload: UpdateReminderPayload) => {
    const startTime = Date.now();

    try {
      console.log(
        `🔄 Background reminder update for task ${payload.taskId}...`
      );

      const { existingTask, updatedTask, userDetails } = payload;

      // Check if reminder settings changed
      const reminderSettingsChanged = checkReminderSettingsChanged(
        existingTask,
        updatedTask
      );

      if (!reminderSettingsChanged) {
        console.log(`ℹ️ No reminder changes needed for task ${payload.taskId}`);
        return {
          success: true,
          taskId: payload.taskId,
          message: "No reminder changes needed",
          executionTime: Date.now() - startTime,
        };
      }

      console.log(`🔧 Reminder settings changed for task ${payload.taskId}`);

      let cancelResult: any = null;
      let scheduleResult: any = null;
      let newTriggerHandleId: string | null = null;

      // Step 1: Cancel old reminder if exists
      if (existingTask.trigger_handle_id) {
        try {
          console.log(
            `❌ Cancelling old reminder ${existingTask.trigger_handle_id}...`
          );
          cancelResult = await cancelTriggerHandle(
            existingTask.trigger_handle_id
          );
          console.log(`✅ Cancel result:`, cancelResult);
        } catch (error) {
          console.error(`❌ Failed to cancel old reminder:`, error);
          cancelResult = { success: false, error: (error as Error).message };
        }
      }

      // Step 2: Schedule new reminder if needed
      if (updatedTask.remind_method && updatedTask.reminder_days !== null) {
        try {
          console.log(
            `📅 Scheduling new reminder for task ${payload.taskId}...`
          );

          const schedulingData = prepareSchedulingData(
            updatedTask,
            userDetails
          );

          if (schedulingData.canSchedule) {
            const handle = await sendTaskReminder.trigger(
              schedulingData.payload,
              {
                delay: schedulingData.reminderDate,
              }
            );

            newTriggerHandleId = handle.id;
            scheduleResult = {
              success: true,
              handleId: handle.id,
              reminderDate: schedulingData.reminderDate,
            };
            console.log(`✅ New reminder scheduled: ${handle.id}`);
          } else {
            scheduleResult = {
              success: false,
              error:
                "Cannot schedule - reminder date in past or missing contact info",
            };
            console.warn(
              `⚠️ Cannot schedule reminder for task ${payload.taskId}: ${scheduleResult.error}`
            );
          }
        } catch (error) {
          console.error(`❌ Failed to schedule new reminder:`, error);
          scheduleResult = { success: false, error: (error as Error).message };
        }
      }

      // Step 3: Update trigger_handle_id in database
      try {
        const { error: updateError } = await supabaseAdmin
          .from("tasks")
          .update({ trigger_handle_id: newTriggerHandleId })
          .eq("id", payload.taskId);

        if (updateError) {
          console.error(`❌ Failed to update trigger_handle_id:`, updateError);
        } else {
          console.log(
            `✅ Updated trigger_handle_id for task ${payload.taskId}: ${newTriggerHandleId}`
          );
        }
      } catch (error) {
        console.error(`❌ Database update error:`, error);
      }

      const executionTime = Date.now() - startTime;
      console.log(
        `📊 Background reminder update completed in ${executionTime}ms`
      );

      return {
        success: true,
        taskId: payload.taskId,
        message: "Reminder update completed",
        cancelResult,
        scheduleResult,
        newTriggerHandleId,
        executionTime,
      };
    } catch (error: any) {
      console.error(
        `❌ Background reminder update failed for task ${payload.taskId}:`,
        error
      );

      // Try to update database to clear trigger_handle_id on failure
      try {
        await supabaseAdmin
          .from("tasks")
          .update({ trigger_handle_id: null })
          .eq("id", payload.taskId);
      } catch (dbError) {
        console.error(
          "Failed to update task after reminder update error:",
          dbError
        );
      }

      throw new Error(`Reminder update failed: ${error.message}`);
    }
  },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
  },
  machine: {
    preset: "micro",
  },
});

// Helper function to check if reminder settings changed
function checkReminderSettingsChanged(
  existingTask: any,
  updatedTask: any
): boolean {
  const oldActive = !!existingTask.remind_method;
  const newActive = !!updatedTask.remind_method;

  // If reminder activation status changed
  if (oldActive !== newActive) return true;

  // If both are inactive, no change needed
  if (!oldActive && !newActive) return false;

  // If both are active, check if settings changed
  if (oldActive && newActive) {
    return (
      existingTask.remind_method !== updatedTask.remind_method ||
      existingTask.target_contact !== updatedTask.target_contact ||
      existingTask.reminder_days !== updatedTask.reminder_days ||
      new Date(existingTask.deadline).toISOString() !==
        new Date(updatedTask.deadline).toISOString()
    );
  }

  return false;
}

// Helper function to cancel trigger handle
async function cancelTriggerHandle(handleId: string): Promise<any> {
  const url = `${process.env.TRIGGER_API_URL}/api/v2/runs/${handleId}/cancel`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const result = await response.json();
      return { success: true, data: result };
    } else {
      const errorText = await response.text();
      return {
        success: false,
        error: `API returned ${response.status}: ${errorText}`,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.name === "AbortError" ? "Timeout" : error.message,
    };
  }
}

// Helper function to prepare scheduling data
function prepareSchedulingData(updatedTask: any, userDetails: any) {
  // Extract firstName
  let firstName = "User";
  if (userDetails.name && userDetails.name.trim()) {
    firstName = userDetails.name.trim().split(" ")[0];
  } else if (userDetails.email) {
    firstName = userDetails.email.split("@")[0];
  }

  // Extract recipient details
  let recipientEmail: string | undefined;
  let recipientPhone: string | undefined;

  if (updatedTask.remind_method === "email") {
    recipientEmail = updatedTask.target_contact || userDetails.email;
  } else if (updatedTask.remind_method === "whatsapp") {
    recipientPhone = updatedTask.target_contact || userDetails.phone_number;
    if (recipientPhone && recipientPhone.startsWith("0")) {
      recipientPhone = "62" + recipientPhone.substring(1);
    } else if (
      recipientPhone &&
      !recipientPhone.startsWith("62") &&
      recipientPhone.length < 15
    ) {
      recipientPhone = "62" + recipientPhone;
    }
  } else if (updatedTask.remind_method === "both") {
    const [email = "", phone = ""] = (updatedTask.target_contact || "").split(
      "|"
    );
    recipientEmail = email || userDetails.email;
    recipientPhone = phone || userDetails.phone_number;
    if (recipientPhone && recipientPhone.startsWith("0")) {
      recipientPhone = "62" + recipientPhone.substring(1);
    } else if (
      recipientPhone &&
      !recipientPhone.startsWith("62") &&
      recipientPhone.length < 15
    ) {
      recipientPhone = "62" + recipientPhone;
    }
  }

  // Calculate reminder date
  const deadlineDate = new Date(updatedTask.deadline);
  const reminderDate = new Date(
    deadlineDate.getTime() - updatedTask.reminder_days * 24 * 60 * 60 * 1000
  );

  // Check if can schedule
  const canSchedule =
    reminderDate.getTime() > new Date().getTime() &&
    (recipientEmail || recipientPhone);

  return {
    canSchedule,
    reminderDate,
    payload: {
      taskId: updatedTask.id,
      title: updatedTask.title,
      description: updatedTask.description || "",
      deadline: updatedTask.deadline,
      recipientEmail: recipientEmail || "",
      recipientPhone: recipientPhone,
      firstName: firstName,
    },
  };
}
