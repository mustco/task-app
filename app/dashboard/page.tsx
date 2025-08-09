// /dashboard/page.tsx (VERSI FINAL YANG DIPERBAIKI)

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { TaskTable } from "@/components/tasks/task-table";
import { TaskLimits } from "@/components/tasks/task-limit";
import type { Task, User } from "@/lib/types"; // Import Task and User types

const PAGE_SIZE = 20;

export default async function DashboardPage() {
  const supabase = await createClient(); // Menggunakan server-side client

  // 1. Autentikasi Pengguna
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    console.error("Authentication error on dashboard page:", authError);
    redirect("/login");
  }

  // 2. Persiapkan dan Jalankan Semua Query Secara Paralel
  const userProfileQuery = supabase
    .from("users")
    .select("id, name, email, phone_number, role, status")
    .eq("id", user.id)
    .single();

  // ✅ INI BAGIAN YANG DIPERBAIKI
  const userTasksQuery = supabase
    .from("tasks")
    .select(
      "id, user_id, title, description, deadline, status, remind_method, target_email, target_phone, reminder_days"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(0, PAGE_SIZE - 1);

  const totalCountQuery = supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  const pendingCountQuery = supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "pending");

  const inProgressCountQuery = supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "in_progress");

  const completedCountQuery = supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "completed");

  const [
    userProfileResult,
    tasksResult,
    totalCountResult,
    pendingCountResult,
    inProgressCountResult,
    completedCountResult,
  ] = await Promise.all([
    userProfileQuery,
    userTasksQuery,
    totalCountQuery,
    pendingCountQuery,
    inProgressCountQuery,
    completedCountQuery,
  ]);

  // 3. Penanganan Error dan Pengambilan Data
  if (userProfileResult.error) {
    console.error("Error fetching user profile:", userProfileResult.error);
    redirect("/login?error=profile_fetch_failed");
  }
  const userProfile: User | null = userProfileResult.data;

  if (tasksResult.error) {
    console.error("Error fetching tasks:", tasksResult.error);
  }
  const tasks: Task[] = (tasksResult.data as Task[]) || [];

  const totalTasks = totalCountResult.count ?? 0;
  const pendingTasks = pendingCountResult.count ?? 0;
  const inProgressTasks = inProgressCountResult.count ?? 0;
  const completedTasks = completedCountResult.count ?? 0;

  return (
    <DashboardLayout user={userProfile}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Manage your notes and deadlines</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-900">Total Notes</h3>
            <p className="text-3xl font-bold text-blue-600">{totalTasks}</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-900">Pending</h3>
            <p className="text-3xl font-bold text-yellow-600">{pendingTasks}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-900">In Progress</h3>
            <p className="text-3xl font-bold text-orange-600">
              {inProgressTasks}
            </p>{" "}
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-900">Completed</h3>
            <p className="text-3xl font-bold text-green-600">
              {completedTasks}
            </p>
          </div>
        </div>

        <TaskLimits user={userProfile} taskCount={totalTasks} />
        <TaskTable initialTasks={tasks} userProfile={userProfile} />
      </div>
    </DashboardLayout>
  );
}
