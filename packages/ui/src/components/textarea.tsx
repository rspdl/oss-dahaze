import * as React from "react"

import { cn } from "../lib/cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-control border border-border-control bg-surface px-3 py-2.5 text-base leading-6 text-text transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-text-subtle hover:border-text-subtle focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-subtle disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-diagnostic-error aria-invalid:focus-visible:ring-diagnostic-error-subtle md:text-[15px]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
