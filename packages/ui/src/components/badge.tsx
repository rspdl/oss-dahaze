import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "../lib/cn"

const badgeVariants = cva(
  "inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 text-xs font-semibold tracking-[0.01em] whitespace-nowrap tabular-nums transition-colors focus-visible:focus-ring aria-invalid:border-diagnostic-error [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        // jwdesign 배지는 연한 배경(soft)이 기본이다. 채움(solid)은 숫자 카운트·NEW 처럼 드물게.
        default: "bg-accent-subtle text-accent-text [a&]:hover:bg-accent-subtle-hover",
        solid: "bg-accent text-accent-fg [a&]:hover:bg-accent-hover",
        secondary:
          "bg-surface-raised text-text-muted [a&]:hover:bg-surface-raised-hover",
        destructive:
          "bg-diagnostic-error-subtle text-diagnostic-error",
        success: "bg-success-subtle text-success",
        warning: "bg-diagnostic-warning-subtle text-diagnostic-warning",
        info: "bg-diagnostic-info-subtle text-diagnostic-info",
        outline:
          "border-border-strong text-text-muted [a&]:hover:bg-state-hover [a&]:hover:text-text",
        ghost: "[a&]:hover:bg-state-hover [a&]:hover:text-text",
        link: "text-accent-text underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
