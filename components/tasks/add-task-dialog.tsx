// app/components/tasks/add-task-dialog.tsx (API-DRIVEN VERSION)

"use client";

import type React from "react";
import { useState, useEffect } from "react";
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

// --- State and Props Interfaces ---
interface AddTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTaskAdded: (task: Task) => void;
  defaultEmail: string;
  defaultPhone: string;
}

interface FormErrors {
  [key: string]: string | undefined;
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
  const [errors, setErrors] = useState<FormErrors>({});

  const { toast } = useToast();

  // --- Effects ---

  // Reset form when dialog is closed
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

  // Populate default contact info when reminder options change
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
      // Clear fields if reminder is turned off
      setTargetContact("");
      setEmailContact("");
      setWhatsappContact("");
    }
  }, [showReminder, remindMethod, defaultEmail, defaultPhone]);

  // --- Client-Side Validation ---
  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};
    if (!title.trim()) newErrors.title = "Title is required.";
    if (title.length > 255) newErrors.title = "Title is too long.";
    if (description.length > 1000)
      newErrors.description = "Description is too long.";

    if (!deadline) {
      newErrors.deadline = "Deadline is required.";
    } else if (new Date(deadline) <= new Date()) {
      newErrors.deadline = "Deadline must be in the future.";
    }

    if (showReminder) {
      if (remindMethod === "email" && !validator.isEmail(targetContact)) {
        newErrors.targetContact = "A valid email is required.";
      }
      if (
        remindMethod === "whatsapp" &&
        !/^(0|62|\+62)[\d]{8,15}$/.test(targetContact.replace(/[\s-]/g, ""))
      ) {
        newErrors.targetContact = "A valid WhatsApp number is required.";
      }
      if (remindMethod === "both") {
        if (!validator.isEmail(emailContact))
          newErrors.emailContact = "A valid email is required.";
        if (
          !/^(0|62|\+62)[\d]{8,15}$/.test(whatsappContact.replace(/[\s-]/g, ""))
        )
          newErrors.whatsappContact = "A valid WhatsApp number is required.";
      }
      if (reminderDays < 0 || reminderDays > 365) {
        newErrors.reminderDays = "Days must be between 0 and 365.";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // --- Submission Handler ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) {
      toast({
        title: "Validation Error",
        description: "Please check the form for errors.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    // Prepare payload for the API
    let finalTargetContact: string | null = null;
    if (showReminder) {
      if (remindMethod === "email" || remindMethod === "whatsapp") {
        finalTargetContact = targetContact;
      } else if (remindMethod === "both") {
        finalTargetContact = `${emailContact}|${whatsappContact}`;
      }
    }

    const payload = {
      title,
      description: description || null,
      deadline,
      showReminder,
      remindMethod: showReminder ? remindMethod : null,
      targetContact: finalTargetContact,
      reminderDays: showReminder ? reminderDays : null,
    };

    try {
      const response = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        // Handle server-side validation errors
        if (response.status === 400 && result.details) {
          const serverErrors: FormErrors = {};
          for (const key in result.details) {
            serverErrors[key] = result.details[key][0];
          }
          setErrors(serverErrors);
        }
        throw new Error(result.error || "Failed to create task.");
      }

      // Success
      toast({ title: "Success", description: "Note created successfully." });
      onTaskAdded(result as Task);
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error creating task:", error);
      toast({
        title: "Error",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // --- Render ---
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          {/* Title */}
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            {errors.title && (
              <p className="text-red-500 text-sm mt-1">{errors.title}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
            {errors.description && (
              <p className="text-red-500 text-sm mt-1">{errors.description}</p>
            )}
          </div>

          {/* Deadline */}
          <div>
            <Label htmlFor="deadline">Deadline *</Label>
            <Input
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

          {/* Reminder Checkbox */}
          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
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

          {/* Reminder Options */}
          {showReminder && (
            <div className="space-y-4 border-t pt-4 animate-in fade-in-0 duration-300">
              {/* Reminder Method */}
              <div>
                <Label htmlFor="remindMethod">Reminder Method *</Label>
                <Select
                  value={remindMethod ?? ""}
                  onValueChange={(value) =>
                    setRemindMethod(value as Task["remind_method"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Contact Inputs */}
              {remindMethod === "email" && (
                <div>
                  <Label htmlFor="targetContact">Email Address *</Label>
                  <Input
                    id="targetContact"
                    value={targetContact}
                    onChange={(e) => setTargetContact(e.target.value)}
                    type="email"
                    required
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
                    id="targetContact"
                    value={targetContact}
                    onChange={(e) => setTargetContact(e.target.value)}
                    required
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
                      id="emailContact"
                      value={emailContact}
                      onChange={(e) => setEmailContact(e.target.value)}
                      type="email"
                      required
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
                      id="whatsappContact"
                      value={whatsappContact}
                      onChange={(e) => setWhatsappContact(e.target.value)}
                      required
                    />
                    {errors.whatsappContact && (
                      <p className="text-red-500 text-sm mt-1">
                        {errors.whatsappContact}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Reminder Days */}
              <div>
                <Label htmlFor="reminderDays">Remind Days Before</Label>
                <Input
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

          {/* Action Buttons */}
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
