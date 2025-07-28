import type { User, Task, ErrorLog } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AdminStatsProps {
  users: User[];
  tasks: Task[];
  errorLogs: ErrorLog[];
}

export function AdminStats({ users, tasks, errorLogs }: AdminStatsProps) {
  const totalUsers = users.length;
  const activeUsers = users.filter((user) => user.status === "active").length;
  const suspendedUsers = users.filter(
    (user) => user.status === "suspended"
  ).length;

  // Add subscription stats to admin dashboard
  const freeUsers = users.filter(
    (user) => user.subscription_plan === "free"
  ).length;
  const premiumUsers = users.filter(
    (user) => user.subscription_plan === "premium"
  ).length;

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(
    (task) => task.status === "completed"
  ).length;
  const pendingTasks = tasks.filter((task) => task.status === "pending").length;
  const recentErrors = errorLogs.length;

  // Calculate active users (users who created tasks in the last week)
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const recentlyActiveUsers = new Set(
    tasks
      .filter((task) => new Date(task.created_at) > oneWeekAgo)
      .map((task) => task.user_id)
  ).size;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Users</CardTitle>
          <div className="text-2xl font-bold">{totalUsers}</div>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">
            {activeUsers} active, {suspendedUsers} suspended
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Active This Week
          </CardTitle>
          <div className="text-2xl font-bold">{recentlyActiveUsers}</div>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">
            Users who created tasks
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
          <div className="text-2xl font-bold">{totalTasks}</div>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">
            {completedTasks} completed, {pendingTasks} pending
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Recent Errors</CardTitle>
          <div className="text-2xl font-bold">{recentErrors}</div>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">
            Notification failures
          </div>
        </CardContent>
      </Card>

      {/* Add new card for subscription stats */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Subscriptions</CardTitle>
          <div className="text-2xl font-bold">{premiumUsers}</div>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">
            {freeUsers} free, {premiumUsers} premium
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
