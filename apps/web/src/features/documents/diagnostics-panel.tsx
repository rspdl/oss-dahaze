'use client'

import type { RspdlSeverity } from '@dahaze/rspdl-editor'
import { Button, DiagnosticBadge, ErrorState, ScrollArea, Skeleton, cn } from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { countBySeverity, SEVERITIES } from '@/shared/rspdl/analysis'
import { SpinnerIcon } from '@/shared/ui/icons'
import { DiagnosticList } from '@/features/analysis/diagnostic-list'
import type { CompileState } from '@/features/analysis/use-compile'
import { useWorkbenchStore } from './workbench-store'

/**
 * 컴파일 진단 패널.
 *
 * **진단은 실패가 아니다.** 진단이 있는 컴파일도 200 이고, 여기 보이는 것은 컴파일러가 짚어
 * 준 지점이다. 실패는 따로 있다 — 서버에 못 닿았거나 5xx 인 경우고, 그때만 `ErrorState` 가
 * 뜬다.
 *
 * 필터는 **보이는 것만** 줄인다. 걸러진 건수를 계속 배지에 보여 주는 이유가 그것이다.
 * 숨긴 진단이 몇 건인지 모르면 숨겼다는 사실 자체가 사라진다.
 */
export function DiagnosticsPanel({ compile }: { compile: CompileState }) {
  const visible = useWorkbenchStore((state) => state.visibleSeverities)
  const toggleSeverity = useWorkbenchStore((state) => state.toggleSeverity)

  const snapshot = compile.snapshot
  const all = snapshot?.diagnostics ?? []
  const counts = countBySeverity(all)
  const shown = all.filter((diagnostic) => visible[diagnostic.severity])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-medium text-text">진단</h2>

        <div className="flex gap-1.5" role="group" aria-label="심각도 필터">
          {SEVERITIES.map((severity) => (
            <SeverityToggle
              key={severity}
              severity={severity}
              count={counts[severity]}
              pressed={visible[severity]}
              onToggle={() => toggleSeverity(severity)}
            />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {compile.isCompiling ? (
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <SpinnerIcon className="size-3.5" />
              컴파일 중…
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={compile.recompile}>
              다시 컴파일
            </Button>
          )}
        </div>
      </div>

      {/*
        스냅샷이 지금 편집 중인 텍스트의 것이 아니면 행·열이 어긋난다. 감추지 않고 낡았다고
        말한 뒤 그대로 보여준다 — 마지막으로 확인된 진단을 지워 버리면 사용자는 타자 치는
        동안 아무 정보 없이 남는다.
      */}
      {snapshot !== null && !compile.isCurrent ? (
        <p className="border-b bg-surface-raised px-3 py-1.5 text-xs text-text-muted">
          편집 중입니다. 아래는 마지막으로 컴파일한 내용 기준입니다.
        </p>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        {compile.error !== null && compile.error !== undefined ? (
          <ErrorState
            className="m-3"
            title="컴파일하지 못했습니다"
            description={errorMessage(compile.error)}
            action={
              <Button variant="outline" onClick={compile.recompile}>
                다시 시도
              </Button>
            }
          />
        ) : snapshot === null ? (
          compile.isCompiling ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <p className="p-6 text-center text-sm text-text-muted">
              내용을 입력하면 자동으로 컴파일합니다.
            </p>
          )
        ) : (
          <DiagnosticList
            text={snapshot.text}
            diagnostics={shown}
            emptyTitle={
              !snapshot.recognized
                ? '컴파일 결과 형식을 알아보지 못했습니다'
                : all.length > 0
                  ? '필터에 걸려 모두 숨겨졌습니다'
                  : '진단이 없습니다'
            }
            emptyDescription={
              !snapshot.recognized
                ? '서버의 rspdl 버전이 이 프론트가 아는 결과 형식과 다를 수 있습니다.'
                : all.length > 0
                  ? `${all.length}건이 있지만 지금 필터로는 보이지 않습니다.`
                  : '컴파일러가 이 문서에서 지적할 것을 찾지 못했습니다.'
            }
          />
        )}
      </ScrollArea>
    </div>
  )
}

/**
 * 심각도 토글.
 *
 * `DiagnosticBadge` 를 그대로 쓴다. 아이콘·글자·색을 함께 쓰는 규칙이 컴포넌트 안에 박혀
 * 있으므로, 여기서 색만 있는 점으로 줄이면 그 규칙이 무너진다.
 */
function SeverityToggle({
  severity,
  count,
  pressed,
  onToggle,
}: {
  severity: RspdlSeverity
  count: number
  pressed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className="cursor-pointer rounded-control focus-visible:outline-2"
    >
      <DiagnosticBadge
        severity={severity}
        count={count}
        className={cn(!pressed && 'opacity-40 grayscale')}
      />
      <span className="sr-only">{pressed ? '숨기기' : '보이기'}</span>
    </button>
  )
}
