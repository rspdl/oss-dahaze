'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  useProposePlanningEdit,
  type DocumentResponse,
  type ProposePlanningEditRequestEdit,
  type ProposePlanningEditResponse,
} from '@dahaze/api-client'
import { Button } from '@dahaze/ui'
import { useQueryClient } from '@tanstack/react-query'

import type { SemanticProposal } from '@/features/mockup/prototype-contract'
import { errorMessage } from '@/shared/api/errors'
import type { FlowGraph } from './flow-graph'
import { utf8Sha256 } from './document-hash'

type ElementKind = 'header' | 'section' | 'form' | 'heading' | 'input' | 'list' | 'button' | 'placeholder'

export function PlanningEditPanel({ projectId, projectRevision, projectSourceHash, proposal, graph, document, onClose }: {
  projectId: string
  projectRevision: number
  projectSourceHash: string
  proposal: SemanticProposal
  graph: FlowGraph
  document: DocumentResponse | undefined
  onClose: () => void
}) {
  const mutation = useProposePlanningEdit<ProposePlanningEditResponse>()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<ElementKind>('heading')
  const [elementId, setElementId] = useState(() => newElementId())
  const [value, setValue] = useState(() => proposal.kind === 'update-element' ? proposal.binding.name ?? proposal.binding.text ?? proposal.binding.fieldId ?? proposal.binding.modelId ?? '' : '새 제목')
  const [secondaryValue, setSecondaryValue] = useState(() => proposal.kind === 'update-element' ? proposal.binding.elementKind === 'list' ? (proposal.binding.fieldIds ?? []).join(', ') : proposal.binding.actionId ?? '' : '')
  const [parentId, setParentId] = useState('')
  const [beforeId, setBeforeId] = useState('')
  const [slot, setSlot] = useState<'root' | 'children' | 'inputs'>('root')
  const [label, setLabel] = useState('')
  const [result, setResult] = useState<ProposePlanningEditResponse | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const sourceNode = useMemo(() => graph.nodes.find((node) => node.id === sourceScreenKey(proposal)), [graph.nodes, proposal])
  const targetNode = proposal.kind === 'connect' ? graph.nodes.find((node) => node.id === proposal.targetScreenKey) : undefined
  const editable = document !== undefined && sourceNode !== undefined
  const status = compilerStatus(result?.compiler_response)
  const submit = async () => {
    if (!editable) return
    setFailure(null)
    setResult(null)
    try {
      const edit = buildEdit(proposal, sourceNode.screen.id, targetNode?.screen.id, { kind, elementId, value, secondaryValue, parentId, beforeId, slot, label })
      const expectedSourceHash = await utf8Sha256(document.text)
      const response = await mutation.mutateAsync({ projectId, data: {
        base_project_revision: projectRevision,
        base_source_hash: projectSourceHash,
        document_id: document.id,
        expected_source_hash: expectedSourceHash,
        edit,
        summary: summaryFor(proposal),
      } })
      setResult(response)
      if (response.draft !== null) await queryClient.invalidateQueries()
    } catch (error) {
      setFailure(errorMessage(error))
    }
  }

  return <section className="mt-2 rounded-control border border-accent/30 bg-surface px-3 py-3 text-xs" aria-label="의미 변경안">
    <div className="flex items-center justify-between"><div><p className="font-semibold">컴파일러로 의미 변경 검토</p><p className="mt-1 text-text-subtle">원문은 직접 바꾸지 않습니다. 후보를 컴파일한 뒤 기획 작업공간에서 검토하고 적용합니다.</p></div><button type="button" onClick={onClose} className="text-text-muted">닫기</button></div>
    {sourceNode === undefined ? <p className="mt-2 text-diagnostic-error">출발 화면을 현재 컴파일 결과에서 찾지 못했습니다.</p> : <p className="mt-2 text-text-muted">화면 · {sourceNode.screen.name} <span className="font-mono">({sourceNode.screen.id})</span></p>}
    {document === undefined ? <p className="mt-2 text-diagnostic-warning">이 화면의 확정 원문을 불러오는 중입니다.</p> : null}
    {proposal.kind === 'add-element' ? <div className="mt-3 grid gap-2 sm:grid-cols-2"><Field label="요소 종류"><select value={kind} onChange={(event) => setKind(event.target.value as ElementKind)} className="w-full rounded border bg-surface px-2 py-1"><option value="heading">제목</option><option value="button">버튼</option><option value="input">입력</option><option value="list">목록</option><option value="placeholder">자리표시자</option><option value="section">섹션</option><option value="form">폼</option><option value="header">헤더</option></select></Field><Field label="안정적 요소 ID"><input value={elementId} onChange={(event) => setElementId(event.target.value)} pattern="[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*" className="w-full rounded border bg-surface px-2 py-1 font-mono" /></Field>{requiresPrimary(kind) ? <Field label={primaryLabel(kind)}><input value={value} onChange={(event) => setValue(event.target.value)} className="w-full rounded border bg-surface px-2 py-1" /></Field> : null}{kind === 'list' || kind === 'button' ? <Field label={kind === 'list' ? '필드 ID들 (쉼표 구분)' : '행동 ID (선택)'}><input value={secondaryValue} onChange={(event) => setSecondaryValue(event.target.value)} className="w-full rounded border bg-surface px-2 py-1" /></Field> : null}<PlacementFields parentId={parentId} setParentId={setParentId} beforeId={beforeId} setBeforeId={setBeforeId} slot={slot} setSlot={setSlot} /></div> : null}
    {proposal.kind === 'update-element' ? proposal.binding.elementId === undefined ? <UnsupportedLegacy /> : <div className="mt-3 grid gap-2 sm:grid-cols-2"><Field label={updateLabel(proposal.binding.elementKind)}><input value={value} onChange={(event) => setValue(event.target.value)} className="w-full rounded border bg-surface px-2 py-1" /></Field>{proposal.binding.elementKind === 'list' || proposal.binding.elementKind === 'button' ? <Field label={proposal.binding.elementKind === 'list' ? '필드 ID들 (쉼표 구분)' : '행동 ID (선택)'}><input value={secondaryValue} onChange={(event) => setSecondaryValue(event.target.value)} className="w-full rounded border bg-surface px-2 py-1" /></Field> : null}</div> : null}
    {proposal.kind === 'move-element' ? proposal.binding.elementId === undefined ? <UnsupportedLegacy /> : <div className="mt-3 grid gap-2 sm:grid-cols-2"><PlacementFields parentId={parentId} setParentId={setParentId} beforeId={beforeId} setBeforeId={setBeforeId} slot={slot} setSlot={setSlot} /></div> : null}
    {proposal.kind === 'delete-element' && proposal.binding.elementId === undefined ? <UnsupportedLegacy /> : null}
    {proposal.kind === 'connect' ? <div className="mt-3"><p>{proposal.sourceElementId} → {targetNode?.screen.name ?? '도착 화면 없음'}</p><Field label="경로 표시 이름 (선택)"><input value={label} onChange={(event) => setLabel(event.target.value)} className="w-full rounded border bg-surface px-2 py-1" /></Field></div> : null}
    <Button className="mt-3" size="sm" disabled={!editable || mutation.isPending || hasUnsupportedLegacy(proposal)} onClick={() => void submit()}>{mutation.isPending ? '컴파일 중' : '변경안 컴파일'}</Button>
    {failure ? <p className="mt-2 rounded border border-diagnostic-error/40 px-2 py-1 text-diagnostic-error">{failure}</p> : null}
    {result ? <div className="mt-3 rounded border px-3 py-2"><p>rspdl {result.rspdl_version} · wire {result.wire_schema_version}</p>{!result.supported ? <p className="mt-1 text-diagnostic-warning">이 RSPDL 런타임에서는 구조화 편집을 사용할 수 없습니다. {result.unsupported_reason}</p> : status === 'rejected' ? <p className="mt-1 text-diagnostic-error">컴파일러가 변경을 거절했습니다. {compilerReason(result.compiler_response)}</p> : status !== 'applied' ? <p className="mt-1 text-diagnostic-warning">컴파일러 응답 상태를 확인할 수 없어 성공으로 처리하지 않았습니다.</p> : result.draft === null ? <p className="mt-1 text-diagnostic-warning">후보는 만들어졌지만 검토 가능한 프로젝트 초안이 없습니다.</p> : <><p className="mt-1">프로젝트 전체를 다시 컴파일한 초안을 만들었습니다.</p><Link href={`/projects/${projectId}/planning`} className="mt-2 inline-block font-medium text-accent">변경안 검토 및 적용 →</Link></>}</div> : null}
  </section>
}

function PlacementFields({ parentId, setParentId, beforeId, setBeforeId, slot, setSlot }: { parentId: string; setParentId: (value: string) => void; beforeId: string; setBeforeId: (value: string) => void; slot: 'root' | 'children' | 'inputs'; setSlot: (value: 'root' | 'children' | 'inputs') => void }) { return <><Field label="삽입 영역"><select value={slot} onChange={(event) => setSlot(event.target.value as typeof slot)} className="w-full rounded border bg-surface px-2 py-1"><option value="root">화면 루트</option><option value="children">자식 요소</option><option value="inputs">폼 입력</option></select></Field><Field label="부모 요소 ID (루트는 비움)"><input value={parentId} onChange={(event) => setParentId(event.target.value)} className="w-full rounded border bg-surface px-2 py-1" /></Field><Field label="이 요소 앞에 배치 (선택)"><input value={beforeId} onChange={(event) => setBeforeId(event.target.value)} className="w-full rounded border bg-surface px-2 py-1" /></Field></> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-text-subtle">{label}</span>{children}</label> }
function UnsupportedLegacy() { return <p className="mt-2 text-diagnostic-warning">이 요소는 안정적 ID가 없는 이전 형식이라 위치로 추측해 편집할 수 없습니다.</p> }
function hasUnsupportedLegacy(proposal: SemanticProposal) { return (proposal.kind === 'delete-element' || proposal.kind === 'move-element' || proposal.kind === 'update-element') && proposal.binding.elementId === undefined }
function sourceScreenKey(proposal: SemanticProposal): string { return proposal.kind === 'connect' ? proposal.sourceScreenKey : proposal.kind === 'add-element' ? proposal.screenKey : proposal.binding.screenKey }
function newElementId(): string { return `element_${crypto.randomUUID().replaceAll('-', '')}` }
function requiresPrimary(kind: ElementKind) { return kind === 'heading' || kind === 'button' || kind === 'input' || kind === 'list' || kind === 'placeholder' }
function primaryLabel(kind: ElementKind) { if (kind === 'button') return '버튼 이름'; if (kind === 'input') return '필드 ID'; if (kind === 'list') return '모델 ID'; return '표시 문구' }
function updateLabel(kind: string) { if (kind === 'button') return '버튼 이름'; if (kind === 'input') return '필드 ID'; if (kind === 'list') return '모델 ID'; return '표시 문구' }
function commaIds(value: string): string[] { return value.split(',').map((item) => item.trim()).filter(Boolean) }
function optional(value: string): string | undefined { return value.trim() === '' ? undefined : value.trim() }
function summaryFor(proposal: SemanticProposal) { if (proposal.kind === 'add-element') return '화면 요소 추가'; if (proposal.kind === 'delete-element') return '화면 요소 삭제'; if (proposal.kind === 'move-element') return '화면 요소 이동'; if (proposal.kind === 'update-element') return '화면 요소 속성 변경'; return '화면 경로 연결' }

function buildEdit(proposal: SemanticProposal, screenId: string, targetScreenId: string | undefined, form: { kind: ElementKind; elementId: string; value: string; secondaryValue: string; parentId: string; beforeId: string; slot: 'root' | 'children' | 'inputs'; label: string }): ProposePlanningEditRequestEdit {
  if (proposal.kind === 'delete-element') return { operation: 'delete', screen_id: screenId, element_id: proposal.binding.elementId! }
  if (proposal.kind === 'move-element') return { operation: 'move', screen_id: screenId, element_id: proposal.binding.elementId!, slot: form.slot, parent_element_id: optional(form.parentId), before_element_id: optional(form.beforeId) }
  if (proposal.kind === 'connect') return { operation: 'connect', source_screen_id: screenId, source_element_id: proposal.sourceElementId, target_screen_id: targetScreenId ?? '', label: optional(form.label) }
  if (proposal.kind === 'update-element') {
    const binding = proposal.binding
    const patch = binding.elementKind === 'button' ? { name: form.value, action_id: optional(form.secondaryValue) ?? null } : binding.elementKind === 'input' ? { field_id: form.value } : binding.elementKind === 'list' ? { model_id: form.value, field_ids: commaIds(form.secondaryValue) } : { text: form.value }
    return { operation: 'update', screen_id: screenId, element_id: binding.elementId!, patch }
  }
  const base = { id: form.elementId }
  const element = form.kind === 'heading' ? { ...base, kind: 'heading' as const, text: form.value } : form.kind === 'button' ? { ...base, kind: 'button' as const, name: form.value, action_id: optional(form.secondaryValue) } : form.kind === 'input' ? { ...base, kind: 'input' as const, field_id: form.value } : form.kind === 'list' ? { ...base, kind: 'list' as const, model_id: form.value, field_ids: commaIds(form.secondaryValue) } : form.kind === 'placeholder' ? { ...base, kind: 'placeholder' as const, text: form.value } : { ...base, kind: form.kind }
  return { operation: 'insert', screen_id: screenId, element, slot: form.slot, parent_element_id: optional(form.parentId), before_element_id: optional(form.beforeId) }
}

function compilerStatus(value: unknown): string | null { const response = record(value); const outcome = record(response?.outcome); return typeof outcome?.status === 'string' ? outcome.status : null }
function compilerReason(value: unknown): string { const outcome = record(record(value)?.outcome); return typeof outcome?.reason === 'string' ? outcome.reason : '거절 사유는 컴파일러 응답에 없습니다.' }
function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null }
