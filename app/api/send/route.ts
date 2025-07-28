import { Resend } from "resend";
import { ReminderTemplate } from "@/components/email-template";
import { createClient } from "@supabase/supabase-js";

// Inisialisasi Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// Inisialisasi Supabase client dengan Service Role Key
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Definisikan interface untuk Task
interface Task {
  id: string;
  title: string;
  description: string | null;
  deadline: string;
  status: string;
  remind_method: string;
  target_contact: string | null;
  reminder_days: number;
  user_id: string;
  reminder_sent_at: string | null;
  users: Array<{
    email: string;
    role: string;
  }> | null;
}

/**
 * GET Handler untuk Cron Job (Automatic Reminders)
 */
export async function GET() {
  try {
    const now = new Date();
    console.log(`DEBUG: Current server time (UTC): ${now.toISOString()}`);

    // 1. Query hanya tugas yang belum pernah dikirimi reminder
    console.log("DEBUG: Querying tasks from Supabase...");
    const { data: tasks, error: queryError } = await supabase
      .from("tasks")
      .select(
        `
        id, title, description, deadline, status, remind_method, 
        target_contact, reminder_days, user_id, reminder_sent_at,
        users ( email, role )
      `
      )
      .eq("status", "pending")
      .eq("remind_method", "email")
      .not("deadline", "is", null)
      .is("reminder_sent_at", null);

    if (queryError) {
      console.error(
        "❌ ERROR: Supabase query error:",
        queryError.message,
        queryError.details
      );
      return Response.json({ error: queryError.message }, { status: 400 });
    }

    if (!tasks || tasks.length === 0) {
      console.log("✅ INFO: No pending tasks found that need a reminder.");
      return Response.json({
        message: "No tasks found that need reminders",
        tasksChecked: 0,
        remindersSent: 0,
      });
    }

    console.log(`📋 DEBUG: Found ${tasks.length} tasks to check.`);

    let remindersSentCount = 0;
    const results = [];

    for (const task of tasks as unknown as Task[]) {
      console.log(
        `\n--- Processing Task: '${task.title}' (ID: ${task.id}) ---`
      );

      try {
        const deadline = new Date(task.deadline);
        if (isNaN(deadline.getTime())) {
          console.error(
            `❌ ERROR: Invalid deadline date for task ${task.id}: '${task.deadline}'. Skipping.`
          );
          continue;
        }

        const timeDiff = deadline.getTime() - now.getTime();

        // Mengubah logika dari menit ke HARI
        const reminderThresholdInMs = task.reminder_days * 24 * 60 * 60 * 1000;

        const shouldSendReminder =
          timeDiff <= reminderThresholdInMs && timeDiff > 0;

        console.log(
          `   DEBUG: Time until deadline: ${(timeDiff / (1000 * 60 * 60 * 24)).toFixed(2)} days`
        );
        console.log(`   DEBUG: Reminder threshold: ${task.reminder_days} days`);
        console.log(`   DEBUG: Should Send Reminder?: ${shouldSendReminder}`);

        if (shouldSendReminder) {
          const recipientEmail = task.target_contact || task.users?.[0]?.email;

          if (!recipientEmail) {
            console.warn(
              `⚠️ WARNING: No valid recipient email found for task ${task.id}. Skipping.`
            );
            continue;
          }

          console.log(
            `   DEBUG: Attempting to send email to ${recipientEmail}...`
          );
          const { data: emailData, error: emailError } =
            await resend.emails.send({
              from: "Task Manager <onboarding@resend.dev>",
              to: [recipientEmail],
              subject: `⏰ Reminder: ${task.title}`,
              react: ReminderTemplate({
                firstName: task.users?.[0]?.email?.split("@")[0] || "User",
                title: task.title,
                deadline: task.deadline,
                description: task.description || undefined,
              }),
            });

          if (emailError) {
            console.error(
              `❌ ERROR: Failed to send email for task ${task.id}:`,
              emailError.message
            );
            results.push({
              taskId: task.id,
              title: task.title,
              status: "failed_email",
              error: emailError.message,
            });
          } else {
            console.log(
              `✅ SUCCESS: Reminder sent for task: '${task.title}' (Email ID: ${emailData?.id})`
            );
            remindersSentCount++;

            console.log(
              `   DEBUG: Updating 'reminder_sent_at' for task ${task.id}...`
            );
            const { error: updateError } = await supabase
              .from("tasks")
              .update({ reminder_sent_at: new Date().toISOString() })
              .eq("id", task.id);

            if (updateError) {
              console.error(
                `   ❌ ERROR: Failed to update reminder_sent_at for task ${task.id}:`,
                updateError.message
              );
            } else {
              console.log(
                `   ✅ INFO: Marked task ${task.id} as reminder-sent.`
              );
            }
            results.push({
              taskId: task.id,
              title: task.title,
              status: "sent",
              recipientEmail,
              emailId: emailData?.id,
            });
          }
        } else {
          const reason = timeDiff <= 0 ? "deadline_passed" : "too_early";
          console.log(
            `   INFO: Task '${task.title}' is not ready for reminder (Reason: ${reason}).`
          );
          results.push({
            taskId: task.id,
            title: task.title,
            status: "not_ready",
            reason: reason,
          });
        }
      } catch (taskError: any) {
        console.error(
          `❌ ERROR: Error processing task ${task.id}:`,
          taskError.message || "Unknown task processing error"
        );
        results.push({
          taskId: task.id,
          title: task.title,
          status: "error_processing",
          error: taskError.message || "Unknown error",
        });
      }
    }

    console.log(`\n--- FINISHED REMINDER CHECK ---`);
    console.log(
      `Summary: Tasks Checked: ${tasks.length}, Reminders Sent: ${remindersSentCount}`
    );
    return Response.json({
      success: true,
      message: `Processed ${tasks.length} tasks, sent ${remindersSentCount} reminders`,
      tasksChecked: tasks.length,
      remindersSent: remindersSentCount,
      results,
    });
  } catch (err: any) {
    console.error(
      "❌ CRITICAL ERROR in GET handler:",
      err.message || "Unknown error",
      err
    );
    return Response.json(
      {
        error: "Failed to process reminders",
        details: err.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * POST Handler untuk Manual Reminders
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId } = body;

    if (!taskId) {
      return Response.json({ error: "taskId is required" }, { status: 400 });
    }

    const { data: task, error: queryError } = await supabase
      .from("tasks")
      .select(`id, title, description, deadline, target_contact, users(email)`)
      .eq("id", taskId)
      .single();

    if (queryError) {
      return Response.json({ error: queryError.message }, { status: 400 });
    }

    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }

    const recipientEmail = task.target_contact || task.users?.[0]?.email;

    if (!recipientEmail) {
      return Response.json(
        { error: "No valid recipient email found for this task." },
        { status: 400 }
      );
    }

    const { data: emailData, error: emailError } = await resend.emails.send({
      from: "Task Manager <onboarding@resend.dev>",
      to: [recipientEmail],
      subject: `⏰ Manual Reminder: ${task.title}`,
      react: ReminderTemplate({
        firstName: recipientEmail.split("@")[0] || "User",
        title: task.title,
        deadline: task.deadline,
        description: task.description || undefined,
      }),
    });

    if (emailError) {
      return Response.json({ error: emailError.message }, { status: 400 });
    }

    return Response.json({
      success: true,
      message: `Manual reminder sent for task: ${task.title}`,
      taskId: task.id,
      recipientEmail,
      emailId: emailData?.id,
    });
  } catch (err: any) {
    console.error("❌ Unexpected error in POST handler:", err);
    return Response.json(
      {
        error: "Failed to send manual reminder",
        details: err.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
