// app/components/tasks/add-task-dialog.tsx (FINAL - HANYA LOGIKA KONTAK YANG DIUBAH)

"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Task } from "@/lib/types";
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
import { z } from "zod";

// ✅ PERUBAHAN 1: Skema Zod disesuaikan dengan target_email dan target_phone
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
      return !isNaN(date.getTime()) && date > new Date();
    }, "Deadline must be a valid future date and time."),
    showReminder: z.boolean(),
    remindMethod: z.enum(["email", "whatsapp", "both"]).optional(),
    // Kolom baru untuk validasi
    target_email: z.string().email("Invalid email format.").optional(),
    target_phone: z.string().optional(),
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
          message: "Reminder method is required.",
          path: ["remindMethod"],
        });
      }

      if (data.remindMethod === "email" || data.remindMethod === "both") {
        if (!data.target_email) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "A valid email is required.",
            path: ["target_email"], // Path error disesuaikan
          });
        }
      }

      if (data.remindMethod === "whatsapp" || data.remindMethod === "both") {
        if (!data.target_phone || !/^\+?\d{8,15}$/.test(data.target_phone)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "A valid WhatsApp number is required.",
            path: ["target_phone"], // Path error disesuaikan
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
  // State management TIDAK DIUBAH untuk menjaga struktur form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [showReminder, setShowReminder] = useState(false);
  const [remindMethod, setRemindMethod] =
    useState<Task["remind_method"]>("email");
  const [targetContact, setTargetContact] = useState(""); // Untuk input tunggal
  const [emailContact, setEmailContact] = useState(""); // Untuk input 'both'
  const [whatsappContact, setWhatsappContact] = useState(""); // Untuk input 'both'
  const [reminderDays, setReminderDays] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { toast } = useToast();
  const supabase = createClient();

  // useEffect TIDAK DIUBAH
  useEffect(() => {
    if (showReminder) {
      if (remindMethod === "email") {
        setTargetContact(defaultEmail);
        setEmailContact("");
        setWhatsappContact("");
      } else if (remindMethod === "whatsapp") {
        setTargetContact(defaultPhone);
        setEmailContact("");
        setWhatsappContact("");
      } else if (remindMethod === "both") {
        setEmailContact(defaultEmail);
        setWhatsappContact(defaultPhone);
        setTargetContact("");
      }
    } else {
      setRemindMethod("email");
      setTargetContact("");
      setEmailContact("");
      setWhatsappContact("");
      setReminderDays(1);
    }
  }, [showReminder, remindMethod, defaultEmail, defaultPhone]);

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
      setErrors({});
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      // ✅ PERUBAHAN 2: Menyiapkan data untuk Zod sesuai skema baru
      const dataToValidate = {
        title,
        description,
        deadline,
        showReminder,
        remindMethod: showReminder ? remindMethod : undefined,
        reminderDays: showReminder ? reminderDays : undefined,
        target_email: showReminder
          ? remindMethod === "email"
            ? targetContact
            : remindMethod === "both"
              ? emailContact
              : undefined
          : undefined,
        target_phone: showReminder
          ? remindMethod === "whatsapp"
            ? targetContact
            : remindMethod === "both"
              ? whatsappContact
              : undefined
          : undefined,
      };

      const parsed = formSchema.safeParse(dataToValidate);
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        parsed.error.errors.forEach((err) => {
          if (err.path && err.path.length > 0) {
            // Menyesuaikan path error kembali ke nama input form
            const path = err.path[0].toString();
            if (path === "target_email") {
              fieldErrors[
                remindMethod === "both" ? "emailContact" : "targetContact"
              ] = err.message;
            } else if (path === "target_phone") {
              fieldErrors[
                remindMethod === "both" ? "whatsappContact" : "targetContact"
              ] = err.message;
            } else {
              fieldErrors[path] = err.message;
            }
          }
        });
        setErrors(fieldErrors);
        toast({
          title: "Validation Error",
          description: "Please correct the errors in the form.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user)
        throw new Error("User not authenticated. Please log in again.");

      // ✅ PERUBAHAN 3: Menyiapkan payload untuk database dengan kolom baru
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

      const { data, error: supabaseError } = await supabase
        .from("tasks")
        .insert(taskPayload)
        .select()
        .single();

      if (supabaseError) throw supabaseError;

      if (parsed.data.showReminder) {
        fetch("/api/schedule-reminder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: data.id }),
        }).catch((err) => {
          console.error("Background reminder scheduling failed:", err);
        });
      }

      onTaskAdded(data);
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

  // Bagian return (JSX) TIDAK ADA PERUBAHAN SAMA SEKALI
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
                  value={remindMethod ?? ""}
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
                  max="365"
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
      </DialogContent>
    </Dialog>
  );
}
