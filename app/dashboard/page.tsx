import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { TaskTable } from "@/components/tasks/task-table";
// Import TaskLimits component
import { TaskLimits } from "@/components/tasks/task-limit";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get user profile
  const { data: userProfile } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  // Get user tasks
  const { data: tasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <DashboardLayout user={userProfile}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Manage your tasks and deadlines</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-900">Total Tasks</h3>
            <p className="text-3xl font-bold text-blue-600">
              {tasks?.length || 0}
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-900">Pending</h3>
            <p className="text-3xl font-bold text-yellow-600">
              {tasks?.filter((t) => t.status === "pending").length || 0}
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-900">Completed</h3>
            <p className="text-3xl font-bold text-green-600">
              {tasks?.filter((t) => t.status === "completed").length || 0}
            </p>
          </div>
        </div>

        {/* Add TaskLimits component before TaskTable */}
        <TaskLimits user={userProfile} taskCount={tasks?.length || 0} />
        <TaskTable initialTasks={tasks || []} />
      </div>
    </DashboardLayout>
  );
}
