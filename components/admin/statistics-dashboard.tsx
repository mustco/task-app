// components/admin/statistics-dashboard.tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface DetailedStats {
  totalUsers: number;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  overdrueTasks: number;
  recentUsers: Array<{
    id: string;
    email: string;
    created_at: string;
  }>;
  completionRate: number;
}

interface StatisticsDashboardProps {
  initialStats?: DetailedStats;
}

export function StatisticsDashboard({ initialStats }: StatisticsDashboardProps) {
  const [stats, setStats] = useState<DetailedStats | null>(initialStats || null);
  const [loading, setLoading] = useState(!initialStats);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialStats) {
      fetchStats();
    }
  }, [initialStats]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/statistics");
      if (!response.ok) {
        throw new Error("Failed to fetch statistics");
      }
      const data = await response.json();
      setStats(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="animate-spin h-8 w-8" />
        <span className="ml-2">Loading statistics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600">Error loading statistics: {error}</p>
      </div>
    );
  }

  if (!stats) {
    return <div className="p-8 text-center">No statistics available</div>;
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("id-ID", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <span className="text-2xl">👥</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalUsers}</div>
            <p className="text-xs text-muted-foreground">
              Total registered users
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
            <span className="text-2xl">📋</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalTasks}</div>
            <p className="text-xs text-muted-foreground">
              All tasks created
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completion Rate</CardTitle>
            <span className="text-2xl">✅</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completionRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              {stats.completedTasks} of {stats.totalTasks} completed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
            <span className="text-2xl">⏳</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingTasks}</div>
            <p className="text-xs text-muted-foreground">
              {stats.overdrueTasks > 0 && (
                <span className="text-red-600">{stats.overdrueTasks} overdue</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Task Status Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Task Status Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center space-x-2">
              <Badge variant="secondary">Completed</Badge>
              <span>{stats.completedTasks}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline">Pending</Badge>
              <span>{stats.pendingTasks}</span>
            </div>
            {stats.overdrueTasks > 0 && (
              <div className="flex items-center space-x-2">
                <Badge variant="destructive">Overdue</Badge>
                <span>{stats.overdrueTasks}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Users */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Users</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.recentUsers.length > 0 ? (
            <div className="space-y-2">
              {stats.recentUsers.map((user) => (
                <div key={user.id} className="flex justify-between items-center p-2 rounded-lg bg-gray-50">
                  <span className="text-sm">{user.email}</span>
                  <span className="text-xs text-gray-500">
                    {formatDate(user.created_at)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No recent users</p>
          )}
        </CardContent>
      </Card>

      {/* Real-time Data Notice */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-sm text-gray-600">
            <p>📊 Statistics are fetched in real-time from your Supabase database</p>
            <p className="mt-2">
              These numbers reflect actual usage data, not fake statistics
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}