import * as React from "react"

import { cn } from "../lib/cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-control border border-border-control bg-surface px-3 py-1 text-base text-text transition-[border-color,box-shadow] duration-150 outline-none selection:bg-accent-subtle selection:text-text file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text placeholder:text-text-subtle hover:border-text-subtle disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-raised disabled:text-text-disabled md:text-[15px]",
        "focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-subtle",
        "aria-invalid:border-diagnostic-error aria-invalid:focus-visible:ring-diagnostic-error-subtle",
        className
      )}
      {...props}
    />
  )
}

export { Input }
