"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { headers, cookies } from "next/headers";

// Schema untuk edit (tambahkan id + status)
const editSchema = z
  .object({
    id: z.string().uuid("Invalid task id."),
    title: z
      .string()
      .min(1, "Title is required.")
      .max(255, "Title is too long."),
    description: z.string().max(1000, "Description is too long.").optional(),
    deadline: z.string().refine((val) => {
      const d = new Date(val);
      return !isNaN(d.getTime()) && d > new Date();
    }, "Deadline must be a valid future date and time."),
    status: z.enum(["pending", "in_progress", "completed", "overdue"]),
    showReminder: z.boolean(),
    remindMethod: z.enum(["email", "whatsapp", "both"]).optional(),
    target_email: z.string().email("Invalid email format.").optional(),
    target_phone: z.string().optional(),
    reminderDays: z
      .number()
      .min(0, "Cannot be negative.")
      .max(365, "Max 365 days before.")
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.showReminder) return;

    if (!data.remindMethod) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reminder method is required.",
        path: ["remindMethod"],
      });
    }
    if (data.remindMethod === "email" || data.remindMethod === "both") {
      if (!data.target_email) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A valid email is required.",
          path: ["target_email"],
        });
      }
    }
    if (data.remindMethod === "whatsapp" || data.remindMethod === "both") {
      if (!data.target_phone || !/^\+?\d{8,15}$/.test(data.target_phone)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A valid WhatsApp number is required.",
          path: ["target_phone"],
        });
      }
    }
    if (data.reminderDays === undefined || data.reminderDays === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reminder days are required.",
        path: ["reminderDays"],
      });
    }
  });

const getStr = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return v == null ? undefined : String(v);
};

// Helper function untuk check apakah reminder berubah
function hasReminderChanged(oldTask: any, updates: any): boolean {
  return (
    (oldTask.remind_method ?? null) !== (updates.remind_method ?? null) ||
    (oldTask.reminder_days ?? null) !== (updates.reminder_days ?? null) ||
    (oldTask.target_email ?? null) !== (updates.target_email ?? null) ||
    (oldTask.target_phone ?? null) !== (updates.target_phone ?? null) ||
    new Date(oldTask.deadline).toISOString() !== updates.deadline
  );
}

// Background function untuk reschedule - fire and forget
async function triggerRescheduleReminder(taskId: string, hasReminder: boolean) {
  try {
    const h = headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "https";

    if (!host) {
      console.warn("No host found for reschedule reminder");
      return;
    }

    const url = `${proto}://${host}/api/reschedule-reminder`;
    const cookieHeader = cookies().toString();

    // Fire and forget - jangan await!
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ taskId, hasReminder }),
      signal: AbortSignal.timeout(8000), // 8 detik timeout
    }).catch((err) => {
      console.error("Background reminder rescheduling failed:", err);
    });
  } catch (err) {
    console.error("Failed to trigger reschedule reminder:", err);
  }
}

export async function editTask(formData: FormData) {
  const supabase = await createClient();

  try {
    // 1. Paralel: Auth + form parsing
    const [authResult, taskId] = await Promise.all([
      supabase.auth.getUser(),
      Promise.resolve(getStr(formData, "id")),
    ]);

    const {
      data: { user },
    } = authResult;
    if (!user) return { success: false, message: "User not authenticated." };
    if (!taskId) return { success: false, message: "Task id is required." };

    // 2. Parse form data lebih efisien
    const raw = {
      id: taskId,
      title: getStr(formData, "title"),
      description: getStr(formData, "description"),
      deadline: getStr(formData, "deadline"),
      status: getStr(formData, "status"),
      showReminder: formData.get("showReminder") === "true",
      remindMethod: getStr(formData, "remindMethod"),
      target_email: getStr(formData, "target_email"),
      target_phone: getStr(formData, "target_phone"),
      reminderDays: formData.get("reminderDays")
        ? Number(formData.get("reminderDays"))
        : undefined,
    };

    // 3. Paralel: Validation + fetch old task
    const [parseResult, taskResult] = await Promise.all([
      Promise.resolve(editSchema.safeParse(raw)),
      supabase
        .from("tasks")
        .select(
          "id, user_id, title, description, deadline, status, remind_method, reminder_days, target_email, target_phone"
        )
        .eq("id", taskId)
        .eq("user_id", user.id)
        .single(),
    ]);

    // Handle validation error
    if (!parseResult.success) {
      return {
        success: false,
        message: "Invalid form data.",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    // Handle fetch error
    const { data: oldTask, error: fetchErr } = taskResult;
    if (fetchErr || !oldTask) {
      return {
        success: false,
        message: "Task not found or permission denied.",
      };
    }

    const d = parseResult.data;

    // 4. Build update payload
    const updates = {
      title: d.title,
      description: d.description || null,
      deadline: new Date(d.deadline).toISOString(),
      status: d.status,
      remind_method: d.showReminder ? d.remindMethod! : null,
      reminder_days: d.showReminder ? d.reminderDays! : null,
      target_email: d.showReminder ? d.target_email || null : null,
      target_phone: d.showReminder ? d.target_phone || null : null,
    };

    // 5. Check reminder changes SEBELUM update
    const reminderChanged = hasReminderChanged(oldTask, updates);

    // 6. Update task
    const { data: updated, error: upErr } = await supabase
      .from("tasks")
      .update(updates)
      .eq("id", taskId)
      .eq("user_id", user.id)
      .select()
      .single();

    if (upErr) {
      const msg = upErr.message?.includes("row-level security")
        ? "Aksi ditolak! Fitur ini hanya tersedia untuk pengguna Premium. Silakan upgrade akun Anda."
        : upErr.message || "Update failed.";
      return { success: false, message: msg };
    }

    // 7. FIRE AND FORGET reminder reschedule jika ada perubahan
    if (reminderChanged) {
      // Jangan await! Biar background process
      triggerRescheduleReminder(taskId, Boolean(updates.remind_method));
    }

    return {
      success: true,
      message: "Note updated successfully.",
      data: updated,
    };
  } catch (error) {
    console.error("Error in editTask:", error);
    return {
      success: false,
      message: "An unexpected error occurred.",
    };
  }
}
