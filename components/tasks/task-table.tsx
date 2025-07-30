"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Task, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Search,
  Mail,
  MessageSquare,
  Pencil,
} from "lucide-react";
import { AddTaskDialog } from "./add-task-dialog";
import { EditTaskDialog } from "./edit-task-dialog";

interface TaskTableProps {
  initialTasks: Task[];
  userProfile: User | null;
}

export function TaskTable({ initialTasks, userProfile }: TaskTableProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const columnMinWidths = {
    title: 150,
    description: 200,
    deadline: 150,
    status: 110,
    reminder: 100,
    remindDays: 130,
    contact: 180,
    actions: 80,
  };

  const tableRef = useRef<HTMLTableElement>(null);
  const { toast } = useToast();
  const supabase = createClient();

  const filteredTasks = tasks.filter((task) => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch =
      task.title.toLowerCase().includes(searchLower) ||
      task.description?.toLowerCase().includes(searchLower) ||
      task.target_contact?.toLowerCase().includes(searchLower);
    const matchesStatus =
      statusFilter === "all" || task.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const deleteTask = async (taskId: string) => {
    if (!confirm("Are you sure you want to delete this note?")) {
      return;
    }
    try {
      const { error } = await supabase.from("tasks").delete().eq("id", taskId);
      if (error) throw error;
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
      toast({
        title: "Success",
        description: "Note deleted successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete note",
        variant: "destructive",
      });
    }
  };

  const handleTaskAdded = (newTask: Task) => {
    setTasks((prev) => [newTask, ...prev]);
  };

  const handleTaskUpdated = (updatedTask: Task) => {
    setTasks((prevTasks) =>
      prevTasks.map((task) => (task.id === updatedTask.id ? updatedTask : task))
    );
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-yellow-100 hover:bg-yellow-200 text-yellow-800",
      overdue: "bg-red-100 hover:bg-red-200 text-red-800",
      completed: "bg-green-100 hover:bg-green-200 text-green-800",
    };
    const statusText = status.charAt(0).toUpperCase() + status.slice(1);
    return (
      <Badge className={colors[status] || "bg-gray-100 text-gray-800"}>
        {statusText}
      </Badge>
    );
  };

  const formatDeadline = (dateString: string) => {
    if (!dateString) return "-";
    return new Date(dateString)
      .toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
      .replace(/\./g, ":");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              className="!border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400 pl-10"
              placeholder="Search notes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 !border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={() => setShowAddDialog(true)}
          className="w-full sm:w-auto"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Note
        </Button>
      </div>

      <div className="bg-white rounded-lg shadow border overflow-x-auto">
        <table ref={tableRef} className="w-full text-sm">
          <thead className="bg-slate-100">
            <tr className="border-b">
              {/* === PERUBAHAN 1: Menambahkan 'border-r' pada <th> === */}
              <th
                className="text-left p-3 font-semibold text-gray-600 border-r"
                style={{ minWidth: `${columnMinWidths.title}px` }}
              >
                Title
              </th>
              <th
                className="text-left p-3 font-semibold text-gray-600 border-r"
                style={{ minWidth: `${columnMinWidths.description}px` }}
              >
                Description
              </th>
              <th
                className="text-left p-3 font-semibold text-gray-600 border-r"
                style={{ minWidth: `${columnMinWidths.deadline}px` }}
              >
                Deadline
              </th>
              <th
                className="text-left p-3 font-semibold text-gray-600 border-r"
                style={{ minWidth: `${columnMinWidths.status}px` }}
              >
                Status
              </th>
              <th
                className="text-left p-3 font-semibold text-gray-600 border-r"
                style={{ minWidth: `${columnMinWidths.reminder}px` }}
              >
                Reminder
              </th>
              <th
                className="text-left p-3 font-semibold text-gray-600 border-r"
                style={{ minWidth: `${columnMinWidths.remindDays}px` }}
              >
                Remind Before
              </th>
              <th
                className="text-left p-3 font-semibold text-gray-600 border-r"
                style={{ minWidth: `${columnMinWidths.contact}px` }}
              >
                Contact
              </th>
              {/* Kolom terakhir tidak perlu 'border-r' */}
              <th
                className="text-left p-3 font-semibold text-gray-600"
                style={{ minWidth: `${columnMinWidths.actions}px` }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredTasks.map((task) => {
              const [emailPart = "", phonePart = ""] = (
                task.target_contact || "|"
              ).split("|");
              return (
                // === PERUBAHAN 2: Menambahkan warna selang-seling pada <tr> ===
                <tr
                  key={task.id}
                  className="odd:bg-white even:bg-slate-50 hover:bg-teal-50 border-b"
                >
                  {/* === PERUBAHAN 3: Menambahkan 'border-r' pada <td> === */}
                  <td className="p-3 align-top font-medium text-gray-800 border-r">
                    {task.title}
                  </td>
                  <td className="p-3 align-top text-gray-600 border-r">
                    {task.description || "-"}
                  </td>
                  <td className="p-3 align-top border-r">
                    {formatDeadline(task.deadline ?? "")}
                  </td>
                  <td className="p-3 align-top border-r">
                    {getStatusBadge(task.status)}
                  </td>
                  <td className="p-3 align-top capitalize border-r">
                    {task.remind_method}
                  </td>
                  <td className="p-3 align-top border-r">
                    {task.remind_days_before > 0
                      ? `${task.remind_days_before} ${task.remind_days_before > 1 ? "days" : "day"} before`
                      : "On the day"}
                  </td>
                  <td className="p-3 align-top border-r">
                    <div className="flex flex-col gap-1">
                      {task.remind_method === "email" && (
                        <div className="flex items-center gap-2">
                          <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />{" "}
                          <span>{task.target_contact}</span>
                        </div>
                      )}
                      {task.remind_method === "whatsapp" && (
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />{" "}
                          <span>{task.target_contact}</span>
                        </div>
                      )}
                      {task.remind_method === "both" && (
                        <>
                          {emailPart && (
                            <div className="flex items-center gap-2">
                              <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />{" "}
                              <span>{emailPart}</span>
                            </div>
                          )}
                          {phonePart && (
                            <div className="flex items-center gap-2">
                              <MessageSquare className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />{" "}
                              <span>{phonePart}</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                  {/* Kolom terakhir tidak perlu 'border-r' */}
                  <td className="p-3 align-top">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingTask(task)}
                        className="text-blue-500 hover:text-blue-700 hover:bg-blue-100 h-8 w-8"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteTask(task.id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-100 h-8 w-8"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredTasks.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p className="font-semibold">No Notes Found</p>
            <p className="text-sm mt-1">
              {searchTerm || statusFilter !== "all"
                ? "Try adjusting your search or filters."
                : "Click 'Add Note' to create your first note!"}
            </p>
          </div>
        )}
      </div>

      {showAddDialog && (
        <AddTaskDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          onTaskAdded={handleTaskAdded}
          defaultEmail={userProfile?.email || ""}
          defaultPhone={userProfile?.phone_number || ""}
        />
      )}

      <EditTaskDialog
        open={editingTask !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setEditingTask(null);
          }
        }}
        taskToEdit={editingTask}
        onTaskUpdated={handleTaskUpdated}
      />

      {/* Tidak perlu lagi <style jsx> karena kita menggunakan kelas Tailwind */}
    </div>
  );
}
