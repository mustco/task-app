// app/dashboard/_components/DashboardData.tsx
import { createClient } from "@/lib/supabase/server";
import type { Task, User } from "@/lib/types";
import { TaskTable } from "@/components/tasks/task-table";

// Kalau kamu bikin RPC untuk counts, aktifkan ini di Supabase:
// create or replace function public.task_counts_by_user(uid uuid)
// returns table(total bigint, pending bigint, in_progress bigint, completed bigint)
// language sql stable as $$
//   select
//     count(*) as total,
//     count(*) filter (where status = 'pending') as pending,
//     count(*) filter (where status = 'in_progress') as in_progress,
//     count(*) filter (where status = 'completed') as completed
//   from public.tasks
//   where user_id = uid;
// $$;

const PAGE_SIZE = 20;

export async function DashboardData({
  userId,
  userProfile,
}: {
  userId: string;
  userProfile: User | null;
}) {
  const supabase = await createClient();

  // Jalankan paralel: counts + page 1 tasks
  const countsPromise = supabase.rpc("task_counts_by_user", { uid: userId });
  const tasksPromise = supabase
    .from("tasks")
    .select(
      "id, user_id, title, description, deadline, status, remind_method, target_email, target_phone, reminder_days"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(0, PAGE_SIZE - 1);

  const [countsResult, tasksResult] = await Promise.all([
    countsPromise,
    tasksPromise,
  ]);

  // fallback kalau RPC belum dibuat: hitung kasar di client nanti
  const totalTasks = countsResult.data?.[0]?.total ?? tasksResult.count ?? 0; // biasanya 0 kalau nggak head:true
  const pendingTasks = countsResult.data?.[0]?.pending ?? 0;
  const inProgressTasks = countsResult.data?.[0]?.in_progress ?? 0;
  const completedTasks = countsResult.data?.[0]?.completed ?? 0;

  const tasks = (tasksResult.data as Task[]) || [];

  return (
    <>
      {/* KPI cards */}
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
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900">Completed</h3>
          <p className="text-3xl font-bold text-green-600">{completedTasks}</p>
        </div>
      </div>

      {/* Table (client component) */}
      <TaskTable initialTasks={tasks} userProfile={userProfile} />
    </>
  );
}
