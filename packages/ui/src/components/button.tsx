import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "../lib/cn"

/*
 * jwdesign Button. 눌린 순간 버튼이 살짝 줄어든다(scale 0.98). 화면에는 촉각이 없으므로,
 * 눌렸다는 사실을 눈으로라도 돌려주지 않으면 사용자는 반응이 올 때까지 같은 버튼을 여러 번
 * 누른다. 움직이는 값은 `transform` 이라 주변 요소를 밀지 않는다. `link` 는 글자라서 예외로
 * 둔다 — 문장 속 한 단어만 줄어들면 오작동처럼 보인다.
 *
 * 채움 강조(`default`)는 한 화면에 하나. 나머지 행동은 secondary · weak · outline · ghost.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control border border-transparent text-sm font-semibold whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 ease-standard active:scale-[0.98] outline-none focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-diagnostic-error [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-pressed",
        destructive: "bg-danger text-on-danger hover:bg-danger-hover",
        outline:
          "border-border-strong bg-surface text-text hover:bg-canvas-subtle",
        secondary:
          "bg-surface-raised text-text hover:bg-surface-raised-hover",
        weak: "bg-accent-subtle text-accent-text hover:bg-accent-subtle-hover",
        ghost:
          "text-text-muted hover:bg-state-hover hover:text-text active:bg-state-pressed",
        link: "text-accent-text underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        // jwdesign 컨트롤 높이: xs 28 · sm 32 · md 40 · lg 48
        default: "h-10 px-4 text-[15px] has-[>svg]:px-3.5",
        xs: "h-7 gap-1 rounded-sm px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1 rounded-sm px-3 text-[13px] has-[>svg]:px-2.5",
        lg: "h-12 rounded-lg px-5 text-base has-[>svg]:px-4",
        icon: "size-10",
        "icon-xs": "size-7 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 rounded-sm",
        "icon-lg": "size-12 rounded-lg [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
