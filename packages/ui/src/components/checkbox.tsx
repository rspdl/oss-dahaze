"use client"

import type * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "../lib/cn"
import { CheckIcon } from "./icons"

/*
 * jwdesign Checkbox. 20px 상자, `border-control` 1.5px 테두리, 켜면 강조색 채움과 흰 체크.
 * 이름은 `<label htmlFor>` 나 `aria-label` 로 붙인다 — 상자만으로는 무엇을 켜는지 알 수 없다.
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer inline-flex size-5 shrink-0 items-center justify-center rounded-xs border-[1.5px] border-border-control bg-surface text-accent-fg outline-none",
        "transition-colors duration-150 ease-standard hover:border-text-muted focus-visible:focus-ring",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator">
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
