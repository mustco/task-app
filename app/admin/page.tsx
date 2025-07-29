import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { AdminStats } from "@/components/admin/admin-stats";
import { UserManagement } from "@/components/admin/user-management";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get user profile and check if admin (gunakan service role)
  const supabaseAdmin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: userProfile } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!userProfile || userProfile.role !== "admin") {
    redirect("/dashboard");
  }

  // Get all data using service role (bypass RLS completely)
  const { data: allUsers } = await supabaseAdmin
    .from("users")
    .select("*")
    .order("created_at", { ascending: false });
  const { data: allTasks } = await supabaseAdmin.from("tasks").select("*");
  const { data: errorLogs } = await supabaseAdmin
    .from("error_log")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(50);

  return (
    <DashboardLayout user={userProfile}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-600">Manage users and system statistics</p>
        </div>

        <AdminStats
          users={allUsers || []}
          tasks={allTasks || []}
          errorLogs={errorLogs || []}
        />
        <UserManagement users={allUsers || []} />
      </div>
    </DashboardLayout>
  );
}
