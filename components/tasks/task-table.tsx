// app/components/TaskTable.tsx (KODE LENGKAP - HANYA MENGUBAH KONTAK)

"use client";

import { useState, useRef, useEffect, useMemo, useDeferredValue } from "react";
import dynamic from "next/dynamic";
import { useInView } from "react-intersection-observer";
import { createClient } from "@/lib/supabase/client";
import type { Task, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { deleteTask as deleteTaskAction } from "@/app/actions/deleteTask";
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
  Loader2,
} from "lucide-react";

// Optimasi: Lazy load komponen dialog
const AddTaskDialog = dynamic(() => 
  import("./add-task-dialog").then((mod) => mod.AddTaskDialog)
);
const EditTaskDialog = dynamic(() => 
  import("./edit-task-dialog").then((mod) => mod.EditTaskDialog)
);

const PAGE_SIZE = 20;

interface TaskTableProps {
  initialTasks: Task[];
  userProfile: User | null;
}

export function TaskTable({ initialTasks, userProfile }: TaskTableProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [rawSearchTerm, setRawSearchTerm] = useState("");
  const debouncedSearchTerm = useDeferredValue(rawSearchTerm);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialTasks.length === PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const { ref, inView } = useInView({
    threshold: 0,
    triggerOnce: false,
  });

  const tableRef = useRef<HTMLTableElement>(null);
  const { toast } = useToast();
  const supabase = createClient();

  const loadMoreTasks = async () => {
    if (loadingMore || !hasMore) return;

    setLoadingMore(true);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const userId = userProfile?.id;
    if (!userId) {
      toast({ title: "Error", description: "User session not found." });
      setLoadingMore(false);
      return;
    }

    const { data: newTasks, error } = await supabase
      .from("tasks")
      .select(
        "id, user_id, title, description, deadline, status, remind_method, target_email, target_phone, reminder_days"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);
      
    if (error) {
      console.error("Error loading more tasks:", error);
      toast({
        title: "Error",
        description: "Failed to load more tasks.",
        variant: "destructive",
      });
      setHasMore(false);
    } else if (newTasks) {
      setTasks((prev) => [...prev, ...newTasks]);
      setPage((prev) => prev + 1);
      setHasMore(newTasks.length === PAGE_SIZE);
    }

    setLoadingMore(false);
  };
  useEffect(() => {
    if (inView && hasMore && !loadingMore) {
      loadMoreTasks();
    }
  }, [inView, hasMore, loadingMore]);

  const filteredTasks = useMemo(() => {
    const searchLower = debouncedSearchTerm.toLowerCase();
    return tasks.filter((task) => {
      const matchesSearch =
        task.title.toLowerCase().includes(searchLower) ||
        (task.description ?? "").toLowerCase().includes(searchLower) ||
        (task.target_email ?? "").toLowerCase().includes(searchLower) ||
        (task.target_phone ?? "").toLowerCase().includes(searchLower);

      const matchesStatus =
        statusFilter === "all" || task.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [tasks, debouncedSearchTerm, statusFilter]);
 const deleteTask = async (taskId: string) => {
  if (!confirm("Are you sure you want to delete this note? This action cannot be undone.")) return;

  try {
    const result = await deleteTaskAction(taskId);

    if (!result.success) {
      throw new Error(result.message || "Failed to delete task");
    }

    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    const message = result.reminderCancelled
      ? "Note and reminder deleted successfully."
      : "Note deleted successfully.";

    toast({ title: "Success", description: message });
  } catch (err: any) {
    toast({
      title: "Error deleting note",
      description: err.message || "An unexpected error occurred.",
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
      in_progress: "bg-orange-100 hover:bg-orange-200 text-orange-800",
    };
    const statusText = status.charAt(0).toUpperCase() + status.slice(1);
    return (
      <Badge className={colors[status] || "bg-gray-100 text-gray-800"}>
        {statusText.replace(/_/g, " ")}
      </Badge>
    );
  };

  const formatDeadline = (dateString: string) => {
    if (!dateString) return "-";
    try {
      return new Intl.DateTimeFormat("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Jakarta",
      }).format(new Date(dateString));
    } catch (e) {
      console.error("Invalid date string:", dateString, e);
      return "Invalid Date";
    }
  };

  const columnMinWidths = {
    title: 150,
    description: 200,
    deadline: 150,
    status: 120,
    reminder: 100,
    remindDays: 130,
    contact: 180,
    actions: 80,
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
              value={rawSearchTerm}
              onChange={(e) => setRawSearchTerm(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 !border !border-gray-300 !bg-white !text-black focus:!border-gray-500 focus:!ring-0 !ring-offset-0 !shadow-none !outline-none !rounded-md placeholder:text-gray-400">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
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
              <th
                className="text-left p-3 font-semibold text-gray-600"
                style={{ minWidth: `${columnMinWidths.actions}px` }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredTasks.length > 0 ? (
              filteredTasks.map((task) => {
                return (
                  <tr
                    key={task.id}
                    className="odd:bg-white even:bg-slate-50 hover:bg-teal-50 border-b"
                  >
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
                      {task.remind_method || "-"}
                    </td>
                    <td className="p-3 align-top border-r">
                      {task.reminder_days !== null &&
                      task.reminder_days !== undefined &&
                      task.reminder_days > 0
                        ? `${task.reminder_days} ${task.reminder_days > 1 ? "days" : "day"} before`
                        : task.remind_method
                          ? "On the day"
                          : "-"}
                    </td>
                    <td className="p-3 align-top border-r">
                      <div className="flex flex-col gap-1">
                        {task.target_email && (
                          <div className="flex items-center gap-2">
                            <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />{" "}
                            <span>{task.target_email}</span>
                          </div>
                        )}
                        {task.target_phone && (
                          <div className="flex items-center gap-2">
                            <MessageSquare className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />{" "}
                            <span>{task.target_phone}</span>
                          </div>
                        )}
                        {!task.target_email && !task.target_phone && (
                          <span>-</span>
                        )}
                      </div>
                    </td>
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
              })
            ) : (
              <tr>
                <td colSpan={8} className="text-center py-8 text-gray-500">
                  {loadingMore ? (
                    <Loader2 className="animate-spin text-gray-500 mx-auto" />
                  ) : (
                    <p className="font-semibold">
                      No notes found matching your criteria.
                    </p>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {hasMore && (
          <div ref={ref} className="h-10 flex justify-center items-center">
            {loadingMore && <Loader2 className="animate-spin text-gray-500" />}
          </div>
        )}
        {tasks.length === 0 && !loadingMore && filteredTasks.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p className="font-semibold">No Notes Found</p>
            <p className="text-sm mt-1">
              Click 'Add Note' to create your first note!
            </p>
          </div>
        )}
        {tasks.length > 0 && filteredTasks.length === 0 && !loadingMore && (
          <div className="text-center py-12 text-gray-500">
            <p className="font-semibold">
              No notes found matching your search or filter.
            </p>
          </div>
        )}
        {!hasMore && tasks.length > 0 && filteredTasks.length > 0 && (
          <div className="text-center py-4 text-gray-500 text-sm">
            You have reached the end of the list.
          </div>
        )}
      </div>

      {showAddDialog && <AddTaskDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onTaskAdded={handleTaskAdded}
        defaultEmail={userProfile?.email || ""}
        defaultPhone={userProfile?.phone_number || ""}
      />}

      {editingTask && <EditTaskDialog
        open={editingTask !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setEditingTask(null);
          }
        }}
        taskToEdit={editingTask}
        onTaskUpdated={handleTaskUpdated}
      />}
    </div>
  );
}