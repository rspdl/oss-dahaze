import * as React from "react"
import { ErrorIcon, InfoIcon, WarningIcon } from "./icons"

import { cn } from "../lib/cn"

/**
 * 심각도 표시.
 *
 * **색으로만 구분하지 않는다.** 색각 이상 사용자가 오류와 경고를 구분하지 못하면 이 제품의
 * 핵심 기능이 동작하지 않는 것이다 (ADR-0006, manage-ui-package 스킬). 그래서 세 가지를
 * 겹쳐 쓴다.
 *
 * 1. **아이콘 모양** — 팔각형 / 삼각형 / 원. 색을 지워도 서로 다르다.
 * 2. **글자** — "오류", "경고", "정보". 스크린 리더가 읽는 것도 이것이다.
 * 3. **색** — 위 둘을 보강할 뿐, 혼자서는 아무 것도 책임지지 않는다.
 *
 * 라벨을 `srOnly` 로 숨기는 선택지는 두지 않았다. 숨길 수 있게 만들면 좁은 화면에서 반드시
 * 숨기게 되고, 그 순간 남는 건 색뿐이다.
 */
export type DiagnosticSeverity = "error" | "warning" | "info"

const SEVERITY = {
  error: {
    label: "오류",
    Icon: ErrorIcon,
    // jwdesign 의 진단 글자색은 자기 subtle 배경 위에서 라이트·다크 모두 4.5:1 이상이라
    // 라벨까지 진단 색으로 칠해도 읽힌다. 그래도 모양(아이콘)과 글자가 먼저다.
    tone: "bg-diagnostic-error-subtle text-diagnostic-error",
    iconTone: "text-diagnostic-error",
  },
  warning: {
    label: "경고",
    Icon: WarningIcon,
    tone: "bg-diagnostic-warning-subtle text-diagnostic-warning",
    iconTone: "text-diagnostic-warning",
  },
  info: {
    label: "정보",
    Icon: InfoIcon,
    tone: "bg-diagnostic-info-subtle text-diagnostic-info",
    iconTone: "text-diagnostic-info",
  },
} as const satisfies Record<
  DiagnosticSeverity,
  { label: string; Icon: React.ElementType; tone: string; iconTone: string }
>

export interface DiagnosticBadgeProps
  extends Omit<React.ComponentProps<"span">, "children"> {
  severity: DiagnosticSeverity
  /** 기본 라벨("오류"·"경고"·"정보") 대신 쓸 문구. 비워두면 기본값을 쓴다. */
  label?: React.ReactNode
  /** 같은 심각도가 여러 건일 때의 개수. `0` 도 의미가 있으므로 `undefined` 와 구분한다. */
  count?: number
}

function DiagnosticBadge({
  severity,
  label,
  count,
  className,
  ...props
}: DiagnosticBadgeProps) {
  const { label: defaultLabel, Icon, tone, iconTone } = SEVERITY[severity]

  return (
    <span
      data-slot="diagnostic-badge"
      data-severity={severity}
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold whitespace-nowrap",
        tone,
        className
      )}
      {...props}
    >
      <Icon aria-hidden className={cn("size-3.5 shrink-0", iconTone)} />
      {label ?? defaultLabel}
      {count === undefined ? null : (
        <span className="tabular-nums text-text-muted">{count}</span>
      )}
    </span>
  )
}

export { DiagnosticBadge }
