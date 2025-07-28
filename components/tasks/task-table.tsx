"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Task } from "@/lib/types";
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
import { Plus, Trash2, Search } from "lucide-react";
import { AddTaskDialog } from "./add-task-dialog";

interface TaskTableProps {
  initialTasks: Task[];
}

interface ColumnWidths {
  title: number;
  description: number;
  deadline: number;
  status: number;
  reminder: number;
  contact: number;
  actions: number;
}

export function TaskTable({ initialTasks }: TaskTableProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingValues, setEditingValues] = useState<
    Record<string, Partial<Task>>
  >({});

  // Column widths state
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>({
    title: 150,
    description: 200,
    deadline: 180,
    status: 120,
    reminder: 100,
    contact: 150,
    actions: 80,
  });

  const [isResizing, setIsResizing] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const { toast } = useToast();
  const supabase = createClient();

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch =
      task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      task.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || task.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Resizing functions
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, column: keyof ColumnWidths) => {
      e.preventDefault();
      setIsResizing(column);

      const startX = e.clientX;
      const startWidth = columnWidths[column];

      const handleMouseMove = (e: MouseEvent) => {
        const newWidth = Math.max(80, startWidth + (e.clientX - startX));
        setColumnWidths((prev) => ({ ...prev, [column]: newWidth }));
      };

      const handleMouseUp = () => {
        setIsResizing(null);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [columnWidths]
  );

  const updateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      const { error } = await supabase
        .from("tasks")
        .update(updates)
        .eq("id", taskId);
      if (error) throw error;

      setTasks((prev) =>
        prev.map((task) =>
          task.id === taskId ? { ...task, ...updates } : task
        )
      );

      setEditingValues((prev) => {
        const newState = { ...prev };
        delete newState[taskId];
        return newState;
      });

      toast({
        title: "Success",
        description: "Task updated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update task",
        variant: "destructive",
      });
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      const { error } = await supabase.from("tasks").delete().eq("id", taskId);
      if (error) throw error;

      setTasks((prev) => prev.filter((task) => task.id !== taskId));

      toast({
        title: "Success",
        description: "Task deleted successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete task",
        variant: "destructive",
      });
    }
  };

  const handleTaskAdded = (newTask: Task) => {
    setTasks((prev) => [newTask, ...prev]);
    setShowAddDialog(false);
  };

  const getCurrentValue = (taskId: string, field: keyof Task) => {
    return (
      editingValues[taskId]?.[field] ??
      tasks.find((t) => t.id === taskId)?.[field]
    );
  };

  const updateEditingValue = (
    taskId: string,
    field: keyof Task,
    value: any
  ) => {
    setEditingValues((prev) => ({
      ...prev,
      [taskId]: {
        ...prev[taskId],
        [field]: value,
      },
    }));
  };

  const handleFieldBlur = (
    taskId: string,
    field: keyof Task,
    newValue: any
  ) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task && task[field] !== newValue) {
      updateTask(taskId, { [field]: newValue });
    }
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      pending: "bg-yellow-100 text-yellow-800",
      overdue: "bg-blue-100 text-blue-800",
      completed: "bg-green-100 text-green-800",
    };

    return (
      <Badge className={colors[status as keyof typeof colors]}>
        {status.replace("_", " ")}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search tasks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
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
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Task
        </Button>
      </div>

      {/* Resizable Table - All Devices */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table ref={tableRef} className="w-full border-collapse">
          <thead>
            <tr className="border-b bg-gray-50">
              <th
                className="text-left p-3 font-medium text-gray-900 relative border-r border-gray-200"
                style={{ width: columnWidths.title }}
              >
                Title
                <div
                  className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-blue-300 active:bg-blue-400"
                  onMouseDown={(e) => handleMouseDown(e, "title")}
                />
              </th>
              <th
                className="text-left p-3 font-medium text-gray-900 relative border-r border-gray-200"
                style={{ width: columnWidths.description }}
              >
                Description
                <div
                  className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-blue-300 active:bg-blue-400"
                  onMouseDown={(e) => handleMouseDown(e, "description")}
                />
              </th>
              <th
                className="text-left p-3 font-medium text-gray-900 relative border-r border-gray-200"
                style={{ width: columnWidths.deadline }}
              >
                Deadline
                <div
                  className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-blue-300 active:bg-blue-400"
                  onMouseDown={(e) => handleMouseDown(e, "deadline")}
                />
              </th>
              <th
                className="text-left p-3 font-medium text-gray-900 relative border-r border-gray-200"
                style={{ width: columnWidths.status }}
              >
                Status
                <div
                  className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-blue-300 active:bg-blue-400"
                  onMouseDown={(e) => handleMouseDown(e, "status")}
                />
              </th>
              <th
                className="text-left p-3 font-medium text-gray-900 relative border-r border-gray-200"
                style={{ width: columnWidths.reminder }}
              >
                Reminder
                <div
                  className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-blue-300 active:bg-blue-400"
                  onMouseDown={(e) => handleMouseDown(e, "reminder")}
                />
              </th>
              <th
                className="text-left p-3 font-medium text-gray-900 relative border-r border-gray-200"
                style={{ width: columnWidths.contact }}
              >
                Contact
                <div
                  className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-blue-300 active:bg-blue-400"
                  onMouseDown={(e) => handleMouseDown(e, "contact")}
                />
              </th>
              <th
                className="text-left p-3 font-medium text-gray-900"
                style={{ width: columnWidths.actions }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredTasks.map((task) => (
              <tr key={task.id} className="border-b hover:bg-gray-50">
                <td
                  className="p-3 border-r border-gray-100"
                  style={{ width: columnWidths.title }}
                >
                  <Input
                    value={getCurrentValue(task.id, "title") || ""}
                    onChange={(e) =>
                      updateEditingValue(task.id, "title", e.target.value)
                    }
                    onBlur={(e) =>
                      handleFieldBlur(task.id, "title", e.target.value)
                    }
                    className="border-none p-0 h-auto focus-visible:ring-0 bg-transparent font-medium"
                  />
                </td>
                <td
                  className="p-3 border-r border-gray-100"
                  style={{ width: columnWidths.description }}
                >
                  <Input
                    value={getCurrentValue(task.id, "description") || ""}
                    onChange={(e) =>
                      updateEditingValue(task.id, "description", e.target.value)
                    }
                    onBlur={(e) =>
                      handleFieldBlur(task.id, "description", e.target.value)
                    }
                    className="border-none p-0 h-auto focus-visible:ring-0 bg-transparent"
                    placeholder="Add description..."
                  />
                </td>
                <td
                  className="p-3 border-r border-gray-100"
                  style={{ width: columnWidths.deadline }}
                >
                  <Input
                    type="datetime-local"
                    value={
                      task.deadline
                        ? new Date(task.deadline).toISOString().slice(0, 16)
                        : ""
                    }
                    onChange={(e) =>
                      updateEditingValue(task.id, "deadline", e.target.value)
                    }
                    onBlur={(e) =>
                      handleFieldBlur(task.id, "deadline", e.target.value)
                    }
                    className="border-none p-0 h-auto focus-visible:ring-0 bg-transparent"
                  />
                </td>
                <td
                  className="p-3 border-r border-gray-100"
                  style={{ width: columnWidths.status }}
                >
                  <Select
                    value={task.status}
                    onValueChange={(value) =>
                      updateTask(task.id, { status: value as Task["status"] })
                    }
                  >
                    <SelectTrigger className="border-none p-0 h-auto focus-visible:ring-0 bg-transparent">
                      {getStatusBadge(task.status)}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="overdue">Overdue</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td
                  className="p-3 border-r border-gray-100"
                  style={{ width: columnWidths.reminder }}
                >
                  <Select
                    value={task.remind_method || ""}
                    onValueChange={(value) =>
                      updateTask(task.id, {
                        remind_method: value as Task["remind_method"],
                      })
                    }
                  >
                    <SelectTrigger className="border-none p-0 h-auto focus-visible:ring-0 bg-transparent">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td
                  className="p-3 border-r border-gray-100"
                  style={{ width: columnWidths.contact }}
                >
                  <Input
                    value={getCurrentValue(task.id, "target_contact") || ""}
                    onChange={(e) =>
                      updateEditingValue(
                        task.id,
                        "target_contact",
                        e.target.value
                      )
                    }
                    onBlur={(e) =>
                      handleFieldBlur(task.id, "target_contact", e.target.value)
                    }
                    className="border-none p-0 h-auto focus-visible:ring-0 bg-transparent"
                    placeholder="Contact info..."
                  />
                </td>
                <td className="p-3" style={{ width: columnWidths.actions }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteTask(task.id)}
                    className="text-red-600 hover:text-red-800 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredTasks.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            {searchTerm || statusFilter !== "all"
              ? "No tasks match your filters"
              : "No tasks yet. Create your first task!"}
          </div>
        )}
      </div>

      <AddTaskDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onTaskAdded={handleTaskAdded}
      />

      <style jsx>{`
        .resizing {
          user-select: none;
        }

        table {
          table-layout: fixed;
        }

        th,
        td {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        th div:hover {
          background-color: rgba(59, 130, 246, 0.3);
        }

        th div:active {
          background-color: rgba(59, 130, 246, 0.5);
        }
      `}</style>
    </div>
  );
}
