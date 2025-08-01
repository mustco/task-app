// netlify/functions/schedule-reminder-background.ts

import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// Inisialisasi Supabase Admin Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Background Function Handler
export const handler: Handler = async (event, context) => {
  console.log("🚀 Background function started:", new Date().toISOString());
  try {
    // Parse request body
    const { taskId, userId } = JSON.parse(event.body || "{}");
    if (!taskId || !userId) {
      console.error("Missing taskId or userId");
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing taskId or userId" }),
      };
    } // 1. Fetch task details from database

    const { data: task, error: taskError } = await supabaseAdmin
      .from("tasks")
      .select(
        `
        id,
        title,
        description,
        deadline,
        remind_method,
        target_contact,
        reminder_days,
        user_id
      `
      )
      .eq("id", taskId)
      .eq("user_id", userId)
      .single();

    if (taskError || !task) {
      console.error("Task not found:", taskError);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Task not found" }),
      };
    } // 2. Fetch user details for personalization

    const { data: user, error: userError } = await supabaseAdmin
      .from("profiles")
      .select("first_name, email, phone")
      .eq("id", userId)
      .single();

    if (userError) {
      console.warn("User profile not found, using defaults");
    } // 3. Prepare reminder data

    const reminderData = {
      id: (task as any).id,
      title: (task as any).title,
      description: (task as any).description,
      deadline: (task as any).deadline,
      reminderDays: (task as any).reminder_days || 1,
      recipientEmail: "",
      recipientPhone: "",
      firstName: user?.first_name || "User",
    }; // Parse target contact based on remind method

    if ((task as any).remind_method === "email") {
      reminderData.recipientEmail = (task as any).target_contact || "";
    } else if ((task as any).remind_method === "whatsapp") {
      reminderData.recipientPhone = (task as any).target_contact || "";
    } else if ((task as any).remind_method === "both") {
      const [email, phone] = ((task as any).target_contact || "").split("|");
      reminderData.recipientEmail = email || "";
      reminderData.recipientPhone = phone || "";
    } // 4. Schedule with Trigger.dev

    console.log("📅 Scheduling reminder with Trigger.dev..."); // Import scheduleTaskReminder function
    const { scheduleTaskReminder } = await import("@/src/trigger/task");
    const handle = await scheduleTaskReminder(reminderData);
    console.log(`✅ Successfully scheduled reminder: ${handle.id}`); // 5. Update task with trigger handle (optional)

    await supabaseAdmin
      .from("tasks")
      .update({
        trigger_handle: handle.id,
        reminder_scheduled_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        taskId: taskId,
        triggerHandle: handle.id,
        message: "Reminder scheduled successfully",
      }),
    };
  } catch (error: any) {
    console.error("❌ Background function error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
      }),
    };
  }
};
