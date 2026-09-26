import { cn } from '@dahaze/ui'

import type { DiffHunk } from '@/shared/diff-lines'

/**
 * 줄 단위 diff 표. 추가·삭제는 색과 함께 `+`·`−` 기호로 구분한다 — 색만으로는 구분하지 않는다.
 *
 * 줄 번호는 앞뒤 두 칸이다. 접힌 구간은 "변경 없는 줄 N개" 로 표시한다.
 */
export function DiffView({ hunks, label }: { hunks: readonly DiffHunk[]; label: string }) {
  if (hunks.length === 0) {
    return <p className="px-4 py-3 text-body-sm text-text-muted">바뀐 줄이 없어요.</p>
  }

  return (
    <div role="table" aria-label={label} className="overflow-x-auto font-mono text-[13px] leading-5">
      {hunks.map((hunk, hunkIndex) => (
        <div key={hunkIndex} role="rowgroup">
          {hunk.skippedBefore > 0 ? (
            <div
              role="row"
              className="border-y border-border bg-canvas-subtle px-4 py-1 font-sans text-caption text-text-subtle"
            >
              변경 없는 줄 {hunk.skippedBefore.toLocaleString('ko-KR')}개
            </div>
          ) : null}
          {hunk.lines.map((line, lineIndex) => (
            <div
              key={lineIndex}
              role="row"
              className={cn(
                'grid grid-cols-[3rem_3rem_1.5rem_1fr]',
                line.kind === 'added' && 'bg-success-subtle',
                line.kind === 'removed' && 'bg-diagnostic-error-subtle',
              )}
            >
              <span role="cell" className="pr-2 text-right text-text-subtle tabular-nums select-none">
                {line.beforeLine ?? ''}
              </span>
              <span role="cell" className="pr-2 text-right text-text-subtle tabular-nums select-none">
                {line.afterLine ?? ''}
              </span>
              <span
                role="cell"
                aria-label={line.kind === 'added' ? '추가' : line.kind === 'removed' ? '삭제' : undefined}
                className={cn(
                  'text-center select-none',
                  line.kind === 'added' && 'text-success',
                  line.kind === 'removed' && 'text-diagnostic-error',
                )}
              >
                {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}
              </span>
              <span role="cell" className="pr-4 whitespace-pre-wrap break-all text-text">
                {line.text === '' ? ' ' : line.text}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** `+12 −3` 표시. 숫자가 0 인 쪽은 흐리게. */
export function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-caption tabular-nums">
      <span aria-hidden className={added > 0 ? 'text-success' : 'text-text-subtle'}>
        +{added.toLocaleString('ko-KR')}
      </span>
      <span aria-hidden className={removed > 0 ? 'text-diagnostic-error' : 'text-text-subtle'}>
        −{removed.toLocaleString('ko-KR')}
      </span>
      <span className="sr-only">
        {added}줄 추가, {removed}줄 삭제
      </span>
    </span>
  )
}
