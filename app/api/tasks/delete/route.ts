// app/api/tasks/delete/route.ts - OPTIMIZED VERSION

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { ratelimit } from "@/lib/upstash-ratelimit";

// --- Zod Schema for Delete Task Request ---
const DeleteTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task ID format. Must be a UUID."),
});

// ✅ OPTIMIZATION 1: Async reminder cancellation function
async function cancelReminderAsync(taskId: string, handleId: string) {
  try {
    const url = `${process.env.TRIGGER_API_URL}/api/v2/runs/${handleId}/cancel`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

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
      console.log(
        `✅ Successfully cancelled reminder ${handleId} for task ${taskId}`
      );
      return true;
    } else {
      const errorText = await response.text();
      console.warn(
        `❌ Failed to cancel reminder ${handleId} for task ${taskId}: ${response.status} - ${errorText}`
      );
      return false;
    }
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error(
        `⏱️ Timeout when cancelling reminder ${handleId} for task ${taskId}`
      );
    } else {
      console.error(
        `❌ Error cancelling reminder ${handleId} for task ${taskId}:`,
        error.message
      );
    }
    return false;
  }
}

// ✅ OPTIMIZATION 2: Main DELETE handler with immediate response
export async function DELETE(request: NextRequest) {
  try {
    // 1. Early authentication check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parallel rate limiting and body parsing
    const [rateLimitResult, body] = await Promise.all([
      ratelimit.limit(user.id || request.ip || "anonymous"),
      request.json(),
    ]);

    const {
      success: rateLimitPassed,
      limit,
      remaining,
      reset,
    } = rateLimitResult;

    if (!rateLimitPassed) {
      return NextResponse.json(
        {
          error: "Too many requests. Please try again later.",
          limit,
          remaining,
          reset,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": remaining.toString(),
            "X-RateLimit-Reset": reset.toString(),
          },
        }
      );
    }

    // 3. Fast validation
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

    // 4. Fetch task details and authorize ownership
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("id, trigger_handle_id, title, user_id")
      .eq("id", taskId)
      .single();

    if (fetchError || !task) {
      return NextResponse.json(
        { error: "Task not found or you do not have permission to delete it." },
        { status: 404 }
      );
    }

    // 5. Authorization check
    if (task.user_id !== user.id) {
      console.warn(
        `User ${user.id} attempted to delete task ${taskId} belonging to user ${task.user_id}`
      );
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to delete this task." },
        { status: 403 }
      );
    }

    // 6. Delete task from database first
    const { error: deleteError } = await supabase
      .from("tasks")
      .delete()
      .eq("id", taskId)
      .eq("user_id", user.id);

    if (deleteError) {
      console.error(`Failed to delete task ${taskId} from DB:`, deleteError);
      return NextResponse.json(
        {
          error: "Failed to delete task from database. Please try again later.",
        },
        { status: 500 }
      );
    }

    // ✅ OPTIMIZATION 3: Cancel reminder asynchronously (fire-and-forget)
    if (task.trigger_handle_id) {
      // Don't await this - let it run in background
      cancelReminderAsync(taskId, task.trigger_handle_id);
    }

    // ✅ OPTIMIZATION 4: Return response immediately
    return NextResponse.json(
      {
        success: true,
        message: "Task deleted successfully.",
        taskId: taskId,
        title: task.title,
        reminderCancellation: task.trigger_handle_id
          ? "Processing in background"
          : "No reminder to cancel",
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Unhandled error in delete task API:", error);
    return NextResponse.json(
      { error: "An unexpected server error occurred.", details: error.message },
      { status: 500 }
    );
  }
}
