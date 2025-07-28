import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { AdminStats } from "@/components/admin/admin-stats"
import { UserManagement } from "@/components/admin/user-management"

export default async function AdminPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  // Get user profile and check if admin
  const { data: userProfile } = await supabase.from("users").select("*").eq("id", user.id).single()

  if (!userProfile || userProfile.role !== "admin") {
    redirect("/dashboard")
  }

  // Get all users for admin
  const { data: allUsers } = await supabase.from("users").select("*").order("created_at", { ascending: false })

  // Get all tasks for stats
  const { data: allTasks } = await supabase.from("tasks").select("*")

  // Get error logs
  const { data: errorLogs } = await supabase
    .from("error_log")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(50)

  return (
    <DashboardLayout user={userProfile}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-600">Manage users and system statistics</p>
        </div>

        <AdminStats users={allUsers || []} tasks={allTasks || []} errorLogs={errorLogs || []} />

        <UserManagement users={allUsers || []} />
      </div>
    </DashboardLayout>
  )
}
