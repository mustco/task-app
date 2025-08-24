import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-secondary text-secondary-foreground",
        pending:
          "border-transparent bg-status-pending/20 text-status-pending",
        progress:
          "border-transparent bg-status-progress/20 text-status-progress",
        completed:
          "border-transparent bg-status-completed/20 text-status-completed",
        overdue:
          "border-transparent bg-status-overdue/20 text-status-overdue",
        destructive:
          "border-transparent bg-destructive/20 text-destructive",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
