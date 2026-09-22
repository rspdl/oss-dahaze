'use client'

import { useMemo, type ReactElement } from 'react'

import { cn } from '@dahaze/ui'

import { diffLines, summarizeDiff, toHunks, type DiffHunk, type DiffLine } from './diff-lines'

/**
 * 수정안이 편집 중인 내용을 어떻게 바꾸는지 보여준다.
 *
 * 적용을 누르면 편집 중인 내용이 통째로 덮인다. 수정안 전문만 보여주면 사람은 무엇이 바뀌는지
 * 알 수 없고, 결국 "AI 를 믿는다/안 믿는다" 로만 결정하게 된다 — 판단할 재료를 주는 것이
 * 이 화면의 일이다.
 *
 * 좌우 분할은 쓰지 않는다. 이 뷰는 좁은 오른쪽 패널에 들어가고, 그 폭에서 두 열로 쪼개면
 * 양쪽 모두 읽을 수 없게 된다.
 */
export function DraftDiff({
  before,
  after,
  className,
}: {
  before: string
  after: string
  className?: string
}): ReactElement {
  const lines = useMemo(() => diffLines(before, after), [before, after])
  const hunks = useMemo(() => toHunks(lines), [lines])
  const summary = useMemo(() => summarizeDiff(lines), [lines])

  if (!summary.changed) {
    return (
      <p className={cn('text-sm text-text-muted', className)}>수정안이 현재 내용과 같습니다.</p>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-xs text-text-muted">
        <span className="tabular-nums">{summary.added}</span>줄 추가 ·{' '}
        <span className="tabular-nums">{summary.removed}</span>줄 삭제
      </p>

      <div className="overflow-hidden rounded-control border">
        {hunks.map((hunk, index) => (
          <div key={hunkKey(hunk)}>
            {hunk.skippedBefore === 0 ? null : (
              <p
                className={cn(
                  'bg-surface-raised px-2 py-1 text-xs text-text-subtle',
                  index > 0 && 'border-t',
                )}
              >
                ··· 변경 없는 <span className="tabular-nums">{hunk.skippedBefore}</span>줄
              </p>
            )}
            {hunk.lines.map((line) => (
              <DiffRow key={`${line.beforeLine ?? 'x'}-${line.afterLine ?? 'x'}`} line={line} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** hunk 는 겹치지 않으므로 첫 줄의 두 줄 번호 쌍이면 서로 구분된다. */
function hunkKey(hunk: DiffHunk): string {
  const first = hunk.lines[0]
  return `${first?.beforeLine ?? 'x'}-${first?.afterLine ?? 'x'}`
}

/*
 * 색으로만 구분하지 않는다 (ADR-0006). 기호(+/−)와 스크린 리더가 읽는 문구가 뜻을 나르고,
 * 색은 그것을 보강할 뿐이다. 추가에 accent 를 쓰는 건 초록 토큰이 없어서다 — 없는 토큰을
 * 지어내는 대신 있는 것으로 구분한다.
 */
const KIND = {
  added: {
    symbol: '+',
    srLabel: '추가된 줄',
    row: 'bg-accent-subtle',
    symbolTone: 'text-accent',
  },
  removed: {
    symbol: '−',
    srLabel: '삭제된 줄',
    row: 'bg-diagnostic-error-subtle',
    symbolTone: 'text-diagnostic-error',
  },
  context: {
    symbol: ' ',
    srLabel: '',
    row: '',
    symbolTone: 'text-text-subtle',
  },
} as const

function DiffRow({ line }: { line: DiffLine }) {
  const kind = KIND[line.kind]

  return (
    <div className={cn('flex items-start gap-2 px-2 py-0.5 text-xs', kind.row)}>
      {/* 두 문서의 줄 번호를 나란히 둔다. 사용자가 편집기에서 그 자리를 찾아가야 한다. */}
      <span
        aria-hidden
        className="w-6 shrink-0 text-right tabular-nums text-text-subtle"
      >
        {line.beforeLine ?? ''}
      </span>
      <span
        aria-hidden
        className="w-6 shrink-0 text-right tabular-nums text-text-subtle"
      >
        {line.afterLine ?? ''}
      </span>
      <span aria-hidden className={cn('w-2 shrink-0 font-mono', kind.symbolTone)}>
        {kind.symbol}
      </span>
      {kind.srLabel === '' ? null : <span className="sr-only">{kind.srLabel}</span>}
      <span className="min-w-0 flex-1 font-mono break-words whitespace-pre-wrap text-text">
        {line.text === '' ? ' ' : line.text}
      </span>
    </div>
  )
}
