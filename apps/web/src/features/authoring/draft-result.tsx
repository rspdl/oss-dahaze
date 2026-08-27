'use client'

import type { AuthoringDraftResponse } from '@dahaze/api-client'
import { RspdlEditor } from '@dahaze/rspdl-editor'
import { DiagnosticBadge } from '@dahaze/ui'

import { collectDiagnostics, countBySeverity, SEVERITIES } from '@/shared/rspdl/analysis'
import { diffLines, summarizeDiff } from './diff-lines'
import { DraftDiff } from './draft-diff'

/** 줄 수 변화를 사람이 읽는 한 줄로. 예: `12줄 추가 · 3줄 삭제`. */
export function describeChange(summary: {
  added: number
  removed: number
  changed: boolean
}): string {
  if (!summary.changed) return '바뀌는 줄이 없습니다'
  const parts: string[] = []
  if (summary.added > 0) parts.push(`${summary.added}줄 추가`)
  if (summary.removed > 0) parts.push(`${summary.removed}줄 삭제`)
  return parts.join(' · ')
}

/**
 * LLM 초안과 그 컴파일 결과.
 *
 * **저장되지 않았다는 사실이 이 화면에서 가장 크게 보여야 한다.** 저작 엔드포인트는 문서를
 * 쓰지 않는다 (ADR-0005). LLM 이 조용히 덮어쓰면 사용자는 자기 문서의 이력을 추적할 수 없게
 * 되므로, 저장은 사람이 명시적으로 한다.
 *
 * 진단이 남은 초안도 실패가 아니다. 200 으로 오고, 진단과 함께 보여준다 — 반쯤 맞는 초안과
 * 그 진단은 사람이 판단할 재료다. 우리가 대신 "쓸 수 없는 초안" 이라고 판정하지 않는다.
 *
 * 기본 미리보기는 전문이 아니라 **diff** 다. 적용하면 편집 중이던 내용이 통째로 덮이므로,
 * 사람이 판단해야 하는 것은 "무엇이 바뀌는가" 이지 "수정안이 어떻게 생겼는가" 가 아니다.
 */
export function DraftResult({
  draft,
  currentText = '',
}: {
  draft: AuthoringDraftResponse
  /**
   * 편집기에서 지금 편집 중인 본문. diff 의 "이전" 쪽이다.
   *
   * 새 문서를 만드는 자리에는 이전 쪽이 없다. 빈 문자열이 곧 "전부 추가" 이므로 그대로
   * 기본값으로 둔다 — 없는 것을 없다고 말하는 것과 같다.
   */
  currentText?: string
}) {
  const { diagnostics, recognized } = collectDiagnostics(draft.analysis)
  const counts = countBySeverity(diagnostics)
  const diagnosticCount = diagnostics.length
  const change = describeChange(summarizeDiff(diffLines(currentText, draft.text)))

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-text">수정안을 만들었습니다.</p>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">
          적용하면 {change}.{' '}
          {recognized
            ? diagnosticCount === 0
              ? '컴파일러가 이 수정안에서 문제를 찾지 못했습니다.'
              : `컴파일 결과 확인할 문제가 ${diagnosticCount}건 남아 있습니다.`
            : '컴파일 결과 형식을 확인하지 못했습니다. 적용 전에 내용을 살펴보세요.'}
        </p>
      </div>

      {diagnosticCount === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1.5">
          {SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => (
            <DiagnosticBadge
              key={severity}
              severity={severity}
              count={counts[severity]}
            />
          ))}
        </div>
      )}

      <DraftDiff before={currentText} after={draft.text} />

      <details className="group rounded-control border">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-text-muted hover:text-text">
          수정안 전문 보기
        </summary>
        <div className="h-64 overflow-hidden border-t">
          <RspdlEditor
            value={draft.text}
            diagnostics={diagnostics}
            readOnly
            ariaLabel="수정안 전문"
            className="h-full"
          />
        </div>
      </details>

      <p className="text-xs text-text-subtle">
        {draft.model} · 시도 {draft.attempts.length}회 · rspdl{' '}
        {draft.analysis.rspdl_version}
      </p>
    </div>
  )
}
