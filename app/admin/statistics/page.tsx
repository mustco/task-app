// app/admin/statistics/page.tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { StatisticsDashboard } from "@/components/admin/statistics-dashboard";
import { getDetailedStatistics } from "@/lib/actions/statistics";
import { supabaseAdmin } from "@/lib/supabase/admin";

export default async function AdminStatisticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get user profile and check if admin
  const { data: userProfile } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!userProfile || userProfile.role !== "admin") {
    redirect("/dashboard");
  }

  // Get detailed statistics
  const stats = await getDetailedStatistics();

  return (
    <DashboardLayout user={userProfile}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Statistics Dashboard</h1>
          <p className="text-muted-foreground">
            Real-time analytics and usage statistics from your database
          </p>
        </div>

        <StatisticsDashboard initialStats={stats} />
      </div>
    </DashboardLayout>
  );
}