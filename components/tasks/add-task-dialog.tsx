"use client";

import type React from "react";

import { useState } from "react";
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
import { Loader2 } from "lucide-react";

interface AddTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTaskAdded: (task: Task) => void;
}

export function AddTaskDialog({
  open,
  onOpenChange,
  onTaskAdded,
}: AddTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState(""); // Akan menjadi string YYYY-MM-DDTHH:MM
  const [remindMethod, setRemindMethod] =
    useState<Task["remind_method"]>("email"); // Set default value
  const [targetContact, setTargetContact] = useState("");
  const [reminderDays, setReminderDays] = useState(1); // Nama state diubah sesuai DB
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const supabase = createClient();

 const handleSubmit = async (e: React.FormEvent) => {
   e.preventDefault();
   setLoading(true);

   try {
     const {
       data: { user },
     } = await supabase.auth.getUser();
     if (!user) throw new Error("Not authenticated");

     // --- VALIDASI FRONTEND LEBIH KETAT ---
     if (!title.trim()) {
       throw new Error("Title is required.");
     }
     if (!deadline) {
       throw new Error("Deadline is required.");
     }
     if (!remindMethod) {
       throw new Error("Reminder Method is required.");
     }
     if (!targetContact.trim()) {
       throw new Error("Target Contact is required.");
     }
     // Opsional: Validasi deadline di masa depan
     if (new Date(deadline) <= new Date()) {
       throw new Error("Deadline must be in the future.");
     }
     // ------------------------------------

     const { data, error } = await supabase
       .from("tasks")
       .insert({
         user_id: user.id,
         title: title.trim(),
         description: description.trim() || null,
         deadline: new Date(deadline).toISOString(),
         remind_method: remindMethod,
         target_contact: targetContact.trim(),
         reminder_days: reminderDays,
         status: "pending",
       })
       .select()
       .single();

     if (error) throw error;

     // Schedule reminder menggunakan Trigger.dev
     const scheduleResponse = await fetch("/api/schedule-reminder", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ taskId: data.id }),
     });

     if (!scheduleResponse.ok) {
       console.warn("Failed to schedule reminder, but task was created");
     }

     onTaskAdded(data);

     // Reset form
     setTitle("");
     setDescription("");
     setDeadline("");
     setRemindMethod("email");
     setTargetContact("");
     setReminderDays(1);
     onOpenChange(false);

     toast({
       title: "Success",
       description: "Task created successfully",
     });
   } catch (error: any) {
     console.error("Failed to create task:", error);
     toast({
       title: "Error",
       description: error.message || "Failed to create task",
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
          <DialogTitle>Add New Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
              required
            >
              {" "}
              {/* Tambahkan required */}
              <SelectTrigger>
                <SelectValue placeholder="Select reminder method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {remindMethod && (
            <div>
              <Label htmlFor="targetContact">
                {remindMethod === "email"
                  ? "Email Address"
                  : remindMethod === "whatsapp"
                  ? "WhatsApp Number"
                  : "Email/WhatsApp Contact"}{" "}
                *
              </Label>
              <Input
                id="targetContact"
                value={targetContact}
                onChange={(e) => setTargetContact(e.target.value)}
                placeholder={
                  remindMethod === "email"
                    ? "user@example.com"
                    : remindMethod === "whatsapp"
                    ? "+1234567890"
                    : "Contact information"
                }
                required // Tambahkan required
              />
            </div>
          )}

          <div>
            <Label htmlFor="reminderDays">Remind Days Before</Label>{" "}
            {/* Nama label diubah */}
            <Input
              id="reminderDays" // ID diubah
              type="number"
              min="0"
              max="30"
              value={reminderDays}
              onChange={(e) => setReminderDays(Number.parseInt(e.target.value))}
            />
          </div>

          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
