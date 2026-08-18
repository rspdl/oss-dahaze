import * as React from "react"

import { cn } from "../lib/cn"

export interface EmptyStateProps
  extends Omit<React.ComponentProps<"div">, "title"> {
  /** 아무 것도 없는 이유를 한 줄로. "결과 없음" 보다 "아직 문서가 없습니다" 가 낫다. */
  title: React.ReactNode
  /** 다음에 무엇을 하면 되는지. 없으면 생략한다. */
  description?: React.ReactNode
  /** 목록 성격을 드러내는 아이콘. 장식이므로 `aria-hidden` 을 씌운다. */
  icon?: React.ReactNode
  /** 버튼 등 다음 행동. 여기서 만들지 않고 받는다 — 무엇이 다음인지는 화면이 안다. */
  action?: React.ReactNode
}

/**
 * 비어 있는 목록 자리.
 *
 * 비어 있음을 그냥 공백으로 두면 사용자는 "아직 없음" 과 "로딩 실패" 와 "필터가 다 걸러냄" 을
 * 구분하지 못한다. 그래서 비었을 때도 화면은 말을 해야 한다. 실패는 `ErrorState` 가 따로
 * 맡는다 — 둘을 한 컴포넌트로 합치면 문구가 뭉개져서 결국 같은 문제로 돌아온다.
 */
function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-panel border border-dashed px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      {icon ? (
        <span aria-hidden className="text-text-subtle [&_svg]:size-8">
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-medium text-text">{title}</p>
      {description ? (
        <p className="max-w-prose text-sm text-text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export { EmptyState }
