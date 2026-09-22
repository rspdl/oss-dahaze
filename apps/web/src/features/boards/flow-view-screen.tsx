'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@dahaze/ui'
import { useGetDocument, useGetPlanningState, usePatchPlanningMetadata, type DocumentResponse, type PlanningStateResponse } from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'

import { RequireSession } from '@/features/auth/require-session'
import { DEFAULT_VIEWPORT_DIMENSIONS, type MockupViewport } from '@/features/mockup/screen-mockup'
import { parseModelSamples } from '@/features/mockup/sample-data'
import { designBindingKey, type DesignBinding, type ElementDesign, type ElementSelection, type PrototypeMode, type SampleVariant, type SemanticProposal } from '@/features/mockup/prototype-contract'
import { parsePlanningEnvironments, visibleScreenKeys } from '@/features/planning/environments'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { errorMessage } from '@/shared/api/errors'
import { buildReadableSpecification } from '@/features/specification/readable-specification'
import { ReadableSpecificationPanel } from '@/features/specification/readable-specification-panel'
import { screenSourceSpan } from './board-ir'
import { BoardGate } from './board-gate'
import { FlowBoard } from './flow-board'
import { buildFlowGraph, outcomesByScreen, type FlowNode } from './flow-graph'
import { SourcePanel } from './source-panel'
import { useBoardData } from './use-board-data'
import { acknowledgeDesign, createDesignEditorState, designMetadataPatch, editDesign, reconcileServerDesign, restoreDesignDraft, serializeDesignDraft, undoDesign } from './design-state'
import { PlanningEditPanel } from './planning-edit-panel'

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
  const planning = useGetPlanningState<PlanningStateResponse>(projectId)
  const patchMetadata = usePatchPlanningMetadata()
  const queryClient = useQueryClient()
  /* 뷰포트는 아직 화면 안의 상태다. 프로젝트마다 고르는 설정으로 서버에 올리는 것은
     다음 슬라이스의 일이다 (RFC-0001 저장하는 것). */
  const [viewport, setViewport] = useState<MockupViewport>('desktop')
  const [dimensions, setDimensions] = useState(DEFAULT_VIEWPORT_DIMENSIONS.desktop)
  const [mode, setMode] = useState<PrototypeMode>('edit')
  const [sampleVariant, setSampleVariant] = useState<SampleVariant>('normal')
  const [selectedElement, setSelectedElement] = useState<ElementSelection | null>(null)
  const [proposal, setProposal] = useState<SemanticProposal | null>(null)
  const [selectedSampleIdByModel, setSelectedSampleIdByModel] = useState<Record<string, string>>({})
  const [experienceValues, setExperienceValues] = useState<Record<string, string | boolean>>({})
  const [prototypeHydrated, setPrototypeHydrated] = useState(false)
  const [connectionTarget, setConnectionTarget] = useState('')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`dahaze:prototype:${projectId}`)
      if (raw === null) return
      const saved = JSON.parse(raw) as { selectedSampleIdByModel?: unknown; experienceValues?: unknown }
      queueMicrotask(() => {
        if (typeof saved.selectedSampleIdByModel === 'object' && saved.selectedSampleIdByModel !== null) setSelectedSampleIdByModel(saved.selectedSampleIdByModel as Record<string, string>)
        if (typeof saved.experienceValues === 'object' && saved.experienceValues !== null) setExperienceValues(saved.experienceValues as Record<string, string | boolean>)
        setPrototypeHydrated(true)
      })
    } catch { sessionStorage.removeItem(`dahaze:prototype:${projectId}`) }
    if (sessionStorage.getItem(`dahaze:prototype:${projectId}`) === null) queueMicrotask(() => setPrototypeHydrated(true))
  }, [projectId])
  useEffect(() => { if (prototypeHydrated) sessionStorage.setItem(`dahaze:prototype:${projectId}`, JSON.stringify({ selectedSampleIdByModel, experienceValues })) }, [experienceValues, projectId, prototypeHydrated, selectedSampleIdByModel])
  const environments = useMemo(() => parsePlanningEnvironments(planning.data?.metadata.environments), [planning.data?.metadata.environments])
  const samples = useMemo(() => parseModelSamples(planning.data?.metadata.sample_data), [planning.data?.metadata.sample_data])
  const [environmentId, setEnvironmentId] = useState<string>('all')
  const environment = environments.find((entry) => entry.id === environmentId)
  const designScope = environmentId === 'all' ? 'all' : environmentId
  const persistedDesign = useMemo(() => parseDesign(planning.data?.metadata.design, designScope), [planning.data?.metadata.design, designScope])
  const environmentScreenKeys = useMemo(() => visibleScreenKeys(environment), [environment])
  const [designEditor, setDesignEditor] = useState(() => createDesignEditorState('all', { elements: {}, positions: {} }))
  const [designDraftHydratedScope, setDesignDraftHydratedScope] = useState<string | null>(null)
  const editorRef = useRef(designEditor)
  const rawDesignRef = useRef(planning.data?.metadata.design)
  const planningRevisionRef = useRef(planning.data?.revision ?? 0)
  const acceptedMetadataRevisionRef = useRef(planning.data?.metadata_revision ?? 0)
  const acceptedPlanningRef = useRef<PlanningStateResponse | undefined>(planning.data)
  const saveInFlight = useRef(false)
  const saveDesignRef = useRef<() => Promise<void>>(async () => {})
  const hydratedDesignScopesRef = useRef(new Set<string>())
  useEffect(() => { editorRef.current = designEditor }, [designEditor])
  useEffect(() => {
    const server = planning.data
    if (server === undefined) return
    if (server.revision < planningRevisionRef.current && acceptedPlanningRef.current !== undefined) {
      queryClient.setQueryData(planning.queryKey, acceptedPlanningRef.current)
      return
    }
    planningRevisionRef.current = server.revision
    if (server.metadata_revision === acceptedMetadataRevisionRef.current && editorRef.current.scope === designScope) { acceptedPlanningRef.current = server; return }
    const reconciliation = reconcileServerDesign(editorRef.current, designScope, { elements: persistedDesign.elements, positions: persistedDesign.positions }, server.metadata_revision)
    setDesignEditor(reconciliation.state)
    editorRef.current = reconciliation.state
    if (reconciliation.accepted) {
      rawDesignRef.current = server.metadata.design
      acceptedMetadataRevisionRef.current = server.metadata_revision
      acceptedPlanningRef.current = server
    }
  }, [designScope, persistedDesign.elements, persistedDesign.positions, planning.data, planning.queryKey, queryClient])
  const saveDesign = useCallback(async () => {
    const current = editorRef.current
    if (planning.data === undefined || current.generation <= current.acknowledgedGeneration || current.status === 'conflict' || saveInFlight.current) return
    saveInFlight.current = true
    const generation = current.generation
    const scope = current.scope
    const snapshot = current.working
    setDesignEditor((state) => ({ ...state, status: 'saving', error: null }))
    try {
      const result = await patchMetadata.mutateAsync({ projectId, data: { expected_revision: planningRevisionRef.current, design: designMetadataPatch(rawDesignRef.current, scope, snapshot), summary: `배치 자동 저장: ${environments.find((entry) => entry.id === scope)?.name ?? '전체'}` } })
      planningRevisionRef.current = result.revision
      rawDesignRef.current = result.metadata.design
      acceptedMetadataRevisionRef.current = result.metadata_revision
      queryClient.setQueryData<PlanningStateResponse>(planning.queryKey, (state) => {
        if (state === undefined) return state
        const next = { ...state, revision: result.revision, metadata_revision: result.metadata_revision, metadata: result.metadata }
        acceptedPlanningRef.current = next
        return next
      })
      setDesignEditor((state) => state.scope === scope ? acknowledgeDesign(state, generation, snapshot, result.metadata_revision) : state)
    } catch (error) {
      const message = errorMessage(error)
      setDesignEditor((state) => ({ ...state, status: 'error', error: message }))
      await queryClient.invalidateQueries({ queryKey: planning.queryKey })
    } finally {
      saveInFlight.current = false
    }
  }, [environments, patchMetadata, planning.data, planning.queryKey, projectId, queryClient])
  useEffect(() => { saveDesignRef.current = saveDesign }, [saveDesign])
  useEffect(() => {
    if (designEditor.status !== 'pending') return
    const timer = window.setTimeout(() => { void saveDesign() }, 700)
    return () => window.clearTimeout(timer)
  }, [designEditor.generation, designEditor.status, saveDesign])
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => { if (editorRef.current.generation <= editorRef.current.acknowledgedGeneration) return; event.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => { window.removeEventListener('beforeunload', onBeforeUnload); if (editorRef.current.generation > editorRef.current.acknowledgedGeneration) void saveDesignRef.current() }
  }, [])
  useEffect(() => {
    if (hydratedDesignScopesRef.current.has(designScope)) { setDesignDraftHydratedScope(designScope); return }
    const storageKey = `dahaze:design-draft:${projectId}:${designScope}`
    const cached = restoreDesignDraft(sessionStorage.getItem(storageKey), designScope)
    if (cached !== null) {
      const reconciled = reconcileServerDesign(cached, designScope, { elements: persistedDesign.elements, positions: persistedDesign.positions }, planning.data?.metadata_revision ?? cached.metadataRevision)
      queueMicrotask(() => { setDesignEditor(reconciled.state); editorRef.current = reconciled.state })
    }
    hydratedDesignScopesRef.current.add(designScope)
    queueMicrotask(() => setDesignDraftHydratedScope(designScope))
  }, [designScope, persistedDesign.elements, persistedDesign.positions, planning.data?.metadata_revision, projectId])
  useEffect(() => {
    if (designDraftHydratedScope !== designEditor.scope) return
    const storageKey = `dahaze:design-draft:${projectId}:${designEditor.scope}`
    const serialized = serializeDesignDraft(designEditor)
    if (serialized === null) sessionStorage.removeItem(storageKey)
    else sessionStorage.setItem(storageKey, serialized)
  }, [designDraftHydratedScope, designEditor, projectId])
  const designDirty = designEditor.generation > designEditor.acknowledgedGeneration
  const effectivePositions = designEditor.working.positions
  const effectiveDesign = designEditor.working.elements
  const graph = useMemo(
    () => buildFlowGraph(data.board, data.mockups.screens, viewport, { positions: effectivePositions, nodeWidth: dimensions.width, visibleScreenKeys: environmentScreenKeys }),
    [data.board, data.mockups.screens, viewport, effectivePositions, dimensions.width, environmentScreenKeys],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected: FlowNode | null =
    graph.nodes.find((node) => node.id === selectedId) ?? graph.nodes[0] ?? null
  const proposalScreenKey = proposal === null ? selected?.id : proposal.kind === 'add-element' ? proposal.screenKey : proposal.kind === 'connect' ? proposal.sourceScreenKey : proposal.binding.screenKey
  const proposalNode = graph.nodes.find((node) => node.id === proposalScreenKey)
  const proposalDocumentRef = proposalNode === undefined ? undefined : data.documentsByPath.get(proposalNode.screen.path)
  const proposalDocument = useGetDocument<DocumentResponse>(proposalDocumentRef?.id ?? '', { query: { enabled: proposalDocumentRef !== undefined } })
  const specification = useMemo(() => buildReadableSpecification(data.compilation.data, { documents: proposalDocument.data === undefined ? [] : [proposalDocument.data], planningState: planning.data }), [data.compilation.data, planning.data, proposalDocument.data])

  const withLayout = graph.nodes.filter((node) => node.mockup !== null).length
  const screenOutcomes = useMemo(() => outcomesByScreen(graph), [graph])
  const prototype = useMemo(() => ({
    dimensions,
    mode,
    sampleVariant,
    samples,
    selectedElementPath: selectedElement?.elementPath ?? null,
    selectedElementScreenKey: selectedElement?.screenKey ?? null,
    designByElementPath: effectiveDesign,
    selectedSampleIdByModel,
    values: experienceValues,
    onValueChange: (fieldId: string, value: string | boolean) => setExperienceValues((current) => ({ ...current, [fieldId]: value })),
    onSampleSelect: (modelId: string, recordId: string) => setSelectedSampleIdByModel((current) => ({ ...current, [modelId]: recordId })),
    onElementSelect: setSelectedElement,
    onDesignChange: ({ binding, patch }: { binding: DesignBinding; patch: ElementDesign }) => {
      if (binding.elementPath === undefined) return
      const key = designBindingKey(binding)
      setDesignEditor((state) => editDesign(state, (scope) => ({ ...scope, elements: { ...scope.elements, [key]: { ...scope.elements[key], ...patch } } })))
    },
    onProposeSemanticEdit: setProposal,
    onAction: ({ outcome }: { outcome: { targetScreenKey: string } }) => setSelectedId(outcome.targetScreenKey),
  }), [dimensions, mode, sampleVariant, samples, selectedElement, effectiveDesign, selectedSampleIdByModel, experienceValues])
  const prototypeForNode = useCallback((node: FlowNode) => ({ ...prototype, sourceHash: planning.data?.source_hash ?? 'unversioned', outcomesByElementId: screenOutcomes[node.id] }), [prototype, planning.data?.source_hash, screenOutcomes])

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
          {environments.length > 0 ? <label>환경 <select value={environmentId} disabled={designDirty} title={designDirty ? '현재 환경의 배치 저장이 끝난 뒤 환경을 바꿀 수 있습니다.' : undefined} onChange={(event) => { const id = event.target.value; setEnvironmentId(id); const next = environments.find((entry) => entry.id === id); if (next) setDimensions({ width: next.width, height: next.height }) }} className="rounded border bg-surface px-2 py-1 disabled:opacity-50"><option value="all">전체</option>{environments.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label> : null}
          <label>모드 <select value={mode} onChange={(event) => setMode(event.target.value as PrototypeMode)} className="rounded border bg-surface px-2 py-1"><option value="edit">편집</option><option value="experience">체험</option></select></label>
          <label>샘플 <select value={sampleVariant} onChange={(event) => setSampleVariant(event.target.value as SampleVariant)} className="rounded border bg-surface px-2 py-1"><option value="normal">정상</option><option value="empty">빈 상태</option><option value="long">긴 문구</option><option value="many">많은 데이터</option></select></label>
          <label>너비 (CSS px) <input aria-label="화면 너비" type="number" min={240} max={7680} value={dimensions.width} onChange={(event) => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) setDimensions((value) => ({ ...value, width: Math.min(7680, Math.max(240, next)) })) }} className="w-24 rounded border bg-surface px-2 py-1" /></label>
          <label>높이 (CSS px) <input aria-label="화면 높이" type="number" min={320} max={4320} value={dimensions.height} onChange={(event) => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) setDimensions((value) => ({ ...value, height: Math.min(4320, Math.max(320, next)) })) }} className="w-24 rounded border bg-surface px-2 py-1" /></label>
          {mode === 'edit' ? <button type="button" className="rounded border px-2 py-1" onClick={() => setProposal({ kind: 'add-element', screenKey: selected?.id ?? '' })}>요소 추가 제안</button> : null}
          {mode === 'edit' && selectedElement !== null ? <button type="button" className="rounded border px-2 py-1" onClick={() => setProposal({ kind: 'update-element', binding: selectedElement })}>요소 내용 변경</button> : null}
          {mode === 'edit' && selectedElement !== null ? <button type="button" className="rounded border px-2 py-1" onClick={() => setProposal({ kind: 'move-element', binding: selectedElement })}>요소 이동</button> : null}
          {mode === 'edit' ? <button type="button" disabled={designEditor.history.length === 0} className="rounded border px-2 py-1 disabled:opacity-40" onClick={() => setDesignEditor(undoDesign)}>배치 실행 취소</button> : null}
          {mode === 'edit' ? <button type="button" disabled={!designDirty || designEditor.status === 'saving' || designEditor.status === 'conflict'} className="rounded border px-2 py-1 disabled:opacity-40" onClick={() => void saveDesign()}>{designEditor.status === 'saving' ? '자동 저장 중' : designDirty ? '지금 저장' : '자동 저장됨'}</button> : null}
          {mode === 'edit' && selectedElement?.elementId !== undefined ? <><span className="text-text-muted">출발: {selectedElement.elementId}</span><label>도착 <select aria-label="연결 도착 화면" value={connectionTarget} onChange={(event) => setConnectionTarget(event.target.value)} className="rounded border bg-surface px-2 py-1"><option value="">화면 선택</option>{graph.nodes.filter((node) => node.id !== selectedElement.screenKey).map((node) => <option key={node.id} value={node.id}>{node.screen.name}</option>)}</select></label><button type="button" disabled={connectionTarget === ''} className="rounded border px-2 py-1 disabled:opacity-40" onClick={() => setProposal({ kind: 'connect', sourceScreenKey: selectedElement.screenKey, sourceElementId: selectedElement.elementId!, targetScreenKey: connectionTarget })}>연결 요청</button></> : null}
          {mode === 'edit' ? <button type="button" className="ml-auto rounded border px-2 py-1" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen((open) => !open)}>{inspectorOpen ? '원문 닫기' : '원문 열기'}</button> : null}
        </div>
        {selectedElement?.elementId === undefined && selectedElement !== null ? <p className="mt-2 text-xs text-diagnostic-warning">명세가 바뀌면 이 요소의 배치를 다시 확인해야 합니다.</p> : null}
        {designEditor.status === 'error' ? <div className="mt-2 flex items-center gap-2 rounded-control border border-diagnostic-error/40 bg-diagnostic-error-subtle px-3 py-2 text-xs"><p className="flex-1">배치 자동 저장 실패 · {designEditor.error}</p><button type="button" className="rounded border px-2 py-1" onClick={() => setDesignEditor((state) => ({ ...state, status: 'pending', error: null }))}>다시 시도</button></div> : null}
        {designEditor.status === 'conflict' ? <div className="mt-2 flex items-center gap-2 rounded-control border border-diagnostic-warning/40 bg-diagnostic-warning/5 px-3 py-2 text-xs"><p className="flex-1">{designEditor.error} 현재 편집 내용은 보존했습니다.</p><button type="button" className="rounded border px-2 py-1" onClick={() => { const reset = createDesignEditorState(designScope, { elements: persistedDesign.elements, positions: persistedDesign.positions }, planning.data?.metadata_revision ?? designEditor.metadataRevision); setDesignEditor(reset); editorRef.current = reset; rawDesignRef.current = planning.data?.metadata.design; acceptedMetadataRevisionRef.current = planning.data?.metadata_revision ?? acceptedMetadataRevisionRef.current }}>서버 배치로 다시 불러오기</button></div> : null}
        {proposal === null || planning.data === undefined ? null : <PlanningEditPanel key={proposalKey(proposal)} projectId={projectId} projectRevision={planning.data.project_revision} projectSourceHash={planning.data.source_hash} proposal={proposal} graph={graph} document={proposalDocument.data} onClose={() => setProposal(null)} />}

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
            onPositionChange={(screenKey, position) => setDesignEditor((state) => editDesign(state, (scope) => ({ ...scope, positions: { ...scope.positions, [screenKey]: position } })))}
          />
          {mode === 'edit' && inspectorOpen ? <div className="min-h-0 w-full overflow-y-auto border-t bg-surface-raised/35 md:w-[26rem] md:shrink-0 md:border-t-0 md:border-l"><ReadableSpecificationPanel specification={specification} screenKey={selected?.screen.key} elementId={selectedElement?.elementId} elementPath={selectedElement?.elementPath} className="p-4" /><details className="border-t" open><summary className="cursor-pointer px-4 py-3 text-xs font-semibold">원문 위치</summary><SelectedSource projectId={projectId} data={data} node={selected} /></details></div> : null}
        </div>
      </div>
    </BoardGate>
  )
}

function parseDesign(value: PlanningStateResponse['metadata']['design'], scope: string): { raw: Record<string, unknown>; elements: Record<string, ElementDesign>; positions: Record<string, { x: number; y: number }> } { const raw = typeof value === 'object' && value !== null ? value : {}; const scopes = typeof raw.environments === 'object' && raw.environments !== null ? raw.environments as Record<string, unknown> : {}; const selected = typeof scopes[scope] === 'object' && scopes[scope] !== null ? scopes[scope] as Record<string, unknown> : {}; const elements = typeof selected.elements === 'object' && selected.elements !== null ? selected.elements as Record<string, ElementDesign> : {}; const positions = typeof selected.positions === 'object' && selected.positions !== null ? selected.positions as Record<string, { x: number; y: number }> : {}; return { raw, elements, positions } }
function proposalKey(proposal: SemanticProposal): string { return proposal.kind === 'add-element' ? `${proposal.kind}:${proposal.screenKey}` : proposal.kind === 'connect' ? `${proposal.kind}:${proposal.sourceScreenKey}:${proposal.sourceElementId}:${proposal.targetScreenKey}` : `${proposal.kind}:${proposal.binding.screenKey}:${proposal.binding.elementId ?? proposal.binding.elementPath ?? ''}` }

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
