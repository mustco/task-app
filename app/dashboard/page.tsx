// /dashboard/page.tsx (VERSI FINAL YANG DIPERBAIKI)

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { TaskTable } from "@/components/tasks/task-table";
import { TaskLimits } from "@/components/tasks/task-limit";
import type { Task, User } from "@/lib/types"; // Import Task and User types

export default async function DashboardPage() {
  const supabase = await createClient();

  // 1. Autentikasi Pengguna (tetap sama)
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  // 2. Panggil fungsi RPC untuk mendapatkan semua data sekaligus
  const { data: dashboardData, error: rpcError } = await supabase.rpc(
    "get_dashboard_data"
  );

  if (rpcError) {
    console.error("Error fetching dashboard data:", rpcError);
    // Mungkin redirect ke halaman error atau menampilkan pesan
    redirect("/login?error=dashboard_fetch_failed");
  }

  // 3. Ekstrak data dari hasil RPC
  const userProfile: User | null = dashboardData.userProfile;
  const tasks: Task[] = dashboardData.tasks || [];
  const totalTasks = dashboardData.totalTasks ?? 0;
  const pendingTasks = dashboardData.pendingTasks ?? 0;
  const inProgressTasks = dashboardData.inProgressTasks ?? 0;
  const completedTasks = dashboardData.completedTasks ?? 0;

  if (!userProfile) {
    console.error("User profile not found in RPC result");
    redirect("/login?error=profile_not_found");
  }

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