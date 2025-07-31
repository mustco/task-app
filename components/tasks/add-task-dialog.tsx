// app/components/tasks/add-task-dialog.tsx

"use client";

import type React from "react";
import { useState, useEffect, useCallback } from "react"; // Tambahkan useCallback
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
import { z } from "zod"; // Import Zod for client-side schema validation

// Definisi skema validasi untuk input form (client-side validation)
// Ini harus konsisten dengan ServerTaskCreateSchema di /api/tasks/create/route.ts
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
        // Mengizinkan + di awal (opsional) diikuti 8-15 digit
        if (!data.targetContact || !/^\+?\d{8,15}$/.test(data.targetContact)) {
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
  const [targetContact, setTargetContact] = useState("");
  const [emailContact, setEmailContact] = useState("");
  const [whatsappContact, setWhatsappContact] = useState("");
  const [reminderDays, setReminderDays] = useState(1);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}); // State untuk error validasi

  const { toast } = useToast();
  // Supabase client tidak lagi digunakan untuk insert task utama,
  // tapi bisa tetap digunakan jika ada operasi lain yang membutuhkannya (misal, get user session)
  // const supabase = createClient();

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
      // Ini memberikan feedback cepat kepada pengguna
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

      // 2. Panggil API Route untuk Membuat Task
      // Ini akan memicu validasi server-side dan proses insert task.
      const response = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Kirimkan data yang sudah divalidasi client-side.
        // user_id TIDAK DIKIRIMKAN DARI CLIENT, akan ditambahkan di server API route.
        body: JSON.stringify(parsed.data),
      });

      const result = await response.json(); // Ambil response JSON dari API route

      if (!response.ok) {
        // Tampilkan error dari API route (server-side validation, rate limit, dll.)
        // result.details mungkin berisi error spesifik dari Zod server-side
        const errorMessage = result.error || "Failed to create note on server.";
        const detailErrors = result.details
          ? Object.values(result.details).flat().join(", ")
          : null;

        toast({
          title: "Error",
          description: detailErrors
            ? `${errorMessage}: ${detailErrors}`
            : errorMessage,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // 3. Update UI dan Tutup Dialog
      // result.task adalah objek Task yang baru dibuat, dikembalikan oleh API route
      onTaskAdded(result.task);
      onOpenChange(false);
      toast({
        title: "Success",
        description: result.message || "Note created successfully.",
      });
    } catch (error: any) {
      console.error("Error creating task in client:", error);
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
