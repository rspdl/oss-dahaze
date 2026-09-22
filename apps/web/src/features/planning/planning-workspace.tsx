'use client'

import * as React from 'react'
import { useState } from 'react'
import { Badge, Button, Textarea, cn } from '@dahaze/ui'

import type { PlanningCompilerReview, PlanningDraft, PlanningItem, PlanningWorkspaceModel } from './planning-types'

export interface PlanningWorkspaceProps {
  model: PlanningWorkspaceModel
  busy?: boolean
  onSendMessage?: (content: string) => Promise<boolean>
  onSelectDraft?: (id: string | null) => void
  onApplyDraft?: (id: string) => void
  onRestoreSnapshot?: (revision: number) => void
  onInspectSnapshot?: (revision: number) => void
  onOpenSource?: (path: string) => void
  onResolveDecision?: (id: string, action: 'adopt' | 'defer', reason: string) => Promise<boolean>
  handoff?: React.ReactNode
}

export function PlanningWorkspace({ model, busy = false, onSendMessage, onSelectDraft, onApplyDraft, onRestoreSnapshot, onInspectSnapshot, onOpenSource, onResolveDecision, handoff }: PlanningWorkspaceProps) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const selectedDraft = model.drafts.find((draft) => draft.id === model.selectedDraftId) ?? null

  return <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden border md:grid-cols-[minmax(17rem,0.8fr)_minmax(24rem,1.4fr)_minmax(18rem,0.8fr)]">
    <section aria-label="기획 인터뷰" className="flex min-h-[28rem] min-w-0 flex-col border-b md:min-h-0 md:border-r md:border-b-0">
      <WorkspaceHeading eyebrow="INTERVIEW" title="기획 인터뷰" subtitle="답변과 결정은 프로젝트에 저장됩니다." />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {model.messages.length === 0 ? <p className="text-sm leading-relaxed text-text-muted">목적, 사용자, 반드시 지켜야 할 업무 규칙부터 적어 주세요.</p> : model.messages.map((entry) => <article key={entry.id} className={cn('max-w-[92%] text-sm leading-relaxed', entry.role === 'user' ? 'ml-auto border-l-2 border-accent pl-3' : 'pr-3')}><p className="mb-1 text-[10px] font-medium tracking-widest text-text-subtle">{entry.role === 'user' ? '나' : 'AI'}</p><p className="whitespace-pre-wrap text-text">{entry.content}</p></article>)}
      </div>
      <form className="border-t p-3" onSubmit={async (event) => { event.preventDefault(); const content = message.trim(); if (!content || busy || sending || onSendMessage === undefined) return; setSending(true); try { if (await onSendMessage(content)) setMessage('') } finally { setSending(false) } }}>
        <Textarea aria-label="기획 인터뷰 답변" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="답변하거나 새로운 요구를 적으세요" className="min-h-20 resize-none" />
        <div className="mt-2 flex justify-end"><Button type="submit" size="sm" disabled={busy || sending || message.trim() === '' || onSendMessage === undefined}>보내기</Button></div>
      </form>
    </section>

    <main className="min-h-0 min-w-0 overflow-y-auto">
      <WorkspaceHeading eyebrow="REVIEW" title="기획 검토" subtitle={`프로젝트 버전 ${model.projectRevision} · 상태 리비전 ${model.revision}`} />
      <div className="divide-y">
        <ReviewSection title="컴파일러 진단" count={model.compiler.state === 'recognized' ? model.compiler.diagnostics.length : undefined} stateLabel={`${model.compiler.source.kind === 'current' ? '저장 명세' : '선택한 초안'} · ${compilerLabel(model.compiler.state)}${model.compiler.rspdlVersion ? ` · rspdl ${model.compiler.rspdlVersion}` : ''}`} items={model.compiler.diagnostics} onOpenSource={onOpenSource} empty={compilerEmpty(model.compiler)} context={<CompilerProvenance compiler={model.compiler} />} />
        <ReviewSection title="AI 확인 질문" count={model.questions.length} items={model.questions} empty="현재 저장된 확인 질문이 없습니다." />
        <ReviewSection title="확정한 목적과 정책" count={model.acceptedDecisions.length} items={model.acceptedDecisions} empty="아직 확정한 결정이 없습니다." />
        <DecisionSection items={model.unresolvedDecisions} onResolve={onResolveDecision} />
        <ReviewSection title="검증 미지원 범위" count={model.unsupported.length} items={model.unsupported} empty="지원 범위 정보가 제공되지 않았습니다." />
      </div>
    </main>

    <aside aria-label="변경안과 버전" className="flex min-h-0 min-w-0 flex-col border-t md:border-t-0 md:border-l">
      <WorkspaceHeading eyebrow="CHANGES" title="변경안과 버전" subtitle="초안은 검토 후 명시적으로 적용합니다." />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b p-4"><h3 className="text-sm font-semibold">작업 초안</h3><div className="mt-3 space-y-1"><button type="button" onClick={() => onSelectDraft?.(null)} className={cn('w-full border-l-2 px-3 py-2 text-left', model.selectedDraftId === null ? 'border-accent bg-accent-subtle' : 'border-transparent hover:bg-surface-raised')}><span className="block text-sm font-medium">저장 명세 진단 보기</span><span className="mt-0.5 block text-xs text-text-subtle">선택한 초안 없이 저장된 문서의 컴파일 응답을 봅니다.</span></button>{model.drafts.length === 0 ? <p className="px-3 py-2 text-sm text-text-muted">저장된 초안이 없습니다.</p> : model.drafts.map((draft) => <button type="button" key={draft.id} onClick={() => onSelectDraft?.(draft.id)} className={cn('w-full border-l-2 px-3 py-2 text-left', selectedDraft?.id === draft.id ? 'border-accent bg-accent-subtle' : 'border-transparent hover:bg-surface-raised')}><span className="block text-sm font-medium">{draft.summary}</span><span className="mt-0.5 block text-xs text-text-subtle">기준 버전 {draft.baseRevision} · {draft.status === 'applied' ? '적용됨' : '검토 대기'}</span></button>)}</div></section>
        {selectedDraft === null ? null : <DraftPreview draft={selectedDraft} busy={busy} onApply={onApplyDraft} />}
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

function ReviewSection({ title, count, stateLabel, items, empty, context, onOpenSource }: { title: string; count?: number; stateLabel?: string; items: PlanningItem[]; empty: string; context?: React.ReactNode; onOpenSource?: (path: string) => void }) { return <section className="px-5 py-5"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{title}</h3>{count === undefined ? null : <Badge variant="outline">{count}</Badge>}{stateLabel ? <span className="ml-auto text-xs text-text-subtle">{stateLabel}</span> : null}</div>{context}{items.length === 0 ? <p className="mt-3 text-sm leading-relaxed text-text-muted">{empty}</p> : <ul className="mt-3 space-y-3">{items.map((item) => <li key={item.id} className="border-l-2 border-border-strong pl-3"><p className="text-sm font-medium">{item.title}</p>{item.detail ? <p className="mt-1 text-sm leading-relaxed text-text-muted">{item.detail}</p> : null}{item.sourcePath ? <button type="button" onClick={() => onOpenSource?.(item.sourcePath!)} className="mt-1 font-mono text-[11px] text-accent underline-offset-2 hover:underline">{item.sourcePath}</button> : null}</li>)}</ul>}</section> }

function DraftPreview({ draft, busy, onApply }: { draft: PlanningDraft; busy: boolean; onApply?: (id: string) => void }) { return <section className="border-b p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">변경 미리보기</h3><Button size="sm" disabled={busy || draft.status !== 'draft' || onApply === undefined} onClick={() => onApply?.(draft.id)}>변경 적용</Button></div><div className="mt-3 space-y-3">{draft.changes.map((change) => <div key={change.path}><p className="font-mono text-xs text-text">{change.path}</p><div className="mt-1 grid gap-1 text-[11px]"><pre className="overflow-x-auto border-l-2 border-diagnostic-error px-2 py-1 text-text-muted">{change.before === undefined ? '(기준 버전 본문 조회 필요)' : change.before === null ? '(새 문서)' : change.before}</pre><pre className="overflow-x-auto border-l-2 border-diagnostic-success px-2 py-1 text-text-muted">{change.after ?? '(삭제)'}</pre></div></div>)}</div><div className="mt-4"><p className="text-xs font-medium text-text">분석 범위</p>{draft.analysis.length === 0 ? <p className="mt-1 text-xs text-text-subtle">분석 정보가 없습니다.</p> : <ul className="mt-1 list-disc pl-4 text-xs text-text-muted">{draft.analysis.map((line, index) => <li key={index}>{line}</li>)}</ul>}</div>{draft.diagnostics.length > 0 ? <p className="mt-3 text-xs text-diagnostic-warning">컴파일러 진단 {draft.diagnostics.length}건이 남아 있어 적용되지 않을 수 있습니다.</p> : null}</section> }

function DecisionSection({ items, onResolve }: { items: PlanningItem[]; onResolve?: PlanningWorkspaceProps['onResolveDecision'] }) { const [reason, setReason] = useState<Record<string, string>>({}); return <section className="px-5 py-5"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">미정 결정</h3><Badge variant="outline">{items.length}</Badge></div>{items.length === 0 ? <p className="mt-3 text-sm text-text-muted">현재 저장된 미정 결정이 없습니다.</p> : <div className="mt-3 space-y-4">{items.map((item) => <div key={item.id} className="border-l-2 border-border-strong pl-3"><p className="text-sm font-medium">{item.title}</p><input aria-label={`${item.title} 결정 이유`} value={reason[item.id] ?? ''} onChange={(event) => setReason((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="결정 또는 보류 이유" className="mt-2 h-8 w-full rounded-control border bg-surface px-2 text-xs" /><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => onResolve?.(item.id, 'adopt', reason[item.id] ?? '')} disabled={onResolve === undefined}>채택</Button><Button size="sm" variant="outline" onClick={() => onResolve?.(item.id, 'defer', reason[item.id] ?? '')} disabled={onResolve === undefined || (reason[item.id] ?? '').trim() === ''}>보류</Button></div></div>)}</div>}</section> }
