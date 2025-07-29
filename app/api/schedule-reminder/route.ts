// app/api/schedule-reminder/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scheduleTaskReminder } from "../../../src/trigger/task";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { taskId } = await request.json();

    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 }
      );
    }

    // Ambil data task dari database
    const { data: task, error } = await supabase
      .from("tasks")
      .select(
        `
        id, title, description, deadline, reminder_days,
        target_contact, users(email)
      `
      )
      .eq("id", taskId)
      .single();

    if (error || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const recipientEmail = task.target_contact || task.users?.[0]?.email;
    if (!recipientEmail) {
      return NextResponse.json(
        { error: "No recipient email" },
        { status: 400 }
      );
    }

    // Schedule reminder menggunakan Trigger.dev
    const handle = await scheduleTaskReminder({
      id: task.id,
      title: task.title,
      description: task.description,
      deadline: task.deadline,
      reminderDays: task.reminder_days,
      recipientEmail,
      firstName: recipientEmail.split("@")[0] || "User",
    });

    return NextResponse.json({
      success: true,
      message: "Reminder scheduled successfully",
      taskId: task.id,
      triggerHandle: handle.id,
    });
  } catch (error: any) {
    console.error("Error scheduling reminder:", error);
    return NextResponse.json(
      { error: "Failed to schedule reminder", details: error.message },
      { status: 500 }
    );
  }
}
