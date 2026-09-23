'use client'

import { useMemo, useState } from 'react'
import type { CompilerEditHandler, CompilerEditHandlerKind } from '@dahaze/api-client'

import type { ElementSelection, SemanticProposal } from '@/features/mockup/prototype-contract'
import { findReadableElement, findReadableScreen, type ReadablePath, type ReadableSpecification } from '@/features/specification/readable-specification'
import type { FlowGraph } from './flow-graph'
import { disconnectProposal } from './path-editor-contract'

const HANDLER_OPTIONS: { id: CompilerEditHandlerKind; label: string }[] = [
  { id: 'state', label: '상태' },
  { id: 'message', label: '메시지' },
  { id: 'popup', label: '팝업' },
  { id: 'loading', label: '로딩' },
]

type DestinationKind = 'screen' | CompilerEditHandlerKind

export function PathEditorControls({ selection, graph, specification, onPropose }: {
  selection: ElementSelection
  graph: FlowGraph
  specification: ReadableSpecification
  onPropose: (proposal: SemanticProposal) => void
}) {
  const screen = findReadableScreen(specification, selection.screenKey)
  const element = findReadableElement(screen, selection.elementId, selection.elementPath)
  const [outcomeId, setOutcomeId] = useState('')
  const [destinationKind, setDestinationKind] = useState<DestinationKind>('screen')
  const [targetScreenId, setTargetScreenId] = useState('')
  const [handlerId, setHandlerId] = useState('')
  const [handlerContent, setHandlerContent] = useState('')
  const [label, setLabel] = useState('')
  const existing = useMemo(
    () => (element?.paths ?? []).flatMap((path) => {
      const proposal = disconnectProposal(selection, path)
      return proposal === null ? [] : [{ path, proposal }]
    }),
    [element?.paths, selection],
  )
  const sourcePath = graph.nodes.find((node) => node.id === selection.screenKey)?.screen.path

  if (selection.elementId === undefined) return null
  if (element === null || element.outcomes.length === 0) {
    return <span className="text-text-subtle">이 요소에는 typed 행동 결과가 선언되지 않았습니다.</span>
  }

  const handler = destinationKind === 'screen' || handlerId.trim() === ''
    ? null
    : { kind: destinationKind, id: handlerId.trim(), ...(handlerContent.trim() === '' ? {} : { content: handlerContent.trim() }) } satisfies CompilerEditHandler
  const canConnect = outcomeId !== '' && (destinationKind === 'screen' ? targetScreenId !== '' : handler !== null)

  return <div className="flex flex-wrap items-center gap-2">
    <span className="text-text-muted">출발: {selection.elementId}</span>
    <label>결과 <select aria-label="연결 행동 결과" value={outcomeId} onChange={(event) => setOutcomeId(event.target.value)} className="rounded border bg-surface px-2 py-1"><option value="">결과 선택</option>{element.outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcomeLabel(outcome.kind, outcome.localId)}</option>)}</select></label>
    <label>처리 <select aria-label="연결 처리 종류" value={destinationKind} onChange={(event) => setDestinationKind(event.target.value as DestinationKind)} className="rounded border bg-surface px-2 py-1"><option value="screen">화면 이동</option>{HANDLER_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
    {destinationKind === 'screen'
      ? <label>도착 <select aria-label="연결 도착 화면" value={targetScreenId} onChange={(event) => setTargetScreenId(event.target.value)} className="rounded border bg-surface px-2 py-1"><option value="">화면 선택</option>{graph.nodes.filter((node) => node.id !== selection.screenKey && node.screen.path === sourcePath).map((node) => <option key={node.id} value={node.screen.id}>{node.screen.name}</option>)}</select></label>
      : <><label>{handlerLabel(destinationKind)} ID <input aria-label={`${handlerLabel(destinationKind)} ID`} value={handlerId} onChange={(event) => setHandlerId(event.target.value)} className="w-28 rounded border bg-surface px-2 py-1" /></label><label>표시 문구 <input aria-label="handler 표시 문구" value={handlerContent} onChange={(event) => setHandlerContent(event.target.value)} className="w-40 rounded border bg-surface px-2 py-1" /></label></>}
    <label>경로 이름 <input aria-label="경로 표시 이름" value={label} onChange={(event) => setLabel(event.target.value)} className="w-32 rounded border bg-surface px-2 py-1" /></label>
    <button type="button" disabled={!canConnect} className="rounded border px-2 py-1 disabled:opacity-40" onClick={() => onPropose({ kind: 'connect', sourceScreenKey: selection.screenKey, sourceElementId: selection.elementId!, outcomeId, targetScreenId: destinationKind === 'screen' ? targetScreenId : null, handler, label: optional(label) })}>연결 요청</button>
    {existing.length === 0 ? null : <details className="basis-full"><summary className="cursor-pointer text-text-muted">기존 결과 경로 {existing.length}개</summary><ul className="mt-1 space-y-1">{existing.map(({ path, proposal }, index) => <li key={`${path.id ?? 'path'}:${index}`} className="flex items-center gap-2"><span>{pathDisplay(path)}</span><button type="button" className="rounded border px-2 py-0.5" onClick={() => onPropose(proposal)}>연결 해제 요청</button></li>)}</ul></details>}
  </div>
}

function pathDisplay(path: ReadablePath): string {
  const outcome = path.outcome === null ? '결과 미지정' : outcomeLabel(path.outcome.kind, path.outcome.localId)
  const destination = path.targetScreen !== null ? `화면 이동 · ${path.targetScreen.name}` : path.handler === null ? '처리 대상 없음' : `${handlerLabel(path.handler.kind)} · ${path.handler.id ?? ''}`
  return [outcome, destination, path.label].filter((value) => value !== null && value !== '').join(' · ')
}

function outcomeLabel(kind: string, localId: string): string {
  const label = kind === 'success' ? '성공' : kind === 'failure' ? '실패' : kind === 'cancel' ? '취소' : kind === 'timeout' ? '시간 초과' : kind
  return `${label} · ${localId}`
}

function handlerLabel(kind: string): string {
  return HANDLER_OPTIONS.find((option) => option.id === kind)?.label ?? kind
}

function optional(value: string): string | null {
  return value.trim() === '' ? null : value.trim()
}
