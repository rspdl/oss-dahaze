import * as React from "react"
import { OctagonXIcon } from "lucide-react"

import { cn } from "../lib/cn"

export interface ErrorStateProps
  extends Omit<React.ComponentProps<"div">, "title"> {
  /** 무엇이 실패했는지. 기본값은 원인을 모를 때만 쓴다. */
  title?: React.ReactNode
  /**
   * 원인. 서버가 준 문구를 그대로 넣는다 — 이 컴포넌트는 오류를 해석하지 않는다.
   * 해석은 도메인을 아는 쪽(`apps/web`)의 몫이다.
   */
  description?: React.ReactNode
  /** 다시 시도 버튼 등. 재시도 가능한지 아는 것도 호출하는 쪽이다. */
  action?: React.ReactNode
}

/**
 * 불러오기가 실패한 자리.
 *
 * `EmptyState` 와 생김새가 비슷하지만 의미가 반대다. 비어 있는 것은 정상이고 실패는 정상이
 * 아니다. 사용자가 둘을 헷갈리면 "없는 줄 알았는데 사실 안 불러와진 것" 이 되어 잘못된
 * 판단을 하게 된다. 그래서 **색만 다르게 하지 않고** 아이콘과 문구로도 구분한다 —
 * `DiagnosticBadge` 와 같은 이유다.
 *
 * `role="alert"` 를 쓰지 않는다. 화면 전환으로 도달하는 실패 표시라 즉시 끼어들 필요가 없고,
 * 목록이 갱신될 때마다 스크린 리더가 말을 자르는 편이 더 방해된다. `role="status"` 로 둔다.
 */
function ErrorState({
  title = "불러오지 못했습니다",
  description,
  action,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-panel border border-diagnostic-error bg-diagnostic-error-subtle px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      <OctagonXIcon aria-hidden className="size-8 text-diagnostic-error" />
      <p className="text-sm font-medium text-text">{title}</p>
      {description ? (
        <p className="max-w-prose text-sm text-text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export { ErrorState }
