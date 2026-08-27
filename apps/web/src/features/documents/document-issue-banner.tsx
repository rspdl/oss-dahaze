'use client'

import * as React from 'react'
import type { ReactNode } from 'react'
import type { RspdlDiagnostic } from '@dahaze/rspdl-editor'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DiagnosticBadge,
  ScrollArea,
  cn,
} from '@dahaze/ui'

import {
  CheckIcon,
  ChevronRightIcon,
  SparkleIcon,
  SpinnerIcon,
} from '../../shared/ui/icons'

export interface DocumentIssueBannerProps {
  /** 현재 편집 내용에서 컴파일러가 돌려준 순서를 그대로 유지한 진단. */
  diagnostics: readonly RspdlDiagnostic[]
  /** 화면에 보여 줄 진단의 0-based index. 범위를 벗어나면 첫 항목을 보여 준다. */
  selectedIndex: number
  /** 성공한 컴파일 결과가 한 번이라도 있는지. 빈 문서와 문제 없는 문서를 구분한다. */
  hasResult: boolean
  isCompiling: boolean
  /** diagnostics 가 현재 편집 중인 텍스트에서 만들어졌는지 여부. */
  isCurrent: boolean
  /** 컴파일 결과가 프론트가 아는 모양이었는지 여부. */
  recognized: boolean
  /** 컴파일러 메시지와 arguments 를 사람이 읽을 문장으로 표시하는 호출자 소유 렌더러. */
  renderMessage: (diagnostic: RspdlDiagnostic) => ReactNode
  renderTitle?: (diagnostic: RspdlDiagnostic) => ReactNode
  /** 탐색과 위치 이동 모두 이 콜백으로 선택할 진단을 알린다. */
  onSelect: (diagnostic: RspdlDiagnostic, index: number) => void
  onAskAi?: (diagnostic: RspdlDiagnostic, index: number) => void
  errorMessage?: string
  onRetry?: () => void
  className?: string
}

/**
 * 편집기 바로 위에서 현재 검토 결과를 한 문장으로 보여 주는 배너.
 *
 * 이 컴포넌트는 진단을 번역하거나 우선순위를 다시 매기지 않는다. 컴파일러가 준 순서를
 * 유지하고, 사람이 읽을 메시지는 호출자가 제공한다. 따라서 rspdl 버전에 묶인 메시지 정책을
 * 화면 컴포넌트가 조용히 소유하지 않는다.
 *
 * **error 를 앞으로 끌어올리지 않는다.** 정렬은 곧 재해석이고, 컴파일러가 이미 자기 기준으로
 * 정한 순서를 화면이 뒤집으면 같은 문서를 MCP 로 본 사람과 화면으로 본 사람이 다른 순서를
 * 읽는다 (AGENTS.md). 대신 심각도 배지와 `n / N` 로 지금 몇 번째의 무엇을 보고 있는지
 * 읽히게 하고, 전체 목록에서 한눈에 훑을 수 있게 한다.
 */
export function DocumentIssueBanner({
  diagnostics,
  selectedIndex,
  hasResult,
  isCompiling,
  isCurrent,
  recognized,
  renderMessage,
  renderTitle,
  onSelect,
  onAskAi,
  errorMessage,
  onRetry,
  className,
}: DocumentIssueBannerProps) {
  const [isListOpen, setListOpen] = React.useState(false)

  if (errorMessage !== undefined) {
    return (
      <section
        role="alert"
        aria-label="문서 검토 실패"
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-panel border border-diagnostic-error bg-diagnostic-error-subtle px-4 py-3',
          className,
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text">문서를 검토하지 못했습니다</p>
          <p className="mt-0.5 text-sm text-text-muted">{errorMessage}</p>
        </div>
        {onRetry === undefined ? null : (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            다시 시도
          </Button>
        )}
      </section>
    )
  }

  if (!recognized) {
    return (
      <section
        aria-live="polite"
        aria-label="문서 검토 상태"
        className={cn(
          'rounded-panel border border-diagnostic-info bg-diagnostic-info-subtle px-4 py-3',
          className,
        )}
      >
        <p className="text-sm font-medium text-text">검토 결과를 표시할 수 없습니다</p>
        <p className="mt-1 text-sm text-text-muted">
          문서를 다시 검토한 뒤에도 계속되면 서버의 RSPDL 버전을 확인해 주세요.
        </p>
      </section>
    )
  }

  if (!hasResult && !isCompiling) {
    return (
      <section
        aria-label="문서 검토 상태"
        className={cn(
          'flex items-center gap-3 rounded-panel border bg-surface px-4 py-3',
          className,
        )}
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-raised text-text-muted"
          aria-hidden
        >
          <CheckIcon className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-text">문서를 입력하면 바로 검토합니다</p>
          <p className="mt-0.5 text-xs text-text-muted">
            정책 충돌과 데이터 흐름 누락을 컴파일러가 자동으로 확인합니다.
          </p>
        </div>
      </section>
    )
  }

  if (diagnostics.length === 0) {
    return (
      <section
        aria-live="polite"
        aria-label="문서 검토 상태"
        className={cn(
          'flex items-center gap-3 rounded-panel border bg-surface px-4 py-3',
          className,
        )}
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-raised text-text-muted"
          aria-hidden
        >
          {isCompiling ? <SpinnerIcon className="size-4" /> : <CheckIcon className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">
            {isCompiling ? '문서를 검토하고 있습니다' : '지금 확인할 문제가 없습니다'}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            {isCompiling
              ? '검토가 끝나면 이곳에 결과가 나타납니다.'
              : '컴파일러가 현재 문서에서 지적할 내용을 찾지 못했습니다.'}
          </p>
        </div>
      </section>
    )
  }

  const currentIndex =
    Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < diagnostics.length
      ? selectedIndex
      : 0
  const current = diagnostics[currentIndex]!
  const select = (index: number) => onSelect(diagnostics[index]!, index)

  return (
    <section
      aria-live="polite"
      aria-label="문서에서 확인할 문제"
      className={cn(
        'rounded-panel border px-4 py-3',
        current.severity === 'error' &&
          'border-diagnostic-error/60 bg-diagnostic-error-subtle',
        current.severity === 'warning' &&
          'border-diagnostic-warning/60 bg-diagnostic-warning-subtle',
        current.severity === 'info' &&
          'border-diagnostic-info/60 bg-diagnostic-info-subtle',
        className,
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <DiagnosticBadge severity={current.severity} />
            <h2 className="text-sm font-semibold text-text">
              {renderTitle?.(current) ?? '확인할 문제가 있습니다'}
            </h2>
            {!isCurrent ? (
              <Badge variant="outline" className="text-text-muted">
                이전 검토 결과
              </Badge>
            ) : null}
            {isCompiling ? (
              <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                <SpinnerIcon className="size-3" /> 다시 검토 중…
              </span>
            ) : null}
          </div>

          <div className="mt-1.5 text-sm leading-6 break-words text-text">
            {renderMessage(current)}
          </div>

          {!isCurrent ? (
            <p className="mt-1 text-xs text-text-muted">
              편집 중인 내용과 위치가 다를 수 있습니다. 최신 검토가 끝나면 이동할 수 있습니다.
            </p>
          ) : null}

          <details className="mt-1.5 text-xs text-text-muted">
            <summary className="w-fit cursor-pointer rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
              규칙 정보 보기
            </summary>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span>규칙 ID</span>
              <Badge variant="outline" className="font-mono">
                {current.rule_id}
              </Badge>
              <span className="font-mono">{current.message_key}</span>
            </div>
          </details>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          <div className="flex items-center" role="group" aria-label="문제 탐색">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="이전 문제"
              disabled={currentIndex === 0}
              onClick={() => select(currentIndex - 1)}
            >
              <ChevronRightIcon className="size-4 rotate-180" />
            </Button>
            {/*
              `aria-label` 은 이름을 가질 수 있는 role 에서만 노출된다. 이 span 은 role 이
              generic 이라 라벨이 무시되고 "1 / 3" 만 읽힌다. 보이는 표기와 읽히는 문장을
              따로 둔다.
            */}
            <span className="min-w-12 text-center text-xs tabular-nums text-text-muted">
              <span aria-hidden>
                {currentIndex + 1} / {diagnostics.length}
              </span>
              <span className="sr-only">
                전체 {diagnostics.length}개 중 {currentIndex + 1}번째 문제
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="다음 문제"
              disabled={currentIndex === diagnostics.length - 1}
              onClick={() => select(currentIndex + 1)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>

          {/*
            배너는 한 번에 한 건만 크게 보여 준다. 건수가 여럿이면 "지금 몇 개가 남았는지" 를
            훑을 길이 따로 있어야 한다 — 다음 버튼을 N 번 눌러야만 전체를 알 수 있으면
            사람은 세는 것을 포기한다.
          */}
          {diagnostics.length > 1 ? (
            <Dialog open={isListOpen} onOpenChange={setListOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                  모든 문제 보기
                </Button>
              </DialogTrigger>
              <DialogContent className="flex max-h-[80dvh] flex-col sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>확인할 문제 {diagnostics.length}건</DialogTitle>
                  <DialogDescription>
                    컴파일러가 짚어 준 순서 그대로입니다. 항목을 고르면 그 문제로 이동합니다.
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="min-h-0 flex-1 rounded-panel border">
                  <ul className="divide-y">
                    {diagnostics.map((diagnostic, index) => (
                      <li key={`${diagnostic.rule_id}-${diagnostic.span.start}-${index}`}>
                        <button
                          type="button"
                          aria-current={index === currentIndex ? 'true' : undefined}
                          onClick={() => {
                            select(index)
                            setListOpen(false)
                          }}
                          className={cn(
                            'w-full cursor-pointer px-3 py-2.5 text-left',
                            'hover:bg-surface-raised focus-visible:bg-surface-raised',
                            index === currentIndex && 'bg-surface-raised',
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <DiagnosticBadge severity={diagnostic.severity} />
                            <span className="text-sm font-medium text-text">
                              {renderTitle?.(diagnostic) ?? '확인할 문제'}
                            </span>
                            <span className="ml-auto shrink-0 font-mono text-xs text-text-subtle">
                              {index + 1} / {diagnostics.length}
                            </span>
                          </div>
                          <div className="mt-1 text-sm leading-6 break-words text-text-muted">
                            {renderMessage(diagnostic)}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!isCurrent}
            /*
             * 최신 검토가 아니면 위치가 어긋나므로 이동을 막는다. 다만 막힌 이유는 위쪽
             * 문장이 이미 말하고 있어야 한다 — 이유 없이 회색인 버튼은 고장 난 버튼이다.
             */
            title={isCurrent ? undefined : '최신 검토가 끝나면 이동할 수 있습니다'}
            onClick={() => onSelect(current, currentIndex)}
          >
            문제 위치로 이동
          </Button>
          {onAskAi === undefined ? null : (
            <Button type="button" size="sm" onClick={() => onAskAi(current, currentIndex)}>
              <SparkleIcon className="size-4" />
              AI에게 해결 요청
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
