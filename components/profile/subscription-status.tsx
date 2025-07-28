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
      return <Badge className="bg-green-100 text-green-800">Active</Badge>;
    }
    return <Badge className="bg-red-100 text-red-800">Inactive</Badge>;
  };

  const getPlanFeatures = () => {
    if (isFreePlan) {
      return "Basic task management with email notifications";
    }
    return "Advanced task management with WhatsApp & email notifications, unlimited tasks, and priority support";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription Status</CardTitle>
        <p className="text-sm text-gray-600">
          Your current plan and billing information
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
                {isActive ? "Expires" : "Expired"} on{" "}
                {new Date(user.subscription_expires_at).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        {isFreePlan && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Upgrade to Premium for WhatsApp notifications and advanced
              features.
            </p>
            <Button disabled className="w-full">
              Upgrade Plan (Coming Soon)
            </Button>
          </div>
        )}

        {isPremium && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              You're enjoying all premium features! Thank you for your support.
            </p>
            <Button
              variant="outline"
              disabled
              className="w-full bg-transparent"
            >
              Manage Subscription (Coming Soon)
            </Button>
          </div>
        )}

        <div className="pt-4 border-t">
          <h4 className="font-medium mb-2">Plan Comparison</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Email Notifications</span>
              <span className="text-green-600">✓ All Plans</span>
            </div>
            <div className="flex justify-between">
              <span>WhatsApp Notifications</span>
              <span className={isPremium ? "text-green-600" : "text-gray-400"}>
                {isPremium ? "✓ Premium" : "Premium Only"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Unlimited Tasks</span>
              <span className={isPremium ? "text-green-600" : "text-gray-400"}>
                {isPremium ? "✓ Premium" : "Premium Only"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Priority Support</span>
              <span className={isPremium ? "text-green-600" : "text-gray-400"}>
                {isPremium ? "✓ Premium" : "Premium Only"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Advanced Analytics</span>
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
