import * as React from "react"

import { cn } from "../lib/cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-control border border-border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-accent selection:text-accent-fg file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text placeholder:text-text-muted disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50",
        "aria-invalid:border-diagnostic-error aria-invalid:ring-diagnostic-error/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
