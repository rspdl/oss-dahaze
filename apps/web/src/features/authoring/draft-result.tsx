'use client'

import type { AuthoringDraftResponse } from '@dahaze/api-client'
import { RspdlEditor } from '@dahaze/rspdl-editor'
import { DiagnosticBadge, ScrollArea } from '@dahaze/ui'

import { collectDiagnostics, countBySeverity, SEVERITIES } from '@/shared/rspdl/analysis'
import { DiagnosticList } from '@/features/analysis/diagnostic-list'

/**
 * LLM 초안과 그 컴파일 결과.
 *
 * **저장되지 않았다는 사실이 이 화면에서 가장 크게 보여야 한다.** 저작 엔드포인트는 문서를
 * 쓰지 않는다 (ADR-0005). LLM 이 조용히 덮어쓰면 사용자는 자기 문서의 이력을 추적할 수 없게
 * 되므로, 저장은 사람이 명시적으로 한다.
 *
 * 진단이 남은 초안도 실패가 아니다. 200 으로 오고, 진단과 함께 보여준다 — 반쯤 맞는 초안과
 * 그 진단은 사람이 판단할 재료다. 우리가 대신 "쓸 수 없는 초안" 이라고 판정하지 않는다.
 */
export function DraftResult({ draft }: { draft: AuthoringDraftResponse }) {
  const { diagnostics, recognized } = collectDiagnostics(draft.analysis)
  const counts = countBySeverity(diagnostics)
  const lastAttempt = draft.attempts.at(-1)

  return (
    <div className="space-y-3">
      <div className="rounded-panel border border-diagnostic-warning bg-diagnostic-warning-subtle px-3 py-2 text-sm text-text">
        <strong className="font-medium">아직 저장되지 않았습니다.</strong> 내용을 확인한 뒤
        직접 저장해야 문서에 반영됩니다.
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span className="font-mono">{draft.path}</span>
        <span aria-hidden>·</span>
        <span>모델 {draft.model}</span>
        <span aria-hidden>·</span>
        <span>
          시도 {draft.attempts.length}회
          {lastAttempt === undefined
            ? null
            : ` (마지막 시도 진단 ${lastAttempt.diagnostic_count}건)`}
        </span>
        <span aria-hidden>·</span>
        <span>rspdl {draft.analysis.rspdl_version}</span>
        <span className="ml-auto flex gap-1.5">
          {SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => (
            <DiagnosticBadge
              key={severity}
              severity={severity}
              count={counts[severity]}
            />
          ))}
        </span>
      </div>

      <div className="h-64 overflow-hidden rounded-panel border">
        <RspdlEditor
          value={draft.text}
          diagnostics={diagnostics}
          readOnly
          ariaLabel="LLM 초안"
          className="h-full"
        />
      </div>

      <div className="max-h-48 overflow-hidden rounded-panel border">
        <ScrollArea className="h-full max-h-48">
          <DiagnosticList
            text={draft.text}
            diagnostics={diagnostics}
            emptyTitle={
              recognized ? '진단이 없습니다' : '컴파일 결과 형식을 알아보지 못했습니다'
            }
            emptyDescription={
              recognized
                ? '컴파일러가 이 초안에서 지적할 것을 찾지 못했습니다.'
                : '서버의 rspdl 버전이 이 프론트가 아는 형식과 다를 수 있습니다.'
            }
          />
        </ScrollArea>
      </div>
    </div>
  )
}
