"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { headers, cookies } from "next/headers";

// ---- Zod schema (no nulls, cukup optional) ----
const formSchema = z
  .object({
    title: z
      .string()
      .min(1, "Title is required.")
      .max(255, "Title is too long."),
    description: z.string().max(1000, "Description is too long.").optional(),
    deadline: z.string().refine((val) => {
      const date = new Date(val);
      return !isNaN(date.getTime()) && date > new Date();
    }, "Deadline must be a valid future date and time."),
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

// helper: ubah null → undefined
const getStr = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return v == null ? undefined : String(v);
};

function getAppBaseUrl() {
  const origin = headers().get("origin");
  if (origin) return origin;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL!;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function createTask(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: "User not authenticated." };
  }

  // ---- Normalisasi FormData ----
  const rawData = {
    title: getStr(formData, "title"),
    description: getStr(formData, "description"),
    deadline: getStr(formData, "deadline"),
    showReminder: formData.get("showReminder") === "true",
    remindMethod: getStr(formData, "remindMethod"),
    target_email: getStr(formData, "target_email"),
    target_phone: getStr(formData, "target_phone"),
    reminderDays: formData.get("reminderDays")
      ? Number(formData.get("reminderDays"))
      : undefined,
  };

  const parsed = formSchema.safeParse(rawData);

  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid form data.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const taskPayload = {
      user_id: user.id,
      title: parsed.data.title,
      description: parsed.data.description || null,
      deadline: new Date(parsed.data.deadline).toISOString(),
      status: "pending" as const,
      remind_method: parsed.data.showReminder
        ? parsed.data.remindMethod!
        : null,
      reminder_days: parsed.data.showReminder
        ? parsed.data.reminderDays!
        : null,
      target_email: parsed.data.showReminder
        ? parsed.data.target_email || null
        : null,
      target_phone: parsed.data.showReminder
        ? parsed.data.target_phone || null
        : null,
    };

    const { data: newTask, error: supabaseError } = await supabase
      .from("tasks")
      .insert(taskPayload)
      .select()
      .single();

   if (supabaseError) {
     console.error("Supabase insert error:", {
       message: supabaseError.message,
       details: supabaseError.details,
       hint: supabaseError.hint,
       code: (supabaseError as any).code,
     });
     if (supabaseError.message.includes("violates row-level security policy")) {
       return { success: false, message: "Aksi ditolak oleh policy RLS." };
     }
     throw supabaseError;
   }


    if (parsed.data.showReminder && newTask) {
      const baseUrl = getAppBaseUrl();
      const cookieHeader = cookies().toString(); // <-- bawa session ke route

      const url = new URL("/api/schedule-reminder", baseUrl).toString();

      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader, // <— ini bikin route punya session
        },
        body: JSON.stringify({ taskId: newTask.id }),
        cache: "no-store",
      }).catch((err) => {
        console.error("Background reminder scheduling failed:", err);
      });
    }

    revalidatePath("/dashboard");
    return {
      success: true,
      message: "Note created successfully.",
      data: newTask,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || "Failed to create note. Please try again.",
    };
  }
}
