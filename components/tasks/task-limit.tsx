"use client";
import type { User } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";

interface TaskLimitsProps {
  user: User | null;
  taskCount: number;
}

export function TaskLimits({ user, taskCount }: TaskLimitsProps) {
  const isFreePlan = user?.subscription_plan === "free";
  const FREE_TASK_LIMIT = 10; // Free users can create up to 10 tasks

  if (!isFreePlan) return null;

  const remainingTasks = Math.max(0, FREE_TASK_LIMIT - taskCount);
  const isNearLimit = remainingTasks <= 2;
  const isAtLimit = remainingTasks === 0;

  if (!isNearLimit) return null;

  return (
    <Alert
      className={
        isAtLimit
          ? "border-red-200 bg-red-50"
          : "border-yellow-200 bg-yellow-50"
      }
    >
      <Info className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between">
        <span>
          {isAtLimit
            ? "You've reached the free plan limit of 10 tasks."
            : `You have ${remainingTasks} tasks remaining on the free plan.`}
        </span>
        <Button size="sm" disabled>
          Upgrade to Premium
        </Button>
      </AlertDescription>
    </Alert>
  );
}
