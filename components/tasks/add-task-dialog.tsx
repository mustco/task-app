// components/tasks/add-task-dialog.tsx
"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { createTask } from "@/app/actions/task";
import type { Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { z } from "zod";

// ✅ Selalu-reminder schema (tanpa showReminder)
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
    remindMethod: z.enum(["email", "whatsapp", "both"], {
      required_error: "Reminder method is required.",
    }),
    target_email: z.string().email("Invalid email format.").optional(),
    target_phone: z.string().optional(),
    reminderDays: z
      .number({ required_error: "Reminder days are required." })
      .min(0, "Cannot be negative.")
      .max(365, "Max 365 days before."),
  })
  .superRefine((data, ctx) => {
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
  });

interface AddTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTaskAdded: (task: Task) => void;
  defaultEmail: string;
  defaultPhone: string;
}

export function AddTaskDialog({
  open,
  onOpenChange,
  onTaskAdded,
  defaultEmail,
  defaultPhone,
}: AddTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [remindMethod, setRemindMethod] =
    useState<Task["remind_method"]>("email");
  const [emailContact, setEmailContact] = useState("");
  const [whatsappContact, setWhatsappContact] = useState("");
  const [reminderDays, setReminderDays] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  // Prefill kontak sesuai method
  useEffect(() => {
    if (!open) return;
    if (remindMethod === "email") {
      setEmailContact((prev) => prev || defaultEmail);
      setWhatsappContact("");
    } else if (remindMethod === "whatsapp") {
      setWhatsappContact((prev) => prev || defaultPhone);
      setEmailContact("");
    } else {
      setEmailContact((prev) => prev || defaultEmail);
      setWhatsappContact((prev) => prev || defaultPhone);
    }
  }, [remindMethod, open, defaultEmail, defaultPhone]);

  // Reset saat modal ditutup
  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
      setDeadline("");
      setRemindMethod("whatsapp");
      setEmailContact("");
      setWhatsappContact("");
      setReminderDays(0);
      setErrors({});
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    const raw = {
      title,
      description,
      deadline,
      remindMethod: remindMethod || "whatsapp",
      reminderDays: Number(reminderDays),
      target_email: remindMethod !== "whatsapp" ? emailContact : undefined,
      target_phone: remindMethod !== "email" ? whatsappContact : undefined,
    };

    // Client-side validate
    const parsed = formSchema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const [key, arr] of Object.entries(
        parsed.error.flatten().fieldErrors
      )) {
        if (arr?.[0]) fieldErrors[key] = arr[0];
      }
      setErrors(fieldErrors);
      setLoading(false);
      toast({
        title: "Validation Error",
        description: "Please fix the fields.",
        variant: "destructive",
      });
      return;
    }

    // Kirim ke server: selalu aktifkan reminder
    const formData = new FormData();
    formData.append("title", title);
    formData.append("description", description);
    formData.append("deadline", deadline);
    formData.append("showReminder", "true");
    formData.append("remindMethod", parsed.data.remindMethod);
    formData.append("reminderDays", String(parsed.data.reminderDays));
    if (parsed.data.remindMethod !== "whatsapp") {
      formData.append("target_email", parsed.data.target_email || "");
    }
    if (parsed.data.remindMethod !== "email") {
      formData.append("target_phone", parsed.data.target_phone || "");
    }

    const result = await createTask(formData);
    setLoading(false);

    if (result.success) {
      toast({ title: "Success", description: result.message });
      onTaskAdded(result.data as Task);
      onOpenChange(false);
      return;
    }

    if (result.errors) {
      const serverErrors = result.errors as Record<string, string[]>;
      const fieldErrors: Record<string, string> = {};
      for (const key in serverErrors) {
        const msg = serverErrors[key]?.[0];
        if (msg) fieldErrors[key] = msg;
      }
      // Map ke field yang tampil
      if (fieldErrors.target_email) {
        if (remindMethod === "both")
          fieldErrors.emailContact = fieldErrors.target_email;
        if (remindMethod === "email")
          fieldErrors.emailContact = fieldErrors.target_email;
      }
      if (fieldErrors.target_phone) {
        if (remindMethod === "both")
          fieldErrors.whatsappContact = fieldErrors.target_phone;
        if (remindMethod === "whatsapp")
          fieldErrors.whatsappContact = fieldErrors.target_phone;
      }
      setErrors(fieldErrors);
      toast({
        title: "Validation Error",
        description: "Please correct the errors.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 🔧 Mobile friendly: lebar adaptif + tinggi max + scroll */}
      <DialogContent className="max-w-[95vw] sm:max-w-[480px] p-0">
        <DialogHeader className="px-6 pt-5">
          <DialogTitle>Add New Note</DialogTitle>
        </DialogHeader>

        {/* Body scrollable */}
        <div className="px-6 pb-6 max-h-[75vh] overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
              />
              {errors.title && (
                <p className="text-red-500 text-sm mt-1">{errors.title}</p>
              )}
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
              />
              {errors.description && (
                <p className="text-red-500 text-sm mt-1">
                  {errors.description}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="deadline">Deadline *</Label>
              <Input
                id="deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                required
                className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
              />
              {errors.deadline && (
                <p className="text-red-500 text-sm mt-1">{errors.deadline}</p>
              )}
            </div>

            <div>
              <Label htmlFor="remindMethod">Reminder Method *</Label>
              <Select
                value={remindMethod ?? ""}
                onValueChange={(value) =>
                  setRemindMethod(value as Task["remind_method"])
                }
                required
              >
                <SelectTrigger className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
              {errors.remindMethod && (
                <p className="text-red-500 text-sm mt-1">
                  {errors.remindMethod}
                </p>
              )}
            </div>

            {/* Kontak sesuai method */}
            {remindMethod !== "whatsapp" && (
              <div>
                <Label htmlFor="emailContact">Email Address *</Label>
                <Input
                  id="emailContact"
                  type="email"
                  value={emailContact}
                  onChange={(e) => setEmailContact(e.target.value)}
                  required
                  className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
                />
                {errors.emailContact && (
                  <p className="text-red-500 text-sm mt-1">
                    {errors.emailContact}
                  </p>
                )}
              </div>
            )}

            {remindMethod !== "email" && (
              <div>
                <Label htmlFor="whatsappContact">WhatsApp Number *</Label>
                <Input
                  id="whatsappContact"
                  value={whatsappContact}
                  onChange={(e) => setWhatsappContact(e.target.value)}
                  placeholder="+62812xxxxxxx"
                  required
                  className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
                />
                {errors.whatsappContact && (
                  <p className="text-red-500 text-sm mt-1">
                    {errors.whatsappContact}
                  </p>
                )}
              </div>
            )}

            <div>
              <Label htmlFor="reminderDays">Remind Days Before *</Label>
              <Input
                id="reminderDays"
                type="number"
                min="0"
                max="365"
                value={reminderDays}
                onChange={(e) =>
                  setReminderDays(Number.parseInt(e.target.value || "0", 10))
                }
                required
                className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
              />
              {errors.reminderDays && (
                <p className="text-red-500 text-sm mt-1">
                  {errors.reminderDays}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? "Creating..." : "Create Note"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
