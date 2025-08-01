// netlify/functions/schedule-reminder-background.ts

import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
// Menggunakan import lokal untuk fungsi Trigger.dev
import { scheduleTaskReminder } from "../../src/trigger/task";

// Inisialisasi Supabase Admin Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Netlify Background Function untuk memproses dan menjadwalkan reminder task.
 * Fungsi ini dijalankan secara asinkron dan tidak memblokir response ke user.
 */
export const handler: Handler = async (event, context) => {
  console.log("🚀 Background function started:", new Date().toISOString());

  // Log payload yang masuk
  let payload: { taskId: string; userId: string };
  try {
    payload = JSON.parse(event.body || "{}");
    console.log(`Received payload:`, payload);
  } catch (parseError) {
    console.error("❌ Failed to parse event body:", parseError);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON payload" }),
    };
  }

  const { taskId, userId } = payload;

  // Validasi payload
  if (!taskId || !userId) {
    console.error("❌ Missing taskId or userId in payload");
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing taskId or userId" }),
    };
  }

  try {
    // 1. Ambil detail task dari database menggunakan supabaseAdmin
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
      console.error(
        "❌ Task not found or fetching failed:",
        taskError?.message || "Data not found."
      );
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Task not found" }),
      };
    }
    console.log("✅ Task fetched successfully.");

    // 2. Ambil detail user untuk personalisasi pesan
    const { data: user, error: userError } = await supabaseAdmin
      .from("profiles")
      .select("first_name")
      .eq("id", userId)
      .single();

    if (userError) {
      console.warn(
        "User profile not found for personalization, using default name."
      );
    }

    // 3. Siapkan data yang diperlukan untuk Trigger.dev
    const recipientEmail =
      task.remind_method === "email" || task.remind_method === "both"
        ? task.remind_method === "both"
          ? task.target_contact?.split("|")[0]
          : task.target_contact
        : undefined;

    const recipientPhone =
      task.remind_method === "whatsapp" || task.remind_method === "both"
        ? task.remind_method === "both"
          ? task.target_contact?.split("|")[1]
          : task.target_contact
        : undefined;

  const reminderData = {
    id: task.id,
    title: task.title,
    description: task.description || undefined,
    deadline: task.deadline,
    reminderDays: task.reminder_days || 1,
    recipientEmail: recipientEmail,
    recipientPhone: recipientPhone,
    firstName: user?.first_name || "User",
  };

    // Validasi final sebelum memanggil Trigger.dev
    if (!reminderData.recipientEmail && !reminderData.recipientPhone) {
      console.error(
        "❌ No valid recipient contact found. Skipping reminder scheduling."
      );
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No valid recipient contact found" }),
      };
    }

    console.log("✅ Reminder data prepared:", reminderData);

    // 4. Jadwalkan task dengan Trigger.dev
    console.log("📅 Scheduling reminder with Trigger.dev...");
    const handle = await scheduleTaskReminder(reminderData);
    console.log(`✅ Successfully scheduled reminder with handle: ${handle.id}`);

    // 5. Update task di database dengan handle dari Trigger.dev
    await supabaseAdmin
      .from("tasks")
      .update({
        trigger_handle: handle.id,
        reminder_scheduled_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    console.log(`✅ Task ${taskId} updated with trigger handle.`);

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
    console.error("❌ Background function error during execution:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
      }),
    };
  }
};
