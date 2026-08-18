'use client'

import { spanToLineColumn, type RspdlDiagnostic } from '@dahaze/rspdl-editor'
import { DiagnosticBadge, EmptyState, cn } from '@dahaze/ui'

import { CheckIcon } from '@/shared/ui/icons'

/**
 * 진단 목록.
 *
 * **진단은 오류가 아니다.** 진단이 있는 컴파일도 200 이고, 여기 있는 것은 실패 보고가 아니라
 * 컴파일러가 짚어 준 지점이다. 그래서 목록이 비어 있어도, 차 있어도 화면은 같은 톤으로 말한다.
 *
 * 문구는 컴파일러가 준 것만 보여준다. 서버가 `message` 를 렌더해 주면 그것을, 없으면
 * `message_key` 를 그대로 쓴다 — 우리가 한국어 문장을 지어내면 그건 진단의 재해석이고,
 * 컴파일러 버전이 오를 때마다 조용히 틀려진다 (AGENTS.md).
 *
 * 위치는 반드시 `spanToLineColumn` 을 지난다. `span` 은 UTF-8 바이트 오프셋이라 그냥 세면
 * 한국어 문서에서 전부 어긋난다 (ADR-0006).
 */
export function DiagnosticList({
  text,
  diagnostics,
  onSelect,
  emptyTitle = '진단이 없습니다',
  emptyDescription,
}: {
  /** 진단을 만든 바로 그 텍스트. 다른 텍스트를 넣으면 행·열이 어긋난다. */
  text: string
  diagnostics: readonly RspdlDiagnostic[]
  onSelect?: (diagnostic: RspdlDiagnostic) => void
  emptyTitle?: string
  emptyDescription?: string
}) {
  if (diagnostics.length === 0) {
    return (
      <EmptyState
        className="border-none"
        icon={<CheckIcon />}
        title={emptyTitle}
        description={emptyDescription}
      />
    )
  }

  return (
    <ul className="divide-y">
      {diagnostics.map((diagnostic, index) => {
        const { line, column } = spanToLineColumn(text, diagnostic.span)
        const content = (
          <>
            <div className="flex items-center gap-2">
              <DiagnosticBadge severity={diagnostic.severity} />
              <span className="font-mono text-xs text-text-muted">
                {line}행 {column}열
              </span>
              <span className="ml-auto font-mono text-xs text-text-subtle">
                {diagnostic.rule_id}
              </span>
            </div>
            <p className="mt-1.5 text-sm break-words text-text">
              {diagnostic.message ?? diagnostic.message_key}
            </p>
          </>
        )

        return (
          <li key={`${diagnostic.rule_id}-${diagnostic.span.start}-${index}`}>
            {onSelect === undefined ? (
              <div className="px-3 py-2.5">{content}</div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(diagnostic)}
                className={cn(
                  'w-full cursor-pointer px-3 py-2.5 text-left',
                  'hover:bg-surface-raised focus-visible:bg-surface-raised',
                )}
              >
                {content}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
