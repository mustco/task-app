//app/profile/page.tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { ProfileForm } from "@/components/profile/profile-form";
// Import the new SubscriptionStatus component
import { SubscriptionStatus } from "@/components/profile/subscription-status";

export default async function ProfilePage() {
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
  // console.log("User Profile:", userProfile);
  return (
    <DashboardLayout user={userProfile}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Profile</h1>
          <p className="text-muted-foreground">Kelola pengaturan akun Anda</p>
        </div>

        <ProfileForm user={userProfile} />
        <SubscriptionStatus user={userProfile} />
      </div>
    </DashboardLayout>
  );
}
