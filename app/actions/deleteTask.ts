"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const DeleteSchema = z.object({
  taskId: z.string().uuid("Invalid taskId."),
});

export async function deleteTask(taskId: string) {
  const parsed = DeleteSchema.safeParse({ taskId });
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid request payload.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();

  // auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, message: "Unauthorized." };
  }

  // ambil task (owner check)
  const { data: task, error: fetchErr } = await supabase
    .from("tasks")
    .select("id, title, user_id, trigger_handle_id")
    .eq("id", taskId)
    .single();

  if (fetchErr || !task) {
    return { success: false, message: "Task not found or forbidden." };
  }
  if (task.user_id !== user.id) {
    return { success: false, message: "Forbidden." };
  }

  // cancel reminder di Trigger.dev (kalau ada)
  let reminderCancelled = false;
  if (task.trigger_handle_id) {
    try {
      const resp = await fetch(
        `https://api.trigger.dev/api/v2/runs/${task.trigger_handle_id}/cancel`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          // kecilin risiko hang
          signal: AbortSignal.timeout(5000),
        }
      );
      reminderCancelled = resp.ok;
    } catch {
      // gak fatal; tetap lanjut hapus task
    }
  }

  // hapus task (mengandalkan RLS delete untuk user ini)
  const { error: delErr } = await supabase
    .from("tasks")
    .delete()
    .eq("id", taskId);
  if (delErr) {
    return {
      success: false,
      message: delErr.message || "Failed to delete task.",
    };
  }

  // revalidate dashboard/table
  revalidatePath("/dashboard");

  return {
    success: true,
    message: reminderCancelled
      ? "Note and reminder deleted successfully."
      : "Note deleted successfully.",
    reminderCancelled,
    taskId,
    title: task.title,
  };
}
