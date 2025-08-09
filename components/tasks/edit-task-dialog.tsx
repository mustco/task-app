// app/components/tasks/edit-task-dialog.tsx (FINAL - HANYA LOGIKA KONTAK YANG DIUBAH)

"use client";

import type React from "react";
import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { editTask } from "@/app/actions/editTask";
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
    status: z.enum(["pending", "in_progress", "completed", "overdue"]),
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
    }
  });

interface EditTaskDialogProps {
  taskToEdit: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTaskUpdated: (updatedTask: Task) => void;
}

export function EditTaskDialog({
  taskToEdit,
  open,
  onOpenChange,
  onTaskUpdated,
}: EditTaskDialogProps) {
  // State management TIDAK DIUBAH
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [status, setStatus] = useState<Task["status"]>("pending");
  const [showReminder, setShowReminder] = useState(false);
  const [remindMethod, setRemindMethod] =
    useState<Task["remind_method"]>("email");
  const [targetContact, setTargetContact] = useState("");
  const [emailContact, setEmailContact] = useState("");
  const [whatsappContact, setWhatsappContact] = useState("");
  const [reminderDays, setReminderDays] = useState(1);

  // ✅ PERUBAHAN 2: State `originalReminder` disesuaikan
  const [originalReminder, setOriginalReminder] = useState<{
    hasReminder: boolean;
    method: Task["remind_method"];
    email: string | null;
    phone: string | null;
    days: number;
    deadline: string;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { toast } = useToast();
  const supabase = createClient();

  // ✅ PERUBAHAN 3: Logika pengisian form disesuaikan
  useEffect(() => {
    if (taskToEdit) {
      setTitle(taskToEdit.title);
      setDescription(taskToEdit.description || "");
      setStatus(taskToEdit.status);

      if (taskToEdit.deadline) {
        const date = new Date(taskToEdit.deadline);
        const offset = date.getTimezoneOffset() * 60000;
        const localDeadline = new Date(date.getTime() - offset)
          .toISOString()
          .slice(0, 16);
        setDeadline(localDeadline);
      } else {
        setDeadline("");
      }

      const hasOriginalReminder = !!taskToEdit.remind_method;

      setOriginalReminder({
        hasReminder: hasOriginalReminder,
        method: taskToEdit.remind_method,
        email: taskToEdit.target_email,
        phone: taskToEdit.target_phone,
        days: taskToEdit.reminder_days ?? 1,
        deadline: taskToEdit.deadline
          ? new Date(taskToEdit.deadline).toISOString()
          : "",
      });

      if (hasOriginalReminder) {
        setShowReminder(true);
        setRemindMethod(taskToEdit.remind_method!);
        setReminderDays(taskToEdit.reminder_days ?? 1);

        if (taskToEdit.remind_method === "both") {
          setEmailContact(taskToEdit.target_email || "");
          setWhatsappContact(taskToEdit.target_phone || "");
          setTargetContact("");
        } else if (taskToEdit.remind_method === "email") {
          setTargetContact(taskToEdit.target_email || "");
          setEmailContact("");
          setWhatsappContact("");
        } else if (taskToEdit.remind_method === "whatsapp") {
          setTargetContact(taskToEdit.target_phone || "");
          setEmailContact("");
          setWhatsappContact("");
        }
      } else {
        setShowReminder(false);
        setRemindMethod("email");
        setReminderDays(1);
        setTargetContact("");
        setEmailContact("");
        setWhatsappContact("");
      }
      setErrors({});
    }
  }, [taskToEdit]);

  // ✅ PERUBAHAN 4: Logika `isReminderChanged` disesuaikan
  const isReminderChanged = useCallback(() => {
    if (!originalReminder) return false;

    const currentEmail =
      remindMethod === "email"
        ? targetContact.trim()
        : remindMethod === "both"
          ? emailContact.trim()
          : null;
    const currentPhone =
      remindMethod === "whatsapp"
        ? targetContact.trim()
        : remindMethod === "both"
          ? whatsappContact.trim()
          : null;
    const currentDeadlineIso = deadline ? new Date(deadline).toISOString() : "";

    return (
      originalReminder.hasReminder !== showReminder ||
      (showReminder && originalReminder.method !== remindMethod) ||
      (showReminder && originalReminder.email !== currentEmail) ||
      (showReminder && originalReminder.phone !== currentPhone) ||
      (showReminder && originalReminder.days !== reminderDays) ||
      (showReminder && originalReminder.deadline !== currentDeadlineIso)
    );
  }, [
    originalReminder,
    showReminder,
    remindMethod,
    targetContact,
    emailContact,
    whatsappContact,
    reminderDays,
    deadline,
  ]);

  // ✅ PERUBAHAN 5: Logika `handleSubmit` disesuaikan
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!taskToEdit) return;
  setLoading(true);
  setErrors({});

  try {
    const formData = new FormData();
    formData.append("id", taskToEdit.id);
    formData.append("title", title);
    formData.append("description", description);
    formData.append("deadline", deadline);
    formData.append("status", status);
    formData.append("showReminder", String(showReminder));

    if (showReminder) {
      formData.append("remindMethod", remindMethod ?? "email");
      formData.append("reminderDays", String(reminderDays));
      if (remindMethod === "email") {
        formData.append("target_email", targetContact);
      } else if (remindMethod === "whatsapp") {
        formData.append("target_phone", targetContact);
      } else {
        formData.append("target_email", emailContact);
        formData.append("target_phone", whatsappContact);
      }
    }

    const result = await editTask(formData);
    if (result.success) {
      onTaskUpdated(result.data as Task);
      onOpenChange(false);
      toast({ title: "Success", description: result.message });
    } else {
      // map error dari server ke UI
      const fieldErrors: Record<string, string> = {};
      if (result.errors) {
        for (const key in result.errors) {
          const arr = result.errors[key as keyof typeof result.errors];
          if (arr?.length) fieldErrors[key] = arr[0];
        }
        // mapping ke field visual
        if (fieldErrors.target_email && remindMethod === "email") fieldErrors.targetContact = fieldErrors.target_email;
        if (fieldErrors.target_phone && remindMethod === "whatsapp") fieldErrors.targetContact = fieldErrors.target_phone;
        if (fieldErrors.target_email && remindMethod === "both") fieldErrors.emailContact = fieldErrors.target_email;
        if (fieldErrors.target_phone && remindMethod === "both") fieldErrors.whatsappContact = fieldErrors.target_phone;
        setErrors(fieldErrors);
        toast({ title: "Validation Error", description: "Please correct the errors in the form.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: result.message, variant: "destructive" });
      }
    }
  } catch (err: any) {
    toast({ title: "Error", description: err.message || "Failed to save changes.", variant: "destructive" });
  } finally {
    setLoading(false);
  }
};


  // Bagian return (JSX) TIDAK ADA PERUBAHAN SAMA SEKALI
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
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
              <p className="text-red-500 text-sm mt-1">{errors.description}</p>
            )}
          </div>
          <div>
            <Label htmlFor="status">Status *</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as Task["status"])}
            >
              <SelectTrigger className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
            {errors.status && (
              <p className="text-red-500 text-sm mt-1">{errors.status}</p>
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
          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="edit-set-reminder"
              checked={showReminder}
              onCheckedChange={(checked) => setShowReminder(Boolean(checked))}
              className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
            />
            <Label
              htmlFor="edit-set-reminder"
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
                  <Label htmlFor="targetContactEmail">Email Address *</Label>
                  <Input
                    id="targetContactEmail"
                    value={targetContact}
                    onChange={(e) => setTargetContact(e.target.value)}
                    type="email"
                    required={showReminder}
                    className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
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
                  <Label htmlFor="targetContactWhatsapp">
                    WhatsApp Number *
                  </Label>
                  <Input
                    id="targetContactWhatsapp"
                    value={targetContact}
                    onChange={(e) => setTargetContact(e.target.value)}
                    required={showReminder}
                    className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
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
                    <Label htmlFor="emailContactBoth">Email Address *</Label>
                    <Input
                      id="emailContactBoth"
                      value={emailContact}
                      onChange={(e) => setEmailContact(e.target.value)}
                      type="email"
                      required={showReminder}
                      className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
                    />
                    {errors.emailContact && (
                      <p className="text-red-500 text-sm mt-1">
                        {errors.emailContact}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="whatsappContactBoth">
                      WhatsApp Number *
                    </Label>
                    <Input
                      id="whatsappContactBoth"
                      value={whatsappContact}
                      onChange={(e) => setWhatsappContact(e.target.value)}
                      required={showReminder}
                      className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
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
                  id="reminderDays"
                  type="number"
                  min="0"
                  max="365"
                  value={reminderDays}
                  onChange={(e) => setReminderDays(Number(e.target.value))}
                  className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
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
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
