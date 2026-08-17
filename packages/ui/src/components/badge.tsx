import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/cn"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50 aria-invalid:border-diagnostic-error aria-invalid:ring-diagnostic-error/20 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-accent text-on-solid [a&]:hover:bg-accent/90",
        secondary:
          "bg-surface-raised text-text [a&]:hover:bg-surface-raised/90",
        destructive:
          "bg-diagnostic-error text-on-solid focus-visible:ring-diagnostic-error/20 [a&]:hover:bg-diagnostic-error/90",
        outline:
          "border-border text-text [a&]:hover:bg-surface-raised [a&]:hover:text-text",
        ghost: "[a&]:hover:bg-surface-raised [a&]:hover:text-text",
        link: "text-accent underline-offset-4 [a&]:hover:underline",
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
