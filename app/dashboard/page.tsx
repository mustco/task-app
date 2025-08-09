// app/dashboard/page.tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import type { User } from "@/lib/types";
import { DashboardSkeleton } from "./_component/DashboardSkeleton";
import { DashboardData } from "./_component/DashboardData";

// Opsional: kalau bisa jalan di edge, lebih kecil cold start
// export const runtime = "edge";
export const dynamic = "force-dynamic"; // jangan cache SSR untuk halaman ini

export default async function DashboardPage() {
  const supabase = await createClient();

  // Auth ringan duluan
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Profil (ringan) — cukup 1 query kecil
  const { data: userProfile } = await supabase
    .from("users")
    .select("id, name, email, phone_number, role, status")
    .eq("id", user.id)
    .single();

  return (
    <DashboardLayout user={userProfile as User | null}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Manage your notes and deadlines</p>
        </div>

        {/* Bagian berat (counts + tasks) di-stream pakai Suspense */}
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardData
            userId={user.id}
            userProfile={userProfile as User | null}
          />
        </Suspense>
      </div>
    </DashboardLayout>
  );
}
