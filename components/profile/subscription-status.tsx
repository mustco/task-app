import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { User } from "@/lib/types";

interface SubscriptionStatusProps {
  user: User | null;
}

export function SubscriptionStatus({ user }: SubscriptionStatusProps) {
  const isFreePlan = user?.subscription_plan === "free";
  const isPremium = user?.subscription_plan === "premium";
  const isActive = user?.subscription_status === "active";

  const getStatusBadge = () => {
    if (isActive) {
      return <Badge className="bg-green-100 text-green-800">Aktif</Badge>;
    }
    return <Badge className="bg-red-100 text-red-800">Tidak Aktif</Badge>;
  };

  const getPlanFeatures = () => {
    if (isFreePlan) {
      return "Manajemen catatan dasar dengan notifikasi email";
    }
    return "Manajemen catatan lanjutan dengan notifikasi WhatsApp & email, catatan tak terbatas, dan dukungan prioritas";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Status Langganan</CardTitle>
        <p className="text-sm text-gray-600">
          Paket saat ini dan informasi tagihan Anda
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold capitalize">
                {user?.subscription_plan} Plan
              </h3>
              {getStatusBadge()}
            </div>
            <p className="text-sm text-gray-600">{getPlanFeatures()}</p>
            {user?.subscription_expires_at && (
              <p className="text-xs text-gray-500 mt-1">
                {isActive ? "Berakhir" : "Kedaluwarsa"} pada{" "}
                {new Date(user.subscription_expires_at).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        {isFreePlan && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Upgrade ke Premium untuk notifikasi WhatsApp dan fitur
              lanjutan.
            </p>
            <Button disabled className="w-full">
              Upgrade Paket (Segera Hadir)
            </Button>
          </div>
        )}

        {isPremium && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Anda menikmati semua fitur premium! Terima kasih atas dukungan Anda.
            </p>
            <Button
              variant="outline"
              disabled
              className="w-full bg-transparent"
            >
              Kelola Langganan (Segera Hadir)
            </Button>
          </div>
        )}

        <div className="pt-4 border-t">
          <h4 className="font-medium mb-2">Perbandingan Paket</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Notifikasi Email</span>
              <span className="text-green-600">✓ Semua Paket</span>
            </div>
            <div className="flex justify-between">
              <span>Notifikasi WhatsApp</span>
              <span className={isPremium ? "text-green-600" : "text-gray-400"}>
                {isPremium ? "✓ Premium" : "Premium Only"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Catatan Tak Terbatas</span>
              <span className={isPremium ? "text-green-600" : "text-gray-400"}>
                {isPremium ? "✓ Premium" : "Premium Only"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Dukungan Prioritas</span>
              <span className={isPremium ? "text-green-600" : "text-gray-400"}>
                {isPremium ? "✓ Premium" : "Premium Only"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Analitik Lanjutan</span>
              <span className={isPremium ? "text-green-600" : "text-gray-400"}>
                {isPremium ? "✓ Premium" : "Premium Only"}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
