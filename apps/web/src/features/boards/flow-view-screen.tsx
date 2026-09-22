'use client'

import { useCallback, useMemo, useState } from 'react'
import { cn } from '@dahaze/ui'

import { RequireSession } from '@/features/auth/require-session'
import { DEFAULT_VIEWPORT_DIMENSIONS, type MockupViewport } from '@/features/mockup/screen-mockup'
import { designBindingKey, type DesignBinding, type ElementDesign, type PrototypeMode, type SampleVariant, type SemanticProposal } from '@/features/mockup/prototype-contract'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { screenSourceSpan } from './board-ir'
import { BoardGate } from './board-gate'
import { FlowBoard } from './flow-board'
import { buildFlowGraph, outcomesByScreen, type FlowNode } from './flow-graph'
import { SourcePanel } from './source-panel'
import { useBoardData } from './use-board-data'

/** 선언된 화면과 그 사이 경로를 목업으로 보는 화면. */
export function FlowViewScreen({ projectId }: { projectId: string }) {
  return (
    <AppShell breadcrumb={<Crumb>화면 흐름</Crumb>} fullBleed lockToViewport>
      <RequireSession>
        <FlowView projectId={projectId} />
      </RequireSession>
    </AppShell>
  )
}

const VIEWPORTS: { id: MockupViewport; label: string }[] = [
  { id: 'desktop', label: '데스크톱' },
  { id: 'mobile', label: '모바일' },
]

function FlowView({ projectId }: { projectId: string }) {
  const data = useBoardData(projectId)
  /* 뷰포트는 아직 화면 안의 상태다. 프로젝트마다 고르는 설정으로 서버에 올리는 것은
     다음 슬라이스의 일이다 (RFC-0001 저장하는 것). */
  const [viewport, setViewport] = useState<MockupViewport>('desktop')
  const [dimensions, setDimensions] = useState(DEFAULT_VIEWPORT_DIMENSIONS.desktop)
  const [mode, setMode] = useState<PrototypeMode>('edit')
  const [sampleVariant, setSampleVariant] = useState<SampleVariant>('normal')
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [designByElementPath, setDesignByElementPath] = useState<Record<string, ElementDesign>>({})
  const [designHistory, setDesignHistory] = useState<Record<string, ElementDesign>[]>([])
  const [selectedElement, setSelectedElement] = useState<DesignBinding | null>(null)
  const [proposal, setProposal] = useState<SemanticProposal | null>(null)
  const [selectedSampleIdByModel, setSelectedSampleIdByModel] = useState<Record<string, string>>({})
  const [experienceValues, setExperienceValues] = useState<Record<string, string | boolean>>({})
  const [connectionTarget, setConnectionTarget] = useState('')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const graph = useMemo(
    () => buildFlowGraph(data.board, data.mockups.screens, viewport, { positions, nodeWidth: dimensions.width }),
    [data.board, data.mockups.screens, viewport, positions, dimensions.width],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected: FlowNode | null =
    graph.nodes.find((node) => node.id === selectedId) ?? graph.nodes[0] ?? null

  const withLayout = graph.nodes.filter((node) => node.mockup !== null).length
  const screenOutcomes = useMemo(() => outcomesByScreen(graph), [graph])
  const prototype = useMemo(() => ({
    dimensions,
    mode,
    sampleVariant,
    selectedElementPath: selectedElement?.elementPath ?? null,
    selectedElementScreenKey: selectedElement?.screenKey ?? null,
    designByElementPath,
    selectedSampleIdByModel,
    values: experienceValues,
    onValueChange: (fieldId: string, value: string | boolean) => setExperienceValues((current) => ({ ...current, [fieldId]: value })),
    onSampleSelect: (modelId: string, recordId: string) => setSelectedSampleIdByModel((current) => ({ ...current, [modelId]: recordId })),
    onElementSelect: setSelectedElement,
    onDesignChange: ({ binding, patch }: { binding: DesignBinding; patch: ElementDesign }) => {
      if (binding.elementPath === undefined) return
      const key = designBindingKey(binding)
      setDesignByElementPath((current) => {
        setDesignHistory((history) => [...history.slice(-19), current])
        return { ...current, [key]: { ...current[key], ...patch } }
      })
    },
    onProposeSemanticEdit: setProposal,
    onAction: ({ outcome }: { outcome: { targetScreenKey: string } }) => setSelectedId(outcome.targetScreenKey),
  }), [dimensions, mode, sampleVariant, selectedElement, designByElementPath, selectedSampleIdByModel, experienceValues])
  const prototypeForNode = useCallback((node: FlowNode) => ({ ...prototype, sourceHash: `${node.screen.path}:${data.documentsByPath.get(node.screen.path)?.updated_at ?? 'unknown'}`, outcomesByElementId: screenOutcomes[node.id] }), [prototype, data.documentsByPath, screenOutcomes])

  return (
    <BoardGate
      projectId={projectId}
      data={data}
      isEmpty={graph.nodes.length === 0}
      emptyTitle="선언된 화면이 없습니다"
      emptyDescription="문서에 화면을 선언하면 이곳에 나타나고, 머리말의 `화면:` 으로 레이아웃을 선언하면 그 화면이 그려집니다."
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-[0.14em] text-text-subtle">SCREEN FLOW</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-text">화면 흐름</h1>
            <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-text-muted">
              선언된 레이아웃을 그대로 그리고, 선언된 경로를 화살표로 이었습니다. 레이아웃이
              없는 화면은 빈 상자로 둡니다.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-text-subtle">
              <div>
                <dt className="sr-only">화면</dt>
                <dd>
                  <span className="font-mono text-text">{graph.nodes.length}</span> 화면
                </dd>
              </div>
              <div>
                <dt className="sr-only">레이아웃</dt>
                <dd>
                  <span className="font-mono text-text">{withLayout}</span> 레이아웃
                </dd>
              </div>
              <div>
                <dt className="sr-only">경로</dt>
                <dd>
                  <span className="font-mono text-text">{graph.edges.length}</span> 경로
                </dd>
              </div>
            </dl>
            <div
              role="group"
              aria-label="목업 폭"
              className="flex shrink-0 gap-1 rounded-control border p-0.5"
            >
              {VIEWPORTS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={viewport === entry.id}
                  onClick={() => { setViewport(entry.id); setDimensions(DEFAULT_VIEWPORT_DIMENSIONS[entry.id]) }}
                  className={cn(
                    'rounded-control px-2.5 py-1 text-xs font-medium transition-colors duration-200 ease-out-expo',
                    viewport === entry.id
                      ? 'bg-accent-subtle text-text'
                      : 'text-text-muted hover:text-text',
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-control border bg-surface-raised/40 p-2 text-xs">
          <label>화면 <select aria-label="화면 찾기" value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)} className="max-w-48 rounded border bg-surface px-2 py-1">{graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.screen.name}</option>)}</select></label>
          <label>모드 <select value={mode} onChange={(event) => setMode(event.target.value as PrototypeMode)} className="rounded border bg-surface px-2 py-1"><option value="edit">편집</option><option value="experience">체험</option></select></label>
          <label>샘플 <select value={sampleVariant} onChange={(event) => setSampleVariant(event.target.value as SampleVariant)} className="rounded border bg-surface px-2 py-1"><option value="normal">정상</option><option value="empty">빈 상태</option><option value="long">긴 문구</option><option value="many">많은 데이터</option></select></label>
          <label>너비 <input aria-label="화면 너비" type="number" min={240} max={1920} value={dimensions.width} onChange={(event) => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) setDimensions((value) => ({ ...value, width: Math.min(1920, Math.max(240, next)) })) }} className="w-20 rounded border bg-surface px-2 py-1" /></label>
          <label>높이 <input aria-label="화면 높이" type="number" min={320} max={2000} value={dimensions.height} onChange={(event) => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) setDimensions((value) => ({ ...value, height: Math.min(2000, Math.max(320, next)) })) }} className="w-20 rounded border bg-surface px-2 py-1" /></label>
          {mode === 'edit' ? <button type="button" className="rounded border px-2 py-1" onClick={() => setProposal({ kind: 'add-element', screenKey: selected?.id ?? '' })}>요소 추가 제안</button> : null}
          {mode === 'edit' ? <button type="button" disabled={designHistory.length === 0} className="rounded border px-2 py-1 disabled:opacity-40" onClick={() => { const previous = designHistory.at(-1); if (previous === undefined) return; setDesignByElementPath(previous); setDesignHistory((history) => history.slice(0, -1)) }}>배치 실행 취소</button> : null}
          {mode === 'edit' && selectedElement?.elementId !== undefined ? <><span className="text-text-muted">출발: {selectedElement.elementId}</span><label>도착 <select aria-label="연결 도착 화면" value={connectionTarget} onChange={(event) => setConnectionTarget(event.target.value)} className="rounded border bg-surface px-2 py-1"><option value="">화면 선택</option>{graph.nodes.filter((node) => node.id !== selectedElement.screenKey).map((node) => <option key={node.id} value={node.id}>{node.screen.name}</option>)}</select></label><button type="button" disabled={connectionTarget === ''} className="rounded border px-2 py-1 disabled:opacity-40" onClick={() => setProposal({ kind: 'connect', sourceScreenKey: selectedElement.screenKey, sourceElementId: selectedElement.elementId!, targetScreenKey: connectionTarget })}>연결 요청</button></> : null}
          {mode === 'edit' ? <button type="button" className="ml-auto rounded border px-2 py-1" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen((open) => !open)}>{inspectorOpen ? '원문 닫기' : '원문 열기'}</button> : null}
        </div>
        {selectedElement?.elementId === undefined && selectedElement !== null ? <p className="mt-2 text-xs text-diagnostic-warning">명세가 바뀌면 이 요소의 배치를 다시 확인해야 합니다.</p> : null}
        {proposal === null ? null : <p className="mt-2 rounded-control border border-diagnostic-warning/40 px-3 py-2 text-xs">{proposal.kind === 'add-element' ? `${proposal.screenKey}에 요소 추가 요청` : proposal.kind === 'delete-element' ? `${proposal.binding.elementId ?? '선택한 요소'} 삭제 요청` : `${proposal.sourceScreenKey}에서 ${proposal.targetScreenKey}(으)로 연결 요청`} · 원문 변경안과 컴파일 결과를 검토하기 전에는 적용되지 않습니다.</p>}

        {graph.danglingPaths.length === 0 ? null : (
          <p className="mt-3 rounded-control border border-diagnostic-warning/40 bg-diagnostic-warning/5 px-3 py-2 text-xs text-text-muted">
            끝점을 찾지 못한 경로 {graph.danglingPaths.length}건은 그리지 않았습니다. 문서 편집
            화면에서 컴파일러 진단을 확인하세요.
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col pt-4 md:flex-row md:gap-4">
          <FlowBoard
            graph={graph}
            viewport={viewport}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            prototype={prototype}
            prototypeForNode={prototypeForNode}
            editable={mode === 'edit'}
            onPositionChange={(screenKey, position) => setPositions((current) => ({ ...current, [screenKey]: position }))}
          />
          {mode === 'edit' && inspectorOpen ? <SelectedSource projectId={projectId} data={data} node={selected} /> : null}
        </div>
      </div>
    </BoardGate>
  )
}

function SelectedSource({
  projectId,
  data,
  node,
}: {
  projectId: string
  data: ReturnType<typeof useBoardData>
  node: FlowNode | null
}) {
  if (node === null) {
    return (
      <SourcePanel
        projectId={projectId}
        documentId={null}
        documentTitle={null}
        path={null}
        span={null}
        title="선택한 것이 없습니다"
        subtitle={null}
        emptyMessage="화면을 고르면 그 선언의 원문을 봅니다."
      />
    )
  }

  const document = data.documentsByPath.get(node.screen.path)

  return (
    <SourcePanel
      projectId={projectId}
      documentId={document?.id ?? null}
      documentTitle={document?.title ?? null}
      path={node.screen.path}
      span={screenSourceSpan(node.screen)}
      title={node.screen.name}
      subtitle={node.screen.id}
      emptyMessage="원문을 찾지 못했습니다."
    />
  )
}
