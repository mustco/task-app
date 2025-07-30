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
import { Loader2 } from "lucide-react";

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
  const [deadline, setDeadline] = useState(""); // Akan menjadi string YYYY-MM-DDTHH:MM
  const [remindMethod, setRemindMethod] =
    useState<Task["remind_method"]>("email"); // Set default value
  const [targetContact, setTargetContact] = useState("");
  // State baru untuk input terpisah ketika "both"
  const [emailContact, setEmailContact] = useState("");
  const [whatsappContact, setWhatsappContact] = useState("");
  const [reminderDays, setReminderDays] = useState(1); // Nama state diubah sesuai DB
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const supabase = createClient();

  useEffect(() => {
    // Hanya jalankan jika dialog terbuka
    if (open) {
      if (remindMethod === "email") {
        setTargetContact(defaultEmail);
      } else if (remindMethod === "whatsapp") {
        setTargetContact(defaultPhone);
      } else if (remindMethod === "both") {
        // Set default values untuk kedua input
        setEmailContact(defaultEmail);
        setWhatsappContact(defaultPhone);
        setTargetContact(""); // Kosongkan target contact karena kita pakai input terpisah
      } else {
        setTargetContact("");
      }
    }
  }, [open, remindMethod, defaultEmail, defaultPhone]);

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

      // Validasi berdasarkan remind method
      let finalTargetContact = "";
      if (remindMethod === "email") {
        if (!targetContact.trim()) {
          throw new Error("Email address is required.");
        }
        finalTargetContact = targetContact.trim();
      } else if (remindMethod === "whatsapp") {
        if (!targetContact.trim()) {
          throw new Error("WhatsApp number is required.");
        }
        finalTargetContact = targetContact.trim();
      } else if (remindMethod === "both") {
        if (!emailContact.trim()) {
          throw new Error("Email address is required.");
        }
        if (!whatsappContact.trim()) {
          throw new Error("WhatsApp number is required.");
        }
        // Gabungkan email dan whatsapp dengan separator (misalnya |)
        finalTargetContact = `${emailContact.trim()}|${whatsappContact.trim()}`;
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
          target_contact: finalTargetContact,
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
        console.warn("Failed to schedule reminder, but note was created");
      }

      onTaskAdded(data);

      // Reset form
      setTitle("");
      setDescription("");
      setDeadline("");
      setRemindMethod("email");
      setTargetContact("");
      setEmailContact("");
      setWhatsappContact("");
      setReminderDays(1);
      onOpenChange(false);

      toast({
        title: "Success",
        description: "Task created successfully",
      });
    } catch (error: any) {
      console.error("Failed to create note:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create note",
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
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input
              className="!border !border-gray-300 !bg-white !text-black 
             focus:!border-gray-500 focus:!ring-0 
             !ring-0 !ring-offset-0 !shadow-none 
             !outline-none !rounded-md 
             placeholder:text-gray-400"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              className="!border !border-gray-300 !bg-white !text-black 
             focus:!border-gray-500 focus:!ring-0 
             !ring-0 !ring-offset-0 !shadow-none 
             !outline-none !rounded-md 
             placeholder:text-gray-400"
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="deadline">Deadline *</Label>
            <Input
              className="!border !border-gray-300 !bg-white !text-black 
             focus:!border-gray-500 focus:!ring-0 
             !ring-0 !ring-offset-0 !shadow-none 
             !outline-none !rounded-md 
             placeholder:text-gray-400"
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
              <SelectTrigger
                className="!border !border-gray-300 !bg-white !text-black 
             focus:!border-gray-500 focus:!ring-0 
             !ring-0 !ring-offset-0 !shadow-none 
             !outline-none !rounded-md 
             placeholder:text-gray-400"
              >
                <SelectValue placeholder="Select reminder method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Render input berdasarkan remind method */}
          {remindMethod === "email" && (
            <div>
              <Label htmlFor="targetContact">Email Address *</Label>
              <Input
                id="targetContact"
                className="!border !border-gray-300 !bg-white !text-black 
               focus:!border-gray-500 focus:!ring-0 
               !ring-0 !ring-offset-0 !shadow-none 
               !outline-none !rounded-md 
               placeholder:text-gray-400"
                value={targetContact}
                onChange={(e) => setTargetContact(e.target.value)}
                placeholder="user@example.com"
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
                className="!border !border-gray-300 !bg-white !text-black 
               focus:!border-gray-500 focus:!ring-0 
               !ring-0 !ring-offset-0 !shadow-none 
               !outline-none !rounded-md 
               placeholder:text-gray-400"
                value={targetContact}
                onChange={(e) => setTargetContact(e.target.value)}
                placeholder="+1234567890"
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
                  className="!border !border-gray-300 !bg-white !text-black 
                   focus:!border-gray-500 focus:!ring-0 
                   !ring-0 !ring-offset-0 !shadow-none 
                   !outline-none !rounded-md 
                   placeholder:text-gray-400"
                  value={emailContact}
                  onChange={(e) => setEmailContact(e.target.value)}
                  placeholder="user@example.com"
                  type="email"
                  required
                />
              </div>
              <div>
                <Label htmlFor="whatsappContact">WhatsApp Number *</Label>
                <Input
                  id="whatsappContact"
                  className="!border !border-gray-300 !bg-white !text-black 
                   focus:!border-gray-500 focus:!ring-0 
                   !ring-0 !ring-offset-0 !shadow-none 
                   !outline-none !rounded-md 
                   placeholder:text-gray-400"
                  value={whatsappContact}
                  onChange={(e) => setWhatsappContact(e.target.value)}
                  placeholder="+1234567890"
                  required
                />
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="reminderDays">Remind Days Before</Label>
            <Input
              className="!border !border-gray-300 !bg-white !text-black 
             focus:!border-gray-500 focus:!ring-0 
             !ring-0 !ring-offset-0 !shadow-none 
             !outline-none !rounded-md 
             placeholder:text-gray-400"
              id="reminderDays"
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
              {loading ? "Creating..." : "Create Note"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
