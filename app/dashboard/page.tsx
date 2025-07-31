// /dashboard/page.tsx (SECURE & OPTIMIZED VERSION)

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
  // Karena ini Server Component, `createClient()` secara otomatis akan membaca session dari cookies
  // dan menggunakannya untuk `auth.getUser()`.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    console.error("Authentication error on dashboard page:", authError); // Log error autentikasi
    redirect("/login"); // Redirect ke login jika tidak ada user
  }

  // 2. Persiapkan dan Jalankan Semua Query Secara Paralel
  // Semua query ini akan secara otomatis tunduk pada Row-Level Security (RLS)
  // karena menggunakan `createClient()` (server-side client), bukan `supabaseAdmin`.
  // Ini adalah lapisan keamanan utama di sini.

  const userProfileQuery = supabase
    .from("users")
    .select("id, name, email, phone_number, role, status")
    .eq("id", user.id) // Pastikan hanya mengambil profil user yang sedang login
    .single();

  const userTasksQuery = supabase
    .from("tasks")
    .select(
      "id, user_id, title, description, deadline, status, remind_method, target_contact, reminder_days"
    )
    .eq("user_id", user.id) // Penting: Filter by user.id untuk RLS
    .order("created_at", { ascending: false })
    .range(0, PAGE_SIZE - 1);

  // Query counts juga harus difilter berdasarkan user.id untuk RLS
  const totalCountQuery = supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id); // Filter untuk keamanan RLS

  const pendingCountQuery = supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id) // Filter untuk keamanan RLS
    .eq("status", "pending");

  const inProgressCountQuery = supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id) // Filter untuk keamanan RLS
    .eq("status", "in_progress");

  const completedCountQuery = supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id) // Filter untuk keamanan RLS
    .eq("status", "completed");

  // Jalankan semua query secara bersamaan menggunakan Promise.all
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
  // Handle error untuk user profile
  if (userProfileResult.error) {
    console.error("Error fetching user profile:", userProfileResult.error);
    // Ini mungkin berarti ada masalah dengan RLS pada tabel users atau data tidak ada
    // Redirect atau tampilkan pesan error yang sesuai
    redirect("/login?error=profile_fetch_failed");
  }
  const userProfile: User | null = userProfileResult.data;

  // Handle error untuk tasks
  if (tasksResult.error) {
    console.error("Error fetching tasks:", tasksResult.error);
    // Jika gagal mengambil tasks, set ke array kosong untuk mencegah crash
    // Tapi ini juga bisa jadi indikasi RLS tidak benar
  }
  const tasks: Task[] = (tasksResult.data as Task[]) || []; // Cast dan default ke array kosong

  // Ambil hasil count, default ke 0 jika null atau error
  const totalTasks = totalCountResult.count ?? 0;
  const pendingTasks = pendingCountResult.count ?? 0;
  const inProgressTasks = inProgressCountResult.count ?? 0;
  const completedTasks = completedCountResult.count ?? 0;

  // Optimasi RLS: Jika Anda punya RLS yang sangat ketat pada tabel `users`
  // yang hanya mengizinkan user melihat profilnya sendiri, maka `userProfile`
  // akan selalu mengembalikan profil user yang sedang login, atau null/error.
  // Pastikan `userProfile` ini benar-benar `User` type.

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
            {/* Warna disesuaikan dengan badge */}
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-900">Completed</h3>
            <p className="text-3xl font-bold text-green-600">
              {completedTasks}
            </p>
          </div>
        </div>

        <TaskLimits user={userProfile} taskCount={totalTasks} />
        {/* Pastikan `initialTasks` selalu array, bahkan jika tasksResult.data null */}
        <TaskTable initialTasks={tasks} userProfile={userProfile} />
      </div>
    </DashboardLayout>
  );
}
