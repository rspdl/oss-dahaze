'use client'

import * as React from 'react'
import { useState } from 'react'
import { Badge, Button, Textarea, cn } from '@dahaze/ui'

import type { PlanningAiJob, PlanningCompilerReview, PlanningDraft, PlanningItem, PlanningProposal, PlanningSubject, PlanningWorkspaceModel } from './planning-types'

export interface PlanningWorkspaceProps {
  model: PlanningWorkspaceModel
  initialSubject?: PlanningSubject
  busy?: boolean
  onSendMessage?: (content: string, subject?: PlanningSubject) => Promise<boolean>
  onGenerateDraft?: () => void
  onCancelJob?: (id: string) => void
  onRetryJob?: (id: string) => void
  onSelectDraft?: (id: string | null) => void
  onApplyDraft?: (id: string) => void
  onRestoreSnapshot?: (revision: number) => void
  onInspectSnapshot?: (revision: number) => void
  onOpenSource?: (path: string) => void
  onResolveDecision?: (id: string, action: 'adopt' | 'defer', reason: string) => Promise<boolean>
  onResolveProposal?: (id: string, action: 'adopt' | 'defer', reason: string) => Promise<boolean>
  draftArtifacts?: React.ReactNode
  handoff?: React.ReactNode
}

export function PlanningWorkspace({ model, initialSubject, busy = false, onSendMessage, onGenerateDraft, onCancelJob, onRetryJob, onSelectDraft, onApplyDraft, onRestoreSnapshot, onInspectSnapshot, onOpenSource, onResolveDecision, onResolveProposal, draftArtifacts, handoff }: PlanningWorkspaceProps) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [subject, setSubject] = useState<PlanningSubject | undefined>(initialSubject)
  const selectedDraft = model.drafts.find((draft) => draft.id === model.selectedDraftId) ?? null
  const hasActiveJob = model.jobs.some((job) => job.status === 'queued' || job.status === 'running')

  return <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden border md:grid-cols-[minmax(17rem,0.8fr)_minmax(24rem,1.4fr)_minmax(18rem,0.8fr)]">
    <section aria-label="기획 인터뷰" className="flex min-h-[28rem] min-w-0 flex-col border-b md:min-h-0 md:border-r md:border-b-0">
      <WorkspaceHeading eyebrow="INTERVIEW" title="기획 인터뷰" subtitle="답변과 결정은 프로젝트에 저장됩니다." />
      <JobStatusPanel jobs={model.jobs} busy={busy} onCancel={onCancelJob} onRetry={onRetryJob} onOpenDraft={onSelectDraft} />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {model.messages.length === 0 ? <p className="text-sm leading-relaxed text-text-muted">목적, 사용자, 반드시 지켜야 할 업무 규칙부터 적어 주세요.</p> : model.messages.map((entry) => <article key={entry.id} className={cn('max-w-[92%] text-sm leading-relaxed', entry.role === 'user' ? 'ml-auto border-l-2 border-accent pl-3' : 'pr-3')}><p className="mb-1 text-[10px] font-medium tracking-widest text-text-subtle">{entry.role === 'user' ? '나' : 'AI'}</p><p className="whitespace-pre-wrap text-text">{entry.content}</p></article>)}
      </div>
      <form className="border-t p-3" onSubmit={async (event) => { event.preventDefault(); const content = message.trim(); if (!content || busy || sending || hasActiveJob || onSendMessage === undefined) return; setSending(true); try { if (await onSendMessage(content, subject)) { setMessage(''); setSubject(undefined) } } finally { setSending(false) } }}>
        {subject === undefined ? null : <div className="mb-2 flex items-center justify-between gap-2 rounded-control border bg-surface-raised px-2 py-1.5 text-xs"><span className="min-w-0 truncate">이어서 확인 · {subject.label}</span><button type="button" className="shrink-0 text-text-subtle hover:text-text" onClick={() => setSubject(undefined)}>선택 해제</button></div>}
        <Textarea aria-label="기획 인터뷰 답변" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="답변하거나 새로운 요구를 적으세요" className="min-h-20 resize-none" />
        <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[11px] text-text-subtle">{hasActiveJob ? '진행 중인 AI 작업이 끝나면 다음 요청을 보낼 수 있습니다.' : '답변은 저장되고 AI 작업으로 이어집니다.'}</span><Button type="submit" size="sm" disabled={busy || sending || hasActiveJob || message.trim() === '' || onSendMessage === undefined}>AI에게 보내기</Button></div>
      </form>
    </section>

    <main className="min-h-0 min-w-0 overflow-y-auto">
      <WorkspaceHeading eyebrow="REVIEW" title="기획 검토" subtitle={`프로젝트 버전 ${model.projectRevision} · 상태 리비전 ${model.revision}`} />
      <div className="divide-y">
        <ReviewSection title="컴파일러 진단" count={model.compiler.state === 'recognized' ? model.compiler.diagnostics.length : undefined} stateLabel={`${model.compiler.source.kind === 'current' ? '저장 명세' : '선택한 초안'} · ${compilerLabel(model.compiler.state)}${model.compiler.rspdlVersion ? ` · rspdl ${model.compiler.rspdlVersion}` : ''}`} items={model.compiler.diagnostics} onOpenSource={onOpenSource} onAskAi={(item) => setSubject({ kind: 'diagnostic', id: item.id, label: item.title, sourcePath: item.sourcePath })} empty={compilerEmpty(model.compiler)} context={<CompilerProvenance compiler={model.compiler} />} />
        <ReviewSection title="AI 확인 질문" count={model.questions.length} items={model.questions} onAskAi={(item) => setSubject({ kind: 'question', id: item.id, label: item.title, sourcePath: item.sourcePath })} empty="현재 저장된 확인 질문이 없습니다." />
        <ReviewSection title="확정한 목적과 정책" count={model.acceptedDecisions.length} items={model.acceptedDecisions} empty="아직 확정한 결정이 없습니다." />
        <ProposalSection items={model.proposals} busy={busy} onResolve={onResolveProposal} onDiscuss={(item) => setSubject({ kind: 'proposal', id: item.id, label: item.title, sourcePath: item.sourcePath })} />
        <DecisionSection items={model.unresolvedDecisions} busy={busy} onResolve={onResolveDecision} />
        <ReviewSection title="검증 미지원 범위" count={model.unsupported.length} items={model.unsupported} empty="지원 범위 정보가 제공되지 않았습니다." />
      </div>
    </main>

    <aside aria-label="변경안과 버전" className="flex min-h-0 min-w-0 flex-col border-t md:border-t-0 md:border-l">
      <WorkspaceHeading eyebrow="CHANGES" title="변경안과 버전" subtitle="초안은 검토 후 명시적으로 적용합니다." />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">명세·IA 초안 작성</h3><p className="mt-1 text-xs leading-relaxed text-text-muted">확정한 정책과 대화를 바탕으로 컴파일된 작업 초안을 만듭니다. 저장 명세는 바뀌지 않습니다.</p></div><Button size="sm" disabled={busy || hasActiveJob || onGenerateDraft === undefined} onClick={onGenerateDraft}>초안 만들기</Button></div></section>
        <section className="border-b p-4"><h3 className="text-sm font-semibold">작업 초안</h3><div className="mt-3 space-y-1"><button type="button" onClick={() => onSelectDraft?.(null)} className={cn('w-full border-l-2 px-3 py-2 text-left', model.selectedDraftId === null ? 'border-accent bg-accent-subtle' : 'border-transparent hover:bg-surface-raised')}><span className="block text-sm font-medium">저장 명세 진단 보기</span><span className="mt-0.5 block text-xs text-text-subtle">선택한 초안 없이 저장된 문서의 컴파일 응답을 봅니다.</span></button>{model.drafts.length === 0 ? <p className="px-3 py-2 text-sm text-text-muted">저장된 초안이 없습니다.</p> : model.drafts.map((draft) => <button type="button" key={draft.id} onClick={() => onSelectDraft?.(draft.id)} className={cn('w-full border-l-2 px-3 py-2 text-left', selectedDraft?.id === draft.id ? 'border-accent bg-accent-subtle' : 'border-transparent hover:bg-surface-raised')}><span className="block text-sm font-medium">{draft.summary}</span><span className="mt-0.5 block text-xs text-text-subtle">기준 버전 {draft.baseRevision} · {draft.status === 'applied' ? '적용됨' : '검토 대기'}</span></button>)}</div></section>
        {selectedDraft === null ? null : <DraftPreview draft={selectedDraft} busy={busy} onApply={onApplyDraft} />}
        {selectedDraft === null ? null : draftArtifacts}
        <section className="p-4"><h3 className="text-sm font-semibold">프로젝트 버전</h3><div className="mt-3 divide-y border-y">{model.snapshots.map((snapshot) => <div key={snapshot.revision} className="flex items-center gap-2 py-2"><button type="button" onClick={() => onInspectSnapshot?.(snapshot.revision)} className="min-w-0 flex-1 text-left"><span className="block text-sm">스냅샷 {snapshot.revision}</span><span className="block truncate text-xs text-text-subtle">{snapshot.changeKind} · {snapshot.sourceHash.slice(0, 10)}</span></button><Button size="sm" variant="ghost" disabled={busy || onRestoreSnapshot === undefined} onClick={() => onRestoreSnapshot?.(snapshot.revision)}>복원</Button></div>)}</div></section>
        {handoff}
      </div>
    </aside>
  </div>
}

function WorkspaceHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) { return <header className="shrink-0 border-b px-4 py-3"><p className="text-[10px] font-medium tracking-[0.16em] text-text-subtle">{eyebrow}</p><div className="mt-1 flex items-baseline justify-between gap-2"><h2 className="text-base font-semibold tracking-tight">{title}</h2></div><p className="mt-1 text-xs text-text-muted">{subtitle}</p></header> }

function compilerLabel(state: PlanningWorkspaceModel['compiler']['state']) { if (state === 'running') return '검사 중'; if (state === 'recognized') return '결과 수신'; if (state === 'unsupported-shape') return '지원하지 않는 결과'; if (state === 'failed') return '불러오기 실패'; return '검사 전' }

function compilerEmpty(compiler: PlanningCompilerReview): string {
  if (compiler.state === 'recognized') return '보고된 진단이 없습니다. 검증 범위는 아래 미지원 항목과 함께 확인하세요.'
  if (compiler.state === 'running') return compiler.source.kind === 'current' ? '저장 명세를 다시 검사하고 있습니다.' : '선택한 초안의 컴파일 결과를 불러오고 있습니다.'
  if (compiler.state === 'failed') return '컴파일 결과를 불러오지 못했습니다. 이전 결과로 대신 표시하지 않습니다.'
  if (compiler.state === 'unsupported-shape') return '현재 화면이 알지 못하는 컴파일 결과 모양입니다.'
  return compiler.source.kind === 'current' ? '저장 명세의 컴파일 결과가 없습니다.' : '선택한 초안의 컴파일 결과가 없습니다.'
}

function CompilerProvenance({ compiler }: { compiler: PlanningCompilerReview }) {
  if (compiler.source.kind === 'current') return <div className="mt-3 rounded-control border bg-surface-raised/40 px-3 py-2 text-xs text-text-muted"><p className="font-medium text-text">저장 명세 컴파일 응답</p>{compiler.failureMessage ? <p className="mt-1 text-diagnostic-warning">{compiler.failureMessage}</p> : null}{compiler.source.documents.length === 0 ? null : <details className="mt-2"><summary className="cursor-pointer text-text-subtle">검증 대상 문서</summary><p className="mt-1 text-text-subtle">이 결과를 만든 문서를 확인할 수 있습니다.</p><ul className="mt-2 space-y-1">{compiler.source.documents.map((document) => <li key={document.path}><span className="font-mono">{document.path}</span><span className="block break-all font-mono text-[10px] text-text-subtle">{document.sourceHash}</span></li>)}</ul></details>}</div>
  const source = compiler.source
  return <div className={cn('mt-3 rounded-control border bg-surface-raised/40 px-3 py-2 text-xs text-text-muted', source.stale && 'border-diagnostic-warning/50')}><p className="font-medium text-text">선택한 초안 · {source.summary}</p><p className="mt-1">기준 프로젝트 버전 {source.baseProjectRevision}</p>{source.stale ? <p className="mt-2 text-diagnostic-warning">현재 저장 명세와 다른 기준에서 만든 초안입니다. 아래 진단은 후보에만 해당합니다.</p> : <p className="mt-2 text-text-subtle">아래 진단은 선택한 후보 원문에 해당합니다.</p>}<details className="mt-2"><summary className="cursor-pointer text-text-subtle">검증 정보</summary><p className="mt-1 break-all font-mono text-[10px] text-text-subtle">기준 원문 {source.baseSourceHash || '알 수 없음'}</p><p className="mt-1 break-all font-mono text-[10px] text-text-subtle">후보 원문 {source.candidateSourceHash || '알 수 없음'}</p></details>{compiler.failureMessage ? <p className="mt-1 text-diagnostic-warning">{compiler.failureMessage}</p> : null}</div>
}

function ReviewSection({ title, count, stateLabel, items, empty, context, onOpenSource, onAskAi }: { title: string; count?: number; stateLabel?: string; items: PlanningItem[]; empty: string; context?: React.ReactNode; onOpenSource?: (path: string) => void; onAskAi?: (item: PlanningItem) => void }) { return <section className="px-5 py-5"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{title}</h3>{count === undefined ? null : <Badge variant="outline">{count}</Badge>}{stateLabel ? <span className="ml-auto text-xs text-text-subtle">{stateLabel}</span> : null}</div>{context}{items.length === 0 ? <p className="mt-3 text-sm leading-relaxed text-text-muted">{empty}</p> : <ul className="mt-3 space-y-3">{items.map((item) => <li key={item.id} className="border-l-2 border-border-strong pl-3"><p className="text-sm font-medium">{item.title}</p>{item.detail ? <p className="mt-1 text-sm leading-relaxed text-text-muted">{item.detail}</p> : null}{item.sourcePath ? onOpenSource === undefined ? <span className="mt-1 block font-mono text-[11px] text-text-subtle">{item.sourcePath}</span> : <button type="button" onClick={() => onOpenSource(item.sourcePath!)} className="mt-1 block font-mono text-[11px] text-accent underline-offset-2 hover:underline">{item.sourcePath}</button> : null}{onAskAi === undefined ? null : <button type="button" className="mt-1 text-[11px] text-accent underline-offset-2 hover:underline" onClick={() => onAskAi(item)}>AI와 이어서 확인</button>}</li>)}</ul>}</section> }

function DraftPreview({ draft, busy, onApply }: { draft: PlanningDraft; busy: boolean; onApply?: (id: string) => void }) { return <section className="border-b p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">변경 미리보기</h3><Button size="sm" disabled={busy || draft.status !== 'draft' || onApply === undefined} onClick={() => onApply?.(draft.id)}>변경 적용</Button></div><div className="mt-3 space-y-3">{draft.changes.map((change) => <div key={change.path}><p className="font-mono text-xs text-text">{change.path}</p><div className="mt-1 grid gap-1 text-[11px]"><pre className="overflow-x-auto border-l-2 border-diagnostic-error px-2 py-1 text-text-muted">{change.before === undefined ? '(기준 버전 본문 조회 필요)' : change.before === null ? '(새 문서)' : change.before}</pre><pre className="overflow-x-auto border-l-2 border-diagnostic-success px-2 py-1 text-text-muted">{change.after ?? '(삭제)'}</pre></div></div>)}</div><div className="mt-4"><p className="text-xs font-medium text-text">분석 범위</p>{draft.analysis.length === 0 ? <p className="mt-1 text-xs text-text-subtle">분석 정보가 없습니다.</p> : <ul className="mt-1 list-disc pl-4 text-xs text-text-muted">{draft.analysis.map((line, index) => <li key={index}>{line}</li>)}</ul>}</div>{draft.diagnostics.length > 0 ? <p className="mt-3 text-xs text-diagnostic-warning">컴파일러 진단 {draft.diagnostics.length}건이 남아 있어 적용되지 않을 수 있습니다.</p> : null}</section> }

function DecisionSection({ items, busy, onResolve }: { items: PlanningItem[]; busy: boolean; onResolve?: PlanningWorkspaceProps['onResolveDecision'] }) { const [reason, setReason] = useState<Record<string, string>>({}); return <section className="px-5 py-5"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">미정 결정</h3><Badge variant="outline">{items.length}</Badge></div>{items.length === 0 ? <p className="mt-3 text-sm text-text-muted">현재 저장된 미정 결정이 없습니다.</p> : <div className="mt-3 space-y-4">{items.map((item) => <div key={item.id} className="border-l-2 border-border-strong pl-3"><p className="text-sm font-medium">{item.title}</p><input aria-label={`${item.title} 결정 이유`} value={reason[item.id] ?? ''} onChange={(event) => setReason((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="결정 또는 보류 이유" className="mt-2 h-8 w-full rounded-control border bg-surface px-2 text-xs" /><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => onResolve?.(item.id, 'adopt', reason[item.id] ?? '')} disabled={busy || onResolve === undefined}>채택</Button><Button size="sm" variant="outline" onClick={() => onResolve?.(item.id, 'defer', reason[item.id] ?? '')} disabled={busy || onResolve === undefined || (reason[item.id] ?? '').trim() === ''}>보류</Button></div></div>)}</div>}</section> }

function ProposalSection({ items, busy, onResolve, onDiscuss }: { items: PlanningProposal[]; busy: boolean; onResolve?: PlanningWorkspaceProps['onResolveProposal']; onDiscuss?: (item: PlanningProposal) => void }) {
  const [reason, setReason] = useState<Record<string, string>>({})
  const open = items.filter((item) => item.status === 'open')
  const resolved = items.filter((item) => item.status !== 'open')
  return <section className="px-5 py-5"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">AI 정책 제안</h3><Badge variant="outline">{open.length}</Badge><span className="ml-auto text-xs text-text-subtle">채택 전 미정</span></div>{open.length === 0 ? <p className="mt-3 text-sm text-text-muted">검토할 AI 정책 제안이 없습니다.</p> : <div className="mt-3 space-y-4">{open.map((item) => <div key={item.id} className="border-l-2 border-accent pl-3"><p className="text-sm font-medium">{item.title}</p>{item.detail ? <p className="mt-1 text-sm leading-relaxed text-text-muted">{item.detail}</p> : null}<input aria-label={`${item.title} 제안 판단 이유`} value={reason[item.id] ?? ''} onChange={(event) => setReason((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="채택 또는 보류 이유" className="mt-2 h-8 w-full rounded-control border bg-surface px-2 text-xs" /><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" onClick={() => onResolve?.(item.id, 'adopt', reason[item.id] ?? '')} disabled={busy || onResolve === undefined}>정책으로 채택</Button><Button size="sm" variant="outline" onClick={() => onResolve?.(item.id, 'defer', reason[item.id] ?? '')} disabled={busy || onResolve === undefined || (reason[item.id] ?? '').trim() === ''}>이유와 함께 보류</Button>{onDiscuss === undefined ? null : <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDiscuss(item)}>AI와 더 확인</Button>}</div></div>)}</div>}{resolved.length === 0 ? null : <details className="mt-4"><summary className="cursor-pointer text-xs text-text-subtle">이전 판단 {resolved.length}건</summary><ul className="mt-2 space-y-2">{resolved.map((item) => <li key={item.id} className="border-l-2 pl-3 text-xs"><p className="font-medium">{item.status === 'adopted' ? '채택' : '보류'} · {item.title}</p>{item.rationale ? <p className="mt-1 text-text-muted">{item.rationale}</p> : null}</li>)}</ul></details>}</section>
}

function JobStatusPanel({ jobs, busy, onCancel, onRetry, onOpenDraft }: { jobs: PlanningAiJob[]; busy: boolean; onCancel?: (id: string) => void; onRetry?: (id: string) => void; onOpenDraft?: (id: string) => void }) {
  if (jobs.length === 0) return null
  return <section aria-label="AI 작업 상태" className="shrink-0 border-b bg-surface-raised/40 px-4 py-3"><p className="text-[10px] font-medium tracking-[0.12em] text-text-subtle">AI 작업</p><div className="mt-2 max-h-72 space-y-2 overflow-y-auto">{jobs.map((job) => {
    const active = job.status === 'queued' || job.status === 'running'
    const progress = job.total !== undefined && job.total > 0 && job.completed !== undefined ? Math.min(job.completed, job.total) : undefined
    return <article key={job.id} className={cn('rounded-control border px-2.5 py-2 text-xs', job.status === 'failed' && 'border-diagnostic-error/50', job.disposition === 'stale' && 'border-diagnostic-warning/50')}><div className="flex items-center gap-2"><span className="font-medium text-text">{job.kind === 'interview' ? '인터뷰' : '명세·IA 초안'}</span><Badge variant="outline">{jobStatusLabel(job.status)}</Badge><span className="ml-auto text-text-subtle">{job.stage ?? ''}</span></div>{job.message ? <p className="mt-1 text-text-muted">{job.message}</p> : null}{progress === undefined ? null : <progress aria-label={`${job.kind === 'interview' ? '인터뷰' : '초안'} 진행률`} className="mt-2 h-1.5 w-full" value={progress} max={job.total} />}{job.errorMessage ? <p className="mt-1 text-diagnostic-error">{job.errorMessage}</p> : null}{job.disposition === 'stale' ? <p className="mt-1 text-diagnostic-warning">{job.conflictMessage ?? '작업 중 프로젝트가 바뀌어 결과가 현재 상태에 자동 반영되지 않았습니다.'}</p> : null}{job.resultMessage ? <details className="mt-2" open={job.disposition === 'stale'}><summary className="cursor-pointer text-text-subtle">보관된 결과</summary><p className="mt-1 whitespace-pre-wrap text-text-muted">{job.resultMessage}</p>{job.resultItems?.length ? <ul className="mt-1 list-disc pl-4 text-text-muted">{job.resultItems.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}</details> : null}<div className="mt-1.5 flex justify-end gap-2">{job.draftId && onOpenDraft ? <button type="button" disabled={busy} className="text-accent underline-offset-2 hover:underline disabled:opacity-50" onClick={() => onOpenDraft(job.draftId!)}>초안 검토</button> : null}{active && onCancel ? <button type="button" disabled={busy} className="text-text-muted underline-offset-2 hover:underline disabled:opacity-50" onClick={() => onCancel(job.id)}>취소</button> : null}{!active && job.retryable && onRetry ? <button type="button" disabled={busy} className="text-accent underline-offset-2 hover:underline disabled:opacity-50" onClick={() => onRetry(job.id)}>다시 시도</button> : null}</div></article>
  })}</div></section>
}

function jobStatusLabel(status: PlanningAiJob['status']): string {
  if (status === 'queued') return '대기'
  if (status === 'running') return '진행 중'
  if (status === 'succeeded') return '완료'
  if (status === 'failed') return '실패'
  return '취소됨'
}
