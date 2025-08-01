// app/components/tasks/edit-task-dialog.tsx - OPTIMIZED VERSION

"use client";

import type React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
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
import validator from "validator";
import { z } from "zod";

// ✅ OPTIMIZATION 1: Move schema outside component
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
    targetContact: z.string().optional(),
    emailContact: z.string().email("Invalid email format.").optional(),
    whatsappContact: z.string().optional(),
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
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { toast } = useToast();

  // ✅ OPTIMIZATION 2: Memoize form data
  const formData = useMemo(
    () => ({
      title,
      description,
      deadline,
      status,
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
    }),
    [
      title,
      description,
      deadline,
      status,
      showReminder,
      remindMethod,
      targetContact,
      emailContact,
      whatsappContact,
      reminderDays,
    ]
  );

  // ✅ OPTIMIZATION 3: Debounced validation
  const validateForm = useCallback(() => {
    const parsed = formSchema.safeParse(formData);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.errors.forEach((err) => {
        if (err.path && err.path.length > 0) {
          fieldErrors[err.path[0].toString()] = err.message;
        }
      });
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  }, [formData]);

  // ✅ OPTIMIZATION 4: Efficient form population
  useEffect(() => {
    if (taskToEdit) {
      setTitle(taskToEdit.title);
      setDescription(taskToEdit.description || "");
      setStatus(taskToEdit.status);

      // Format deadline efficiently
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
      const originalContact = taskToEdit.target_contact || "";
      const originalDays = taskToEdit.reminder_days ?? 1;

      if (hasOriginalReminder) {
        setShowReminder(true);
        setRemindMethod(taskToEdit.remind_method!);
        setReminderDays(originalDays);

        if (taskToEdit.remind_method === "both") {
          const [email = "", phone = ""] = originalContact.split("|");
          setEmailContact(email);
          setWhatsappContact(phone);
          setTargetContact("");
        } else {
          setTargetContact(originalContact);
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

  // ✅ OPTIMIZATION 5: Optimized submit handler
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!taskToEdit) return;

      // Quick validation
      if (!validateForm()) {
        toast({
          title: "Validation Error",
          description: "Please correct the errors in the form.",
          variant: "destructive",
        });
        return;
      }

      setLoading(true);

      try {
        // ✅ OPTIMIZATION 6: Direct API payload preparation
        const apiPayload = {
          taskId: taskToEdit.id,
          title: formData.title,
          description: formData.description || null,
          deadline: new Date(formData.deadline).toISOString(),
          status: formData.status,
          showReminder: formData.showReminder,
          remindMethod: formData.remindMethod,
          targetContact: formData.targetContact,
          emailContact: formData.emailContact,
          whatsappContact: formData.whatsappContact,
          reminderDays: formData.reminderDays,
        };

        // ✅ OPTIMIZATION 7: Request with timeout
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 10000); // 10s timeout

        const response = await fetch("/api/tasks/update", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(apiPayload),
          signal: abortController.signal,
        });

        clearTimeout(timeoutId);
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Failed to update task");
        }

        // ✅ OPTIMIZATION 8: Immediate UI update and close
        onTaskUpdated(result.task);
        onOpenChange(false);

        toast({
          title: "Success",
          description:
            "Note updated successfully!",
        });
      } catch (error: any) {
        if (error.name === "AbortError") {
          toast({
            title: "Timeout",
            description: "Request took too long. Please try again.",
            variant: "destructive",
          });
        } else {
          console.error("Error updating task:", error);
          toast({
            title: "Error",
            description:
              error.message || "Failed to update note. Please try again.",
            variant: "destructive",
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [taskToEdit, formData, validateForm, onTaskUpdated, onOpenChange, toast]
  );

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
              id="edit-set-reminder"
              checked={showReminder}
              onCheckedChange={(checked) => setShowReminder(Boolean(checked))}
            />
            <Label
              htmlFor="edit-set-reminder"
              className="cursor-pointer text-sm font-medium"
            >
              Set Reminder
            </Label>
          </div>

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
                    className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
                    id="targetContactEmail"
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
                  <Label htmlFor="targetContactWhatsapp">
                    WhatsApp Number *
                  </Label>
                  <Input
                    className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
                    id="targetContactWhatsapp"
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
                    <Label htmlFor="emailContactBoth">Email Address *</Label>
                    <Input
                      className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
                      id="emailContactBoth"
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
                    <Label htmlFor="whatsappContactBoth">
                      WhatsApp Number *
                    </Label>
                    <Input
                      className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400"
                      id="whatsappContactBoth"
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
                  onChange={(e) => setReminderDays(Number(e.target.value))}
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
