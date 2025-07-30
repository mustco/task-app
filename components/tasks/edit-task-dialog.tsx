// components/edit-task-dialog.tsx

"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
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
  const [remindMethod, setRemindMethod] =
    useState<Task["remind_method"]>("email");
  const [targetContact, setTargetContact] = useState("");
  const [emailContact, setEmailContact] = useState("");
  const [whatsappContact, setWhatsappContact] = useState("");
  const [reminderDays, setReminderDays] = useState(1); // State sudah ada
  const [status, setStatus] = useState<Task["status"]>("pending");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const supabase = createClient();

  useEffect(() => {
    if (taskToEdit) {
      setTitle(taskToEdit.title);
      setDescription(taskToEdit.description || "");
      setStatus(taskToEdit.status);
      setRemindMethod(taskToEdit.remind_method);
      setReminderDays(taskToEdit.remind_days_before || 1); // <-- PASTIKAN STATE DI-SET

      if (taskToEdit.deadline) {
        const localDate = new Date(
          new Date(taskToEdit.deadline).getTime() -
            new Date().getTimezoneOffset() * 60000
        );
        setDeadline(localDate.toISOString().slice(0, 16));
      }

      if (taskToEdit.remind_method === "both") {
        const [email = "", phone = ""] = (
          taskToEdit.target_contact || "|"
        ).split("|");
        setEmailContact(email);
        setWhatsappContact(phone);
        setTargetContact("");
      } else {
        setTargetContact(taskToEdit.target_contact || "");
        setEmailContact("");
        setWhatsappContact("");
      }
    }
  }, [taskToEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskToEdit) return;
    setLoading(true);

    try {
      let finalTargetContact = "";
      if (remindMethod === "email") finalTargetContact = targetContact.trim();
      else if (remindMethod === "whatsapp")
        finalTargetContact = targetContact.trim();
      else if (remindMethod === "both")
        finalTargetContact = `${emailContact.trim()}|${whatsappContact.trim()}`;

      const updates = {
        title: title.trim(),
        description: description.trim() || null,
        deadline: new Date(deadline).toISOString(),
        remind_method: remindMethod,
        target_contact: finalTargetContact,
        reminder_days: reminderDays, // <-- PASTIKAN DIKIRIM DALAM UPDATE
        status: status,
      };

      const { data, error } = await supabase
        .from("tasks")
        .update(updates)
        .eq("id", taskToEdit.id)
        .select()
        .single();

      if (error) throw error;

      onTaskUpdated(data);

      toast({ title: "Success", description: "Note updated successfully" });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update note",
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
          <DialogTitle>Edit Note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ... input title, description, status, deadline, remindMethod ... */}
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div>
            <Label htmlFor="status">Status *</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as Task["status"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="deadline">Deadline *</Label>
            <Input
              id="deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="remindMethod">Reminder Method *</Label>
            <Select
              value={remindMethod}
              onValueChange={(value) =>
                setRemindMethod(value as Task["remind_method"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ... conditional input untuk kontak ... */}
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
              </div>
              <div>
                <Label htmlFor="whatsappContact">WhatsApp Number *</Label>
                <Input
                  id="whatsappContact"
                  value={whatsappContact}
                  onChange={(e) => setWhatsappContact(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {/* === TAMBAHKAN KEMBALI INPUT UNTUK REMINDER DAYS === */}
          <div>
            <Label htmlFor="reminderDays">Remind Days Before</Label>
            <Input
              id="reminderDays"
              type="number"
              min="0"
              max="30"
              value={reminderDays}
              onChange={(e) =>
                setReminderDays(Number.parseInt(e.target.value, 10))
              }
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
