'use client'

import * as React from 'react'
import { useState } from 'react'
import { Badge, Button, Textarea, cn } from '@dahaze/ui'

import type { PlanningAiJob, PlanningMessage, PlanningSubject } from './planning-types'

/**
 * AI 대화 패널의 내용. 기획 인터뷰 메시지와 AI 작업 상태, 입력창.
 *
 * 메시지와 작업은 서버가 보관한다 — 새로고침해도 대화가 남는다. 여기서 들고 있는 것은
 * 입력 중인 글자뿐이다. 맥락(`subject`)은 패널 밖에서도 바뀌므로 (화면 흐름에서 요소를
 * 골라 "AI와 확인") 이 컴포넌트가 소유하지 않고 받는다.
 */
export interface PlanningInterviewProps {
  messages: PlanningMessage[]
  jobs: PlanningAiJob[]
  subject?: PlanningSubject
  busy?: boolean
  onClearSubject?: () => void
  onSendMessage?: (content: string, subject?: PlanningSubject) => Promise<boolean>
  onCancelJob?: (id: string) => void
  onRetryJob?: (id: string) => void
  onOpenDraft?: (id: string) => void
}

export function PlanningInterview({ messages, jobs, subject, busy = false, onClearSubject, onSendMessage, onCancelJob, onRetryJob, onOpenDraft }: PlanningInterviewProps) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const hasActiveJob = jobs.some((job) => job.status === 'queued' || job.status === 'running')

  return <section aria-label="AI 대화" className="flex min-h-0 flex-1 flex-col">
    <JobStatusPanel jobs={jobs} busy={busy} onCancel={onCancelJob} onRetry={onRetryJob} onOpenDraft={onOpenDraft} />
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
      {messages.length === 0 ? <p className="text-sm leading-relaxed text-text-muted">목적, 사용자, 반드시 지켜야 할 업무 규칙부터 적어 주세요.</p> : messages.map((entry) => <article key={entry.id} className={cn('max-w-[92%] text-sm leading-relaxed', entry.role === 'user' ? 'ml-auto border-l-2 border-accent pl-3' : 'pr-3')}><p className="mb-1 text-[10px] font-medium tracking-widest text-text-subtle">{entry.role === 'user' ? '나' : 'AI'}</p><p className="whitespace-pre-wrap text-text">{entry.content}</p></article>)}
    </div>
    <form className="border-t p-3" onSubmit={async (event) => { event.preventDefault(); const content = message.trim(); if (!content || busy || sending || hasActiveJob || onSendMessage === undefined) return; setSending(true); try { if (await onSendMessage(content, subject)) { setMessage(''); onClearSubject?.() } } finally { setSending(false) } }}>
      {subject === undefined ? null : <div className="mb-2 flex items-center justify-between gap-2 rounded-control border bg-surface-raised px-2 py-1.5 text-xs"><span className="min-w-0 truncate">이어서 확인 · {subject.label}</span><button type="button" className="shrink-0 text-text-subtle hover:text-text" onClick={onClearSubject}>선택 해제</button></div>}
      <Textarea aria-label="기획 인터뷰 답변" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="답변하거나 새로운 요구를 적으세요" className="min-h-20 resize-none" />
      <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[11px] text-text-subtle">{hasActiveJob ? '진행 중인 AI 작업이 끝나면 다음 요청을 보낼 수 있습니다.' : '답변은 프로젝트에 저장됩니다.'}</span><Button type="submit" size="sm" disabled={busy || sending || hasActiveJob || message.trim() === '' || onSendMessage === undefined}>AI에게 보내기</Button></div>
    </form>
  </section>
}

function JobStatusPanel({ jobs, busy, onCancel, onRetry, onOpenDraft }: { jobs: PlanningAiJob[]; busy: boolean; onCancel?: (id: string) => void; onRetry?: (id: string) => void; onOpenDraft?: (id: string) => void }) {
  if (jobs.length === 0) return null
  return <section aria-label="AI 작업 상태" className="shrink-0 border-b bg-surface-raised/40 px-4 py-3"><p className="text-[10px] font-medium tracking-[0.12em] text-text-subtle">AI 작업</p><div className="mt-2 max-h-72 space-y-2 overflow-y-auto">{jobs.map((job) => {
    const active = job.status === 'queued' || job.status === 'running'
    const progress = job.total !== undefined && job.total > 0 && job.completed !== undefined ? Math.min(job.completed, job.total) : undefined
    return <article key={job.id} className={cn('rounded-control border px-2.5 py-2 text-xs', job.status === 'failed' && 'border-diagnostic-error/50', job.disposition === 'stale' && 'border-diagnostic-warning/50')}><div className="flex items-center gap-2"><span className="font-medium text-text">{job.kind === 'interview' ? '인터뷰' : '명세·IA 초안'}</span><Badge variant="outline">{jobStatusLabel(job.status)}</Badge><span className="ml-auto text-text-subtle">{job.stage ?? ''}</span></div>{job.message ? <p className="mt-1 text-text-muted">{job.message}</p> : null}{progress === undefined ? null : <progress aria-label={`${job.kind === 'interview' ? '인터뷰' : '초안'} 진행률`} className="mt-2 h-1.5 w-full" value={progress} max={job.total} />}{job.errorMessage ? <p className="mt-1 text-diagnostic-error">{job.errorMessage}</p> : null}{job.disposition === 'stale' ? <p className="mt-1 text-diagnostic-warning">{job.conflictMessage ?? '작업 중 프로젝트가 바뀌어 결과가 현재 상태에 자동 반영되지 않았습니다.'}</p> : null}{job.resultMessage || job.resultItems?.length ? <details className="mt-2" open={job.disposition === 'stale'}><summary className="cursor-pointer text-text-subtle">보관된 결과</summary>{job.resultMessage ? <p className="mt-1 whitespace-pre-wrap text-text-muted">{job.resultMessage}</p> : null}{job.resultItems?.length ? <ul className="mt-1 list-disc pl-4 text-text-muted">{job.resultItems.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}</details> : null}<div className="mt-1.5 flex justify-end gap-2">{job.draftId && onOpenDraft ? <button type="button" disabled={busy} className="text-accent underline-offset-2 hover:underline disabled:opacity-50" onClick={() => onOpenDraft(job.draftId!)}>초안 검토</button> : null}{active && onCancel ? <button type="button" disabled={busy} className="text-text-muted underline-offset-2 hover:underline disabled:opacity-50" onClick={() => onCancel(job.id)}>취소</button> : null}{!active && job.retryable && onRetry ? <button type="button" disabled={busy} className="text-accent underline-offset-2 hover:underline disabled:opacity-50" onClick={() => onRetry(job.id)}>다시 시도</button> : null}</div></article>
  })}</div></section>
}

function jobStatusLabel(status: PlanningAiJob['status']): string {
  if (status === 'queued') return '대기'
  if (status === 'running') return '진행 중'
  if (status === 'succeeded') return '완료'
  if (status === 'failed') return '실패'
  return '취소됨'
}

