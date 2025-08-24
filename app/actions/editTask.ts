// app/actions/editTask.ts
"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { headers, cookies } from "next/headers";

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

export async function editTask(formData: FormData) {
  const supabase = await createClient();

  // auth
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "User not authenticated." };

  // ambil task lama (untuk otorisasi/merge return)
  const taskId = getStr(formData, "id");
  if (!taskId) return { success: false, message: "Task id is required." };

  const { data: oldTask, error: fetchErr } = await supabase
    .from("tasks")
    .select(
      "id, user_id, title, description, deadline, status, remind_method, reminder_days, target_email, target_phone"
    )
    .eq("id", taskId)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !oldTask) {
    return { success: false, message: "Task not found or permission denied." };
  }

  // normalize payload
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

  const parsed = editSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid form data.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const d = parsed.data;

  // build updates
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

  // update DB
  const { error: upErr } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", taskId)
    .eq("user_id", user.id);

  if (upErr) {
    const msg = upErr.message?.includes("row-level security")
      ? "Aksi ditolak! Fitur ini hanya tersedia untuk pengguna Premium. Silakan upgrade akun Anda."
      : upErr.message || "Update failed.";
    return { success: false, message: msg };
  }

  const updated = {
    ...oldTask,
    ...updates,
    id: oldTask.id,
    user_id: oldTask.user_id,
  };

  // === 🔁 ALWAYS reschedule on any edit (title/desc/status/deadline/etc) ===
  const h = headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";

  if (host) {
    const url = `${proto}://${host}/api/reschedule-reminder`;
    const cookieHeader = cookies().toString();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          taskId,
          hasReminder: Boolean(updates.remind_method), // true = jadwalkan baru, false = cancel
        }),
        cache: "no-store",
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(
          `Error in background reschedule: ${response.status} - ${errorBody}`
        );
      }
    } catch (err) {
      console.error("Background reminder rescheduling failed:", err);
    }
  } else {
    console.error("Unable to resolve host for reschedule-reminder call.");
  }

  return {
    success: true,
    message: "Note updated successfully.",
    data: updated,
  };
}
