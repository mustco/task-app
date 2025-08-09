"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { createTask } from "@/app/actions/task";
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

// schema dipakai untuk client-side guard ringan (opsional)
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
  const [targetContact, setTargetContact] = useState(""); // single input (email/wa)
  const [emailContact, setEmailContact] = useState(""); // for 'both'
  const [whatsappContact, setWhatsappContact] = useState(""); // for 'both'
  const [reminderDays, setReminderDays] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { toast } = useToast();

  // hydrate defaults based on method
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

    const formData = new FormData();
    formData.append("title", title);
    formData.append("description", description);
    formData.append("deadline", deadline);
    formData.append("showReminder", String(showReminder));

    if (showReminder) {
      formData.append("remindMethod", remindMethod ?? "email");
      formData.append("reminderDays", String(reminderDays));

      if (remindMethod === "email") {
        formData.append("target_email", targetContact);
      } else if (remindMethod === "whatsapp") {
        formData.append("target_phone", targetContact);
      } else if (remindMethod === "both") {
        formData.append("target_email", emailContact);
        formData.append("target_phone", whatsappContact);
      }
    }

    const result = await createTask(formData);
    setLoading(false);

    if (result.success) {
      toast({ title: "Success", description: result.message });
      onTaskAdded(result.data as Task);
      onOpenChange(false);
      return;
    }

    // ---- Error handling + mapping ke field UI ----
    if (result.errors) {
      const serverErrors = result.errors as Record<string, string[]>;
      const fieldErrors: Record<string, string> = {};

      // copy apa adanya dulu
      for (const key in serverErrors) {
        const msg = serverErrors[key]?.[0];
        if (msg) fieldErrors[key] = msg;
      }

      // map ke field visual
      if (fieldErrors.target_email && remindMethod === "email") {
        fieldErrors.targetContact = fieldErrors.target_email;
      }
      if (fieldErrors.target_phone && remindMethod === "whatsapp") {
        fieldErrors.targetContact = fieldErrors.target_phone;
      }
      if (fieldErrors.target_email && remindMethod === "both") {
        fieldErrors.emailContact = fieldErrors.target_email;
      }
      if (fieldErrors.target_phone && remindMethod === "both") {
        fieldErrors.whatsappContact = fieldErrors.target_phone;
      }

      setErrors(fieldErrors);
      toast({
        title: "Validation Error",
        description: "Please correct the errors in the form.",
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
                  {(errors.targetContact || errors.target_email) && (
                    <p className="text-red-500 text-sm mt-1">
                      {errors.targetContact || errors.target_email}
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
                  {(errors.targetContact || errors.target_phone) && (
                    <p className="text-red-500 text-sm mt-1">
                      {errors.targetContact || errors.target_phone}
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
                    {(errors.emailContact || errors.target_email) && (
                      <p className="text-red-500 text-sm mt-1">
                        {errors.emailContact || errors.target_email}
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
                    {(errors.whatsappContact || errors.target_phone) && (
                      <p className="text-red-500 text-sm mt-1">
                        {errors.whatsappContact || errors.target_phone}
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
