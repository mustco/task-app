// app/components/tasks/add-task-dialog.tsx (SECURE & OPTIMIZED VERSION)

"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client"; // Client-side Supabase client
import type { Task } from "@/lib/types"; // Pastikan Task type Anda up-to-date
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import validator from "validator"; // Import validator library for client-side validation
import { z } from "zod"; // Import Zod for client-side schema validation (optional, but good practice)

// Definisi skema validasi untuk input form (client-side validation)
// Ini akan mencerminkan validasi yang lebih ketat di API route Anda
const formSchema = z
  .object({
    title: z
      .string()
      .min(1, "Title is required.")
      .max(255, "Title is too long."),
    description: z
      .string()
      .max(1000, "Description is too long.")
      .nullable()
      .optional(),
    deadline: z.string().refine((val) => {
      const date = new Date(val);
      // Pastikan tanggal valid dan di masa depan
      return !isNaN(date.getTime()) && date > new Date();
    }, "Deadline must be a valid future date and time."),
    showReminder: z.boolean(),
    remindMethod: z.enum(["email", "whatsapp", "both"]).optional(), // Optional if showReminder is false
    targetContact: z.string().optional(),
    emailContact: z.string().email("Invalid email format.").optional(),
    whatsappContact: z.string().optional(), // Lebih baik divalidasi dengan regex di sini juga
    reminderDays: z
      .number()
      .min(0, "Cannot be negative.")
      .max(365, "Max 365 days before.")
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.showReminder) {
      if (!data.remindMethod) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reminder method is required when reminder is enabled.",
          path: ["remindMethod"],
        });
      }

      if (data.remindMethod === "email") {
        if (!data.targetContact || !validator.isEmail(data.targetContact)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Valid email address is required.",
            path: ["targetContact"],
          });
        }
      } else if (data.remindMethod === "whatsapp") {
        // Basic phone number validation for client-side
        if (!data.targetContact || !/^\+?\d{8,15}$/.test(data.targetContact)) {
          // Memungkinkan + di awal
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Valid WhatsApp number (8-15 digits, optional +) is required.",
            path: ["targetContact"],
          });
        }
      } else if (data.remindMethod === "both") {
        if (!data.emailContact || !validator.isEmail(data.emailContact)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Valid email address is required for both methods.",
            path: ["emailContact"],
          });
        }
        if (
          !data.whatsappContact ||
          !/^\+?\d{8,15}$/.test(data.whatsappContact)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Valid WhatsApp number is required for both methods.",
            path: ["whatsappContact"],
          });
        }
      }
      if (data.reminderDays === undefined || data.reminderDays === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reminder days are required when reminder is enabled.",
          path: ["reminderDays"],
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

  const [showReminder, setShowReminder] = useState(false);
  const [remindMethod, setRemindMethod] =
    useState<Task["remind_method"]>("email");
  // targetContact hanya digunakan untuk single email/whatsapp
  const [targetContact, setTargetContact] = useState("");
  // emailContact dan whatsappContact digunakan untuk mode "both"
  const [emailContact, setEmailContact] = useState("");
  const [whatsappContact, setWhatsappContact] = useState("");
  const [reminderDays, setReminderDays] = useState(1);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}); // State untuk error validasi

  const { toast } = useToast();
  const supabase = createClient();

  // Handle default contact population when method changes or reminder is toggled
  useEffect(() => {
    if (showReminder) {
      if (remindMethod === "email") {
        setTargetContact(defaultEmail);
        setEmailContact(""); // Clear 'both' contacts when switching to single
        setWhatsappContact("");
      } else if (remindMethod === "whatsapp") {
        setTargetContact(defaultPhone);
        setEmailContact("");
        setWhatsappContact("");
      } else if (remindMethod === "both") {
        setEmailContact(defaultEmail);
        setWhatsappContact(defaultPhone);
        setTargetContact(""); // Clear single contact when switching to both
      }
    } else {
      // Clear all reminder-related fields if showReminder is false
      setRemindMethod("email"); // Reset to default
      setTargetContact("");
      setEmailContact("");
      setWhatsappContact("");
      setReminderDays(1); // Reset days
    }
  }, [showReminder, remindMethod, defaultEmail, defaultPhone]);

  // Efek untuk mereset form setiap kali dialog ditutup
  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
      setDeadline("");
      setShowReminder(false);
      setRemindMethod("email");
      setTargetContact("");
      setEmailContact("");
      setWhatsappContact("");
      setReminderDays(1);
      setErrors({}); // Clear errors when dialog closes
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({}); // Bersihkan error sebelumnya

    try {
      // 1. Client-side Validation (Pre-submission)
      const formData = {
        title,
        description,
        deadline,
        showReminder,
        remindMethod: showReminder ? remindMethod : undefined,
        targetContact:
          showReminder &&
          (remindMethod === "email" || remindMethod === "whatsapp")
            ? targetContact
            : undefined,
        emailContact:
          showReminder && remindMethod === "both" ? emailContact : undefined,
        whatsappContact:
          showReminder && remindMethod === "both" ? whatsappContact : undefined,
        reminderDays: showReminder ? reminderDays : undefined,
      };

      const parsed = formSchema.safeParse(formData);
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        parsed.error.errors.forEach((err) => {
          if (err.path && err.path.length > 0) {
            fieldErrors[err.path[0].toString()] = err.message;
          }
        });
        setErrors(fieldErrors);
        toast({
          title: "Validation Error",
          description: "Please correct the errors in the form.",
          variant: "destructive",
        });
        setLoading(false);
        return; // Hentikan eksekusi jika validasi gagal
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user)
        throw new Error("User not authenticated. Please log in again.");

      // Siapkan payload untuk Supabase insert
      type TaskPayload = Omit<
        Task,
        "id" | "created_at" | "user" | "trigger_handle_id"
      >; // Exclude trigger_handle_id
      const taskPayload: TaskPayload = {
        user_id: user.id,
        title: parsed.data.title,
        description: parsed.data.description || null,
        deadline: new Date(parsed.data.deadline).toISOString(),
        status: "pending",
        remind_method: null,
        target_contact: null,
        reminder_days: null,
      };

      if (parsed.data.showReminder) {
        let finalTargetContact = "";
        if (parsed.data.remindMethod === "email") {
          finalTargetContact = parsed.data.targetContact!;
        } else if (parsed.data.remindMethod === "whatsapp") {
          finalTargetContact = parsed.data.targetContact!;
        } else if (parsed.data.remindMethod === "both") {
          finalTargetContact = `${parsed.data.emailContact}|${parsed.data.whatsappContact}`;
        }
        taskPayload.remind_method = parsed.data.remindMethod!;
        taskPayload.target_contact = finalTargetContact;
        taskPayload.reminder_days = parsed.data.reminderDays!;
      }

      // Insert ke Supabase
      const { data, error: supabaseError } = await supabase
        .from("tasks")
        .insert(taskPayload)
        .select()
        .single();

      if (supabaseError) throw supabaseError;

      // 2. Schedule Reminder di Background (Non-blocking)
      // Gunakan hasReminder dari parsed.data
      if (parsed.data.showReminder) {
        fetch("/api/schedule-reminder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: data.id }),
        }).catch((err) => {
          console.error("Background reminder scheduling failed:", err);
          // Toast opsional untuk user jika reminder gagal dijadwalkan secara background
          // toast({
          //   title: "Warning",
          //   description: "Note created, but reminder scheduling failed. Please try editing the note to reschedule.",
          //   variant: "destructive",
          // });
        });
      }

      // 3. Update UI dan Tutup Dialog
      onTaskAdded(data); // Pastikan `data` memiliki semua properti `Task` yang diperlukan, termasuk ID dan user_id.
      onOpenChange(false);
      toast({ title: "Success", description: "Note created successfully." });
    } catch (error: any) {
      console.error("Error creating task:", error);
      toast({
        title: "Error",
        description:
          error.message || "Failed to create note. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input
              className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            {errors.title && (
              <p className="text-red-500 text-sm mt-1">{errors.title}</p>
            )}
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
            {errors.description && (
              <p className="text-red-500 text-sm mt-1">{errors.description}</p>
            )}
          </div>
          <div>
            <Label htmlFor="deadline">Deadline *</Label>
            <Input
              className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
              id="deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              required
            />
            {errors.deadline && (
              <p className="text-red-500 text-sm mt-1">{errors.deadline}</p>
            )}
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
              id="set-reminder"
              checked={showReminder}
              onCheckedChange={(checked) => setShowReminder(Boolean(checked))}
            />
            <Label
              htmlFor="set-reminder"
              className="cursor-pointer text-sm font-medium"
            >
              Set Reminder
            </Label>
          </div>
          {errors.showReminder && (
            <p className="text-red-500 text-sm mt-1">{errors.showReminder}</p>
          )}

          {showReminder && (
            <div className="space-y-4 border-t pt-4 animate-in fade-in-0 duration-300">
              <div>
                <Label htmlFor="remindMethod">Reminder Method *</Label>
                <Select
                  value={remindMethod ?? ""} // Pastikan value tidak null/undefined untuk Select
                  onValueChange={(value) =>
                    setRemindMethod(value as Task["remind_method"])
                  }
                  required={showReminder}
                >
                  <SelectTrigger className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400">
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

              {remindMethod === "email" && (
                <div>
                  <Label htmlFor="targetContact">Email Address *</Label>
                  <Input
                    className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
                    id="targetContact"
                    value={targetContact}
                    onChange={(e) => setTargetContact(e.target.value)}
                    type="email"
                    required={showReminder}
                  />
                  {errors.targetContact && (
                    <p className="text-red-500 text-sm mt-1">
                      {errors.targetContact}
                    </p>
                  )}
                </div>
              )}
              {remindMethod === "whatsapp" && (
                <div>
                  <Label htmlFor="targetContact">WhatsApp Number *</Label>
                  <Input
                    className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
                    id="targetContact"
                    value={targetContact}
                    onChange={(e) => setTargetContact(e.target.value)}
                    required={showReminder}
                  />
                  {errors.targetContact && (
                    <p className="text-red-500 text-sm mt-1">
                      {errors.targetContact}
                    </p>
                  )}
                </div>
              )}
              {remindMethod === "both" && (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="emailContact">Email Address *</Label>
                    <Input
                      className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
                      id="emailContact"
                      value={emailContact}
                      onChange={(e) => setEmailContact(e.target.value)}
                      type="email"
                      required={showReminder}
                    />
                    {errors.emailContact && (
                      <p className="text-red-500 text-sm mt-1">
                        {errors.emailContact}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="whatsappContact">WhatsApp Number *</Label>
                    <Input
                      className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
                      id="whatsappContact"
                      value={whatsappContact}
                      onChange={(e) => setWhatsappContact(e.target.value)}
                      required={showReminder}
                    />
                    {errors.whatsappContact && (
                      <p className="text-red-500 text-sm mt-1">
                        {errors.whatsappContact}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="reminderDays">Remind Days Before</Label>
                <Input
                  className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
                  id="reminderDays"
                  type="number"
                  min="0"
                  max="365" // Max 365, sesuai backend validation
                  value={reminderDays}
                  onChange={(e) =>
                    setReminderDays(Number.parseInt(e.target.value))
                  }
                />
                {errors.reminderDays && (
                  <p className="text-red-500 text-sm mt-1">
                    {errors.reminderDays}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading} // Disable cancel button when loading
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? "Creating..." : "Create Note"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
