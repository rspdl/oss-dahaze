import * as React from "react"
import { InfoIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"

import { cn } from "@/lib/cn"

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
    Icon: OctagonXIcon,
    // 글자는 `text-text` 로 둔다. 진단 색을 subtle 배경 위에 글자로 쓰면 특히 warning 에서
    // 대비가 떨어져 읽기 어려워진다. 색은 아이콘과 테두리가 나른다.
    tone: "border-diagnostic-error bg-diagnostic-error-subtle",
    iconTone: "text-diagnostic-error",
  },
  warning: {
    label: "경고",
    Icon: TriangleAlertIcon,
    tone: "border-diagnostic-warning bg-diagnostic-warning-subtle",
    iconTone: "text-diagnostic-warning",
  },
  info: {
    label: "정보",
    Icon: InfoIcon,
    tone: "border-diagnostic-info bg-diagnostic-info-subtle",
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
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-control border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-text",
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
