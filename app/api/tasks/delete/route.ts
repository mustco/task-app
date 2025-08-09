// app/api/tasks/delete/route.ts

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin"; // For canceling Trigger.dev runs (might need admin privileges/key)
import { createClient } from "@/lib/supabase/server"; // For server-side authentication (user context with RLS)
import { z } from "zod"; // For validation
import { ratelimit } from "@/lib/upstash-ratelimit"; // For rate limiting

// --- Zod Schema for Delete Task Request ---
const DeleteTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task ID format. Must be a UUID."), // Ensure taskId is a valid UUID
});

// --- Helper function for canceling Trigger.dev runs (from previous discussion) ---
async function cancelTriggerHandle(handleId: string): Promise<boolean> {
  const url = `${process.env.TRIGGER_API_URL}/api/v2/runs/${handleId}/cancel`; // Ensure correct URL
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(5000), // 5 seconds timeout
    });

    if (response.ok) {
      console.log(`✅ Successfully cancelled trigger ${handleId} using ${url}`);
      return true;
    } else {
      console.warn(
        `❌ Failed to cancel trigger ${handleId} with ${url}: ${response.status} - ${await response.text()}`
      );
      return false;
    }
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error(`Timeout when trying to cancel trigger ${handleId}.`);
    } else {
      console.error(`Error cancelling trigger ${handleId} with ${url}:`, error);
    }
    return false;
  }
}

// --- Main DELETE handler for task deletion ---
export async function DELETE(request: NextRequest) {
  try {
    // 1. Validate Input Body (using parsed request.json() not request.query)
    const body = await request.json(); // DELETE request with body is common for Next.js API routes
    const validationResult = DeleteTaskSchema.safeParse(body);

    if (!validationResult.success) {
      console.error(
        "Server-side validation failed for delete:",
        validationResult.error.flatten()
      );
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { taskId } = validationResult.data;

    // 2. Authenticate User (Server-side)
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("Authentication error in delete task API:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // --- RATE LIMITING IMPLEMENTATION ---
    // Gunakan user.id sebagai identifier unik untuk rate limit per pengguna.
    // Jika user.id tidak ada (misal, sesi guest), bisa gunakan IP address.
    const identifier = user.id || request.ip || "anonymous";

    const {
      success: rateLimitPassed,
      pending,
      limit,
      remaining,
      reset,
    } = await ratelimit.limit(identifier);

    if (!rateLimitPassed) {
      console.warn(`Rate limit exceeded for identifier: ${identifier}`);
      return NextResponse.json(
        {
          error: "Too many requests. Please try again later.",
          limit: limit,
          remaining: remaining,
          reset: reset,
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
    // --- END RATE LIMITING ---
    // 3. Fetch Task Details and Authorize Ownership
    // Use the server-side client (`supabase`) which respects RLS.
    // Ensure `user_id` and `trigger_handle_id` are selected.
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("id, trigger_handle_id, title, user_id")
      .eq("id", taskId)
      .single();

    if (fetchError || !task) {
      console.error("Supabase fetch error for task to delete:", fetchError);
      return NextResponse.json(
        { error: "Task not found or you do not have permission to delete it." },
        { status: 404 }
      );
    }

    // 4. Authorize: Ensure the task belongs to the authenticated user.
    if (task.user_id !== user.id) {
      console.warn(
        `User ${user.id} attempted to delete task ${taskId} belonging to user ${task.user_id}`
      );
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to delete this task." },
        { status: 403 }
      );
    }

    // 5. Cancel Reminder (if exists)
    let reminderCancelled = false;
    if (task.trigger_handle_id) {
      const cancelSuccess = await cancelTriggerHandle(task.trigger_handle_id);
      if (!cancelSuccess) {
        console.warn(
          `Failed to cancel reminder ${task.trigger_handle_id} for task ${taskId}.`
        );
      } else {
        reminderCancelled = true;
      }
    }

    // 6. Delete Task from Database
    // Use the authenticated server-side client (`supabase`) which respects RLS.
    // Your RLS policy for DELETE should allow users to delete their own tasks.
    const { error: deleteError } = await supabase
      .from("tasks")
      .delete()
      .eq("id", taskId)
      .eq("user_id", user.id); // Double-check ownership during deletion for ultimate safety

    if (deleteError) {
      console.error(`Failed to delete task ${taskId} from DB:`, deleteError);
      return NextResponse.json(
        {
          error: "Failed to delete task from database. Please try again later.",
        },
        { status: 500 }
      );
    }

    // 7. Return Success Response
    return NextResponse.json(
      {
        success: true,
        message: "Task deleted successfully.",
        taskId: taskId,
        title: task.title,
        reminderCancelled: reminderCancelled, // Indicate if reminder was cancelled
      },
      { status: 200 }
    ); // 200 OK for successful deletion
  } catch (error: any) {
    console.error("Unhandled error in delete task API:", error);
    return NextResponse.json(
      { error: "An unexpected server error occurred.", details: error.message },
      { status: 500 }
    );
  }
}