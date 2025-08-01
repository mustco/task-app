// app/api/tasks/delete/route.ts (OPTIMIZED VERSION)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

// --- Input Validation Schema ---
const DeleteTaskSchema = z.object({
  taskId: z.string().uuid("Invalid taskId format. Must be a UUID."),
});

// --- Background job untuk cancel reminder (async) ---
async function cancelReminderInBackground(
  triggerHandleId: string,
  taskId: string
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // Reduced to 3s

    const response = await fetch(
      `${process.env.TRIGGER_API_URL}/api/v2/runs/${triggerHandleId}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (response.ok) {
      console.log(`✅ Cancelled reminder for deleted task ${taskId}`);
    } else {
      console.warn(
        `⚠️ Failed to cancel reminder for task ${taskId}. Status: ${response.status}`
      );
    }
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.warn(`⏱️ Timeout cancelling reminder for task ${taskId}`);
    } else {
      console.warn(
        `❌ Error cancelling reminder for task ${taskId}:`,
        error.message
      );
    }
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // 1. Validate Input
    const body = await request.json();
    const validationResult = DeleteTaskSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { taskId } = validationResult.data;

    // 2. Initialize authenticated Supabase client
    const supabase = await createClient();

    // 3. Get user session
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("Authentication error:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 4. Fetch task data (RLS akan otomatis handle authorization)
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("id, trigger_handle_id, title")
      .eq("id", taskId)
      .single();

    if (fetchError || !task) {
      console.error("Task fetch error:", fetchError);
      return NextResponse.json(
        { error: "Task not found or access denied" },
        { status: 404 }
      );
    }

    // 5. Delete task dari database DULU (fast operation)
    const { error: deleteError } = await supabase
      .from("tasks")
      .delete()
      .eq("id", taskId);

    if (deleteError) {
      console.error(`Failed to delete task ${taskId}:`, deleteError);
      return NextResponse.json(
        { error: "Failed to delete task from database" },
        { status: 500 }
      );
    }

    // 6. Cancel reminder di background (non-blocking)
    if (task.trigger_handle_id) {
      // Fire and forget - tidak menunggu hasil
      cancelReminderInBackground(task.trigger_handle_id, taskId).catch(
        (error) => {
          console.error(
            `Background reminder cancellation failed for task ${taskId}:`,
            error
          );
        }
      );
    }

    // 7. Return success response immediately
    return NextResponse.json({
      success: true,
      message: "Task deleted successfully",
      taskId: taskId,
      title: task.title,
      reminderCancellation: task.trigger_handle_id
        ? "Processing in background"
        : "No reminder to cancel",
    });
  } catch (error: any) {
    console.error("Delete task error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// --- Alternative: Jika mau ada endpoint untuk check reminder cancellation status ---
export async function GET(request: NextRequest) {
  // Optional: endpoint untuk check status background job
  // Bisa implement dengan Redis/database tracking jika diperlukan
  return NextResponse.json({ message: "Status endpoint not implemented" });
}
