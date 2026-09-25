'use client'

import * as React from 'react'
import { useState } from 'react'
import { Badge, Button, cn } from '@dahaze/ui'

import type { PlanningCompilerReview, PlanningDraft, PlanningItem, PlanningProposal, PlanningSubject, PlanningWorkspaceModel } from './planning-types'

/**
 * 검토. 프로젝트에 들어오면 처음 보는 화면이다.
 *
 * 여기에는 **사람이 판단할 것**만 둔다 — 적용을 기다리는 변경안, 컴파일러 진단, AI 확인 질문,
 * AI 정책 제안, 미정 결정. 대화는 오른쪽 AI 패널이, 버전과 전달본은 버전·전달 화면이, 사용
 * 환경과 샘플 데이터는 설정 화면이 맡는다. 한 화면에 전부 두었더니 섹션이 열네 개가 되어
 * 무엇부터 봐야 하는지가 사라졌다.
 *
 * 확정한 정책과 검증 미지원 범위는 판단이 끝났거나 판단할 수 없는 것이라 맨 아래에 둔다.
 * 그래도 지우지 않는다 — 검토 첫 화면은 이 범주들을 구분해 보여 준다는 계획의 합의가 있다.
 */
export interface PlanningReviewProps {
  model: PlanningWorkspaceModel
  busy?: boolean
  /** 진행 중인 AI 작업이 있으면 새 초안 작성을 막는다. 작업 상태 자체는 AI 패널이 보여 준다. */
  hasActiveJob?: boolean
  onGenerateDraft?: () => void
  onSelectDraft?: (id: string | null) => void
  onApplyDraft?: (id: string) => void
  onOpenSource?: (path: string) => void
  onAskAi?: (subject: PlanningSubject) => void
  onResolveDecision?: (id: string, action: 'adopt' | 'defer', reason: string) => Promise<boolean>
  onResolveProposal?: (id: string, action: 'adopt' | 'defer', reason: string) => Promise<boolean>
  draftArtifacts?: React.ReactNode
}

export function PlanningReview({ model, busy = false, hasActiveJob = false, onGenerateDraft, onSelectDraft, onApplyDraft, onOpenSource, onAskAi, onResolveDecision, onResolveProposal, draftArtifacts }: PlanningReviewProps) {
  const selectedDraft = model.drafts.find((draft) => draft.id === model.selectedDraftId) ?? null
  const pending = model.drafts.filter((draft) => draft.status !== 'applied')
  const applied = model.drafts.filter((draft) => draft.status === 'applied')
  const ask = onAskAi === undefined ? undefined : (kind: PlanningSubject['kind']) => (item: PlanningItem) => onAskAi({ kind, id: item.id, label: item.title, sourcePath: item.sourcePath })

  return <div className="w-full max-w-3xl pb-10">
    <header className="mb-2">
      <h1 className="text-2xl font-semibold tracking-tight">검토</h1>
      <p className="mt-1.5 text-sm text-text-muted">프로젝트 버전 {model.projectRevision} · 적용 대기 변경안 {pending.length}건</p>
    </header>
    <div className="divide-y border-y">
      <section aria-label="변경안" className="py-5">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-sm font-semibold">변경안</h2><p className="mt-1 text-xs leading-relaxed text-text-muted">확정한 정책과 대화로 명세·IA 초안을 만들고, 컴파일 결과를 확인한 뒤 적용합니다. 적용 전까지 저장 명세는 바뀌지 않습니다.</p></div>
          <Button size="sm" disabled={busy || hasActiveJob || onGenerateDraft === undefined} onClick={onGenerateDraft}>초안 만들기</Button>
        </div>
        <div className="mt-3 space-y-1">
          <button type="button" onClick={() => onSelectDraft?.(null)} className={cn('w-full border-l-2 px-3 py-2 text-left', model.selectedDraftId === null ? 'border-accent bg-accent-subtle' : 'border-transparent hover:bg-surface-raised')}><span className="block text-sm font-medium">저장 명세 진단 보기</span><span className="mt-0.5 block text-xs text-text-subtle">선택한 초안 없이 저장된 문서의 컴파일 응답을 봅니다.</span></button>
          {pending.length === 0 ? <p className="px-3 py-2 text-sm text-text-muted">적용을 기다리는 초안이 없습니다.</p> : pending.map((draft) => <DraftRow key={draft.id} draft={draft} selected={selectedDraft?.id === draft.id} onSelect={onSelectDraft} />)}
          {applied.length === 0 ? null : <details className="pt-1"><summary className="cursor-pointer px-3 py-1 text-xs text-text-subtle">적용한 초안 {applied.length}건</summary><div className="mt-1 space-y-1">{applied.map((draft) => <DraftRow key={draft.id} draft={draft} selected={selectedDraft?.id === draft.id} onSelect={onSelectDraft} />)}</div></details>}
        </div>
        {selectedDraft === null ? null : <DraftPreview draft={selectedDraft} busy={busy} onApply={onApplyDraft} />}
        {selectedDraft === null ? null : draftArtifacts}
      </section>
      <ReviewSection title="컴파일러 진단" count={model.compiler.state === 'recognized' ? model.compiler.diagnostics.length : undefined} stateLabel={`${model.compiler.source.kind === 'current' ? '저장 명세' : '선택한 초안'} · ${compilerLabel(model.compiler.state)}${model.compiler.rspdlVersion ? ` · rspdl ${model.compiler.rspdlVersion}` : ''}`} items={model.compiler.diagnostics} onOpenSource={onOpenSource} onAskAi={ask?.('diagnostic')} empty={compilerEmpty(model.compiler)} context={<CompilerProvenance compiler={model.compiler} />} />
      <ReviewSection title="AI 확인 질문" count={model.questions.length} items={model.questions} onAskAi={ask?.('question')} empty="현재 저장된 확인 질문이 없습니다." />
      <ProposalSection items={model.proposals} busy={busy} onResolve={onResolveProposal} onDiscuss={onAskAi === undefined ? undefined : (item) => onAskAi({ kind: 'proposal', id: item.id, label: item.title, sourcePath: item.sourcePath })} />
      <DecisionSection items={model.unresolvedDecisions} busy={busy} onResolve={onResolveDecision} />
      <ReviewSection title="확정한 목적과 정책" count={model.acceptedDecisions.length} items={model.acceptedDecisions} empty="아직 확정한 결정이 없습니다." />
      <ReviewSection title="검증 미지원 범위" count={model.unsupported.length} items={model.unsupported} empty="지원 범위 정보가 제공되지 않았습니다." />
    </div>
  </div>
}

function DraftRow({ draft, selected, onSelect }: { draft: PlanningDraft; selected: boolean; onSelect?: (id: string | null) => void }) { return <button type="button" onClick={() => onSelect?.(draft.id)} className={cn('w-full border-l-2 px-3 py-2 text-left', selected ? 'border-accent bg-accent-subtle' : 'border-transparent hover:bg-surface-raised')}><span className="block text-sm font-medium">{draft.summary}</span><span className="mt-0.5 block text-xs text-text-subtle">기준 버전 {draft.baseRevision} · {draft.status === 'applied' ? '적용됨' : '검토 대기'}</span></button> }

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

function ReviewSection({ title, count, stateLabel, items, empty, context, onOpenSource, onAskAi }: { title: string; count?: number; stateLabel?: string; items: PlanningItem[]; empty: string; context?: React.ReactNode; onOpenSource?: (path: string) => void; onAskAi?: (item: PlanningItem) => void }) { return <section className="py-5"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{title}</h3>{count === undefined ? null : <Badge variant="outline">{count}</Badge>}{stateLabel ? <span className="ml-auto text-xs text-text-subtle">{stateLabel}</span> : null}</div>{context}{items.length === 0 ? <p className="mt-3 text-sm leading-relaxed text-text-muted">{empty}</p> : <ul className="mt-3 space-y-3">{items.map((item) => <li key={item.id} className="border-l-2 border-border-strong pl-3"><p className="text-sm font-medium">{item.title}</p>{item.detail ? <p className="mt-1 text-sm leading-relaxed text-text-muted">{item.detail}</p> : null}{item.resolutionRationale ? <p className="mt-1 text-xs text-text-subtle">판단 이유 · {item.resolutionRationale}</p> : null}{item.sourcePath ? onOpenSource === undefined ? <span className="mt-1 block font-mono text-[11px] text-text-subtle">{item.sourcePath}</span> : <button type="button" onClick={() => onOpenSource(item.sourcePath!)} className="mt-1 block font-mono text-[11px] text-accent underline-offset-2 hover:underline">{item.sourcePath}</button> : null}{onAskAi === undefined ? null : <button type="button" className="mt-1 text-[11px] text-accent underline-offset-2 hover:underline" onClick={() => onAskAi(item)}>AI와 이어서 확인</button>}</li>)}</ul>}</section> }

function DraftPreview({ draft, busy, onApply }: { draft: PlanningDraft; busy: boolean; onApply?: (id: string) => void }) { return <section className="mt-4 rounded-panel border p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">변경 미리보기</h3><Button size="sm" disabled={busy || draft.status !== 'draft' || onApply === undefined} onClick={() => onApply?.(draft.id)}>변경 적용</Button></div><div className="mt-3 space-y-3">{draft.changes.map((change) => <div key={change.path}><p className="font-mono text-xs text-text">{change.path}</p><div className="mt-1 grid gap-1 text-[11px]"><pre className="overflow-x-auto border-l-2 border-diagnostic-error px-2 py-1 text-text-muted">{change.before === undefined ? '(기준 버전 본문 조회 필요)' : change.before === null ? '(새 문서)' : change.before}</pre><pre className="overflow-x-auto border-l-2 border-diagnostic-success px-2 py-1 text-text-muted">{change.after ?? '(삭제)'}</pre></div></div>)}</div><div className="mt-4"><p className="text-xs font-medium text-text">분석 범위</p>{draft.analysis.length === 0 ? <p className="mt-1 text-xs text-text-subtle">분석 정보가 없습니다.</p> : <ul className="mt-1 list-disc pl-4 text-xs text-text-muted">{draft.analysis.map((line, index) => <li key={index}>{line}</li>)}</ul>}</div>{draft.diagnostics.length > 0 ? <p className="mt-3 text-xs text-diagnostic-warning">컴파일러 진단 {draft.diagnostics.length}건이 남아 있어 적용되지 않을 수 있습니다.</p> : null}</section> }

function DecisionSection({ items, busy, onResolve }: { items: PlanningItem[]; busy: boolean; onResolve?: PlanningReviewProps['onResolveDecision'] }) { const [reason, setReason] = useState<Record<string, string>>({}); return <section className="py-5"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">미정 결정</h3><Badge variant="outline">{items.length}</Badge></div>{items.length === 0 ? <p className="mt-3 text-sm text-text-muted">현재 저장된 미정 결정이 없습니다.</p> : <div className="mt-3 space-y-4">{items.map((item) => <div key={item.id} className="border-l-2 border-border-strong pl-3"><p className="text-sm font-medium">{item.title}</p><input aria-label={`${item.title} 결정 이유`} value={reason[item.id] ?? ''} onChange={(event) => setReason((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="결정 또는 보류 이유" className="mt-2 h-8 w-full rounded-control border bg-surface px-2 text-xs" /><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => onResolve?.(item.id, 'adopt', reason[item.id] ?? '')} disabled={busy || onResolve === undefined}>채택</Button><Button size="sm" variant="outline" onClick={() => onResolve?.(item.id, 'defer', reason[item.id] ?? '')} disabled={busy || onResolve === undefined || (reason[item.id] ?? '').trim() === ''}>보류</Button></div></div>)}</div>}</section> }

function ProposalSection({ items, busy, onResolve, onDiscuss }: { items: PlanningProposal[]; busy: boolean; onResolve?: PlanningReviewProps['onResolveProposal']; onDiscuss?: (item: PlanningProposal) => void }) {
  const [reason, setReason] = useState<Record<string, string>>({})
  const open = items.filter((item) => item.status === 'open')
  const resolved = items.filter((item) => item.status !== 'open')
  return <section className="py-5"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">AI 정책 제안</h3><Badge variant="outline">{open.length}</Badge><span className="ml-auto text-xs text-text-subtle">채택 전 미정</span></div>{open.length === 0 ? <p className="mt-3 text-sm text-text-muted">검토할 AI 정책 제안이 없습니다.</p> : <div className="mt-3 space-y-4">{open.map((item) => <div key={item.id} className="border-l-2 border-accent pl-3"><p className="text-sm font-medium">{item.title}</p>{item.detail ? <p className="mt-1 text-sm leading-relaxed text-text-muted">{item.detail}</p> : null}<input aria-label={`${item.title} 제안 판단 이유`} value={reason[item.id] ?? ''} onChange={(event) => setReason((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="채택 또는 보류 이유" className="mt-2 h-8 w-full rounded-control border bg-surface px-2 text-xs" /><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" onClick={() => onResolve?.(item.id, 'adopt', reason[item.id] ?? '')} disabled={busy || onResolve === undefined}>정책으로 채택</Button><Button size="sm" variant="outline" onClick={() => onResolve?.(item.id, 'defer', reason[item.id] ?? '')} disabled={busy || onResolve === undefined || (reason[item.id] ?? '').trim() === ''}>이유와 함께 보류</Button>{onDiscuss === undefined ? null : <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDiscuss(item)}>AI와 더 확인</Button>}</div></div>)}</div>}{resolved.length === 0 ? null : <details className="mt-4"><summary className="cursor-pointer text-xs text-text-subtle">이전 판단 {resolved.length}건</summary><ul className="mt-2 space-y-2">{resolved.map((item) => <li key={item.id} className="border-l-2 pl-3 text-xs"><p className="font-medium">{item.status === 'adopted' ? '채택' : '보류'} · {item.title}</p>{item.detail ? <p className="mt-1 text-text-muted">{item.detail}</p> : null}{item.resolutionRationale ? <p className="mt-1 text-text-subtle">판단 이유 · {item.resolutionRationale}</p> : null}</li>)}</ul></details>}</section>
}

