'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { cn } from '@dahaze/ui'
import { useGetDocument, useGetPlanningState, usePatchPlanningMetadata, type DocumentResponse, type PlanningStateResponse } from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'

import { RequireSession } from '@/features/auth/require-session'
import { DEFAULT_VIEWPORT_DIMENSIONS, type MockupViewport } from '@/features/mockup/screen-mockup'
import { parseLayouts, type GroupNode, type LayoutNode } from '@/features/mockup/layout-tree'
import { parseModelSamples } from '@/features/mockup/sample-data'
import type { PrototypeAction, PrototypeMode, SampleVariant, SemanticProposal } from '@/features/mockup/prototype-contract'
import { parsePlanningEnvironments, visibleScreenKeys } from '@/features/planning/environments'
import { planningSubjectHref } from '@/features/planning/planning-subject'
import type { PlanningSubject } from '@/features/planning/planning-types'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { errorMessage } from '@/shared/api/errors'
import { buildReadableSpecification } from '@/features/specification/readable-specification'
import { ReadableSpecificationPanel } from '@/features/specification/readable-specification-panel'
import { screenSourceSpan } from './board-ir'
import { BoardGate } from './board-gate'
import { FlowBoard, FLOW_CARD_WIDTH, FLOW_CARD_HEIGHT } from './flow-board'
import { buildFlowGraph, type FlowNode } from './flow-graph'
import { SourcePanel } from './source-panel'
import { useBoardData } from './use-board-data'
import { acknowledgeDesign, createDesignEditorState, designMetadataPatch, editDesign, reconcileServerDesign, redoDesign, restoreDesignDraft, serializeDesignDraft, undoDesign } from './design-state'
import { PlanningEditPanel } from './planning-edit-panel'
import { prototypeOutcomesByScreen } from './prototype-outcomes'
import { usePrototypeSession } from './prototype-session'
import { ScreenComposer } from './screen-composer'

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
  const [composingKey, setComposingKey] = useState<string | null>(null)
  const [proposal, setProposal] = useState<SemanticProposal | null>(null)
  const { selectedSampleIdByModel, experienceValues, setSelectedSampleIdByModel, setExperienceValues } = usePrototypeSession(projectId)
  const [activeAction, setActiveAction] = useState<PrototypeAction | null>(null)
  const [selectedOutcomeIdByScreen, setSelectedOutcomeIdByScreen] = useState<Record<string, Record<string, string>>>({})
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const environments = useMemo(() => parsePlanningEnvironments(planning.data?.metadata.environments), [planning.data?.metadata.environments])
  const samples = useMemo(() => parseModelSamples(planning.data?.metadata.sample_data), [planning.data?.metadata.sample_data])
  const [environmentId, setEnvironmentId] = useState<string>('all')
  const environment = environments.find((entry) => entry.id === environmentId)
  const designScope = environmentId === 'all' ? 'all' : environmentId
  const persistedDesign = useMemo(() => parseDesign(planning.data?.metadata.design, designScope), [planning.data?.metadata.design, designScope])
  const environmentScreenKeys = useMemo(() => visibleScreenKeys(environment), [environment])
  const [designEditor, setDesignEditor] = useState(() => createDesignEditorState('all', { layouts: {}, positions: {} }))
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
    const reconciliation = reconcileServerDesign(editorRef.current, designScope, { layouts: persistedDesign.layouts, positions: persistedDesign.positions }, server.metadata_revision)
    setDesignEditor(reconciliation.state)
    editorRef.current = reconciliation.state
    if (reconciliation.accepted) {
      rawDesignRef.current = server.metadata.design
      acceptedMetadataRevisionRef.current = server.metadata_revision
      acceptedPlanningRef.current = server
    }
  }, [designScope, persistedDesign.layouts, persistedDesign.positions, planning.data, planning.queryKey, queryClient])
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
      const reconciled = reconcileServerDesign(cached, designScope, { layouts: persistedDesign.layouts, positions: persistedDesign.positions }, planning.data?.metadata_revision ?? cached.metadataRevision)
      queueMicrotask(() => { setDesignEditor(reconciled.state); editorRef.current = reconciled.state })
    }
    hydratedDesignScopesRef.current.add(designScope)
    queueMicrotask(() => setDesignDraftHydratedScope(designScope))
  }, [designScope, persistedDesign.layouts, persistedDesign.positions, planning.data?.metadata_revision, projectId])
  useEffect(() => {
    if (designDraftHydratedScope !== designEditor.scope) return
    const storageKey = `dahaze:design-draft:${projectId}:${designEditor.scope}`
    const serialized = serializeDesignDraft(designEditor)
    if (serialized === null) sessionStorage.removeItem(storageKey)
    else sessionStorage.setItem(storageKey, serialized)
  }, [designDraftHydratedScope, designEditor, projectId])
  const designDirty = designEditor.generation > designEditor.acknowledgedGeneration
  const effectivePositions = designEditor.working.positions
  const effectiveLayouts = designEditor.working.layouts
  const graph = useMemo(
    () => buildFlowGraph(data.board, data.mockups.screens, viewport, { positions: effectivePositions, nodeWidth: FLOW_CARD_WIDTH, nodeHeight: FLOW_CARD_HEIGHT, visibleScreenKeys: environmentScreenKeys }),
    [data.board, data.mockups.screens, viewport, effectivePositions, environmentScreenKeys],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectScreen = useCallback((screenKey: string | null) => { setActiveAction(null); setSelectedId(screenKey); if (screenKey !== null) setInspectorOpen(true) }, [])

  const selected: FlowNode | null =
    graph.nodes.find((node) => node.id === selectedId) ?? null
  const proposalScreenKey = proposal === null ? selected?.id : proposal.kind === 'add-element' ? proposal.screenKey : proposal.kind === 'connect' || proposal.kind === 'disconnect' ? proposal.sourceScreenKey : proposal.binding.screenKey
  const proposalNode = graph.nodes.find((node) => node.id === proposalScreenKey)
  const proposalDocumentRef = proposalNode === undefined ? undefined : data.documentsByPath.get(proposalNode.screen.path)
  const proposalDocument = useGetDocument<DocumentResponse>(proposalDocumentRef?.id ?? '', { query: { enabled: proposalDocumentRef !== undefined } })
  const specification = useMemo(() => buildReadableSpecification(data.compilation.data, { documents: proposalDocument.data === undefined ? [] : [proposalDocument.data], planningState: planning.data }), [data.compilation.data, planning.data, proposalDocument.data])

  const screenOutcomes = useMemo(() => prototypeOutcomesByScreen(specification), [specification])
  const prototype = useMemo(() => ({
    dimensions,
    mode,
    sampleVariant,
    samples,
    selectedSampleIdByModel,
    values: experienceValues,
    onValueChange: (fieldId: string, value: string | boolean) => setExperienceValues((current) => ({ ...current, [fieldId]: value })),
    onSampleSelect: (modelId: string, recordId: string) => setSelectedSampleIdByModel((current) => ({ ...current, [modelId]: recordId })),
    onAction: (action: PrototypeAction) => {
      const { outcome } = action
      if (outcome.targetScreenKey !== null && outcome.targetScreenKey !== undefined && graph.nodes.some((node) => node.id === outcome.targetScreenKey)) {
        selectScreen(outcome.targetScreenKey)
        return
      }
      setActiveAction(outcome.handler === null || outcome.handler === undefined ? null : action)
    },
  }), [dimensions, mode, sampleVariant, samples, selectedSampleIdByModel, experienceValues, setExperienceValues, setSelectedSampleIdByModel, graph.nodes, selectScreen])
  const prototypeForNode = useCallback((node: FlowNode) => ({
    ...prototype,
    layout: effectiveLayouts[node.id],
    outcomesByElementId: screenOutcomes[node.id],
    selectedOutcomeIdByElementId: selectedOutcomeIdByScreen[node.id],
    activeOutcome: activeAction?.screenKey === node.id ? activeAction.outcome : null,
    onOutcomeSelect: (elementId: string, outcomeId: string) => {
      setActiveAction(null)
      setSelectedOutcomeIdByScreen((current) => ({ ...current, [node.id]: { ...current[node.id], [elementId]: outcomeId } }))
    },
    onOutcomeDismiss: () => setActiveAction(null),
  }), [activeAction, effectiveLayouts, prototype, screenOutcomes, selectedOutcomeIdByScreen])
  const environmentHasNoScreens = data.board.screens.length > 0 && graph.nodes.length === 0
  const isViewportPresetSelected = (candidate: MockupViewport) =>
    dimensions.width === DEFAULT_VIEWPORT_DIMENSIONS[candidate].width
    && dimensions.height === DEFAULT_VIEWPORT_DIMENSIONS[candidate].height
  const interviewSubject: PlanningSubject | null = selected === null ? null : { kind: 'screen', id: selected.screen.id, stableId: selected.screen.id, sourcePath: selected.screen.path, label: selected.screen.name }
  const saveLabel = designEditor.status === 'saving' ? '저장 중' : designDirty ? '저장 대기' : '저장됨'
  // ReactFlow 는 nodes 가 바뀔 때마다 내부 상태를 다시 맞춘다. 보드에 주는 콜백은 렌더마다 새로 만들지 않는다.
  const moveScreen = useCallback((screenKey: string, position: { x: number; y: number }) => setDesignEditor((state) => editDesign(state, (scope) => ({ ...scope, positions: { ...scope.positions, [screenKey]: position } }))), [])
  const openComposer = useCallback((screenKey: string) => { selectScreen(screenKey); setMode('edit'); setComposingKey(screenKey) }, [selectScreen])
  const composing = composingKey === null ? undefined : graph.nodes.find((node) => node.id === composingKey)
  const proposalPanel = proposal === null || planning.data === undefined ? null : <PlanningEditPanel key={proposalKey(proposal)} projectId={projectId} projectRevision={planning.data.project_revision} projectSourceHash={planning.data.source_hash} proposal={proposal} graph={graph} document={proposalDocument.data} onClose={() => setProposal(null)} />

  return (
    <BoardGate
      projectId={projectId}
      data={data}
      isEmpty={data.board.screens.length === 0}
      emptyTitle="선언된 화면이 없습니다"
      emptyDescription="문서에 화면을 선언하면 이곳에 나타나고, 머리말의 `화면:` 으로 레이아웃을 선언하면 그 화면이 그려집니다."
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b pb-3">
          <h1 className="text-lg font-semibold">화면 흐름</h1>
          <span className="mr-auto text-xs text-text-subtle">{graph.nodes.length} 화면 · {graph.edges.length} 연결</span>
          {environments.length > 0 ? <select aria-label="보드 환경" value={environmentId} disabled={designDirty} title={designDirty ? '저장이 끝나면 바꿀 수 있습니다' : undefined} className="rounded-lg border bg-surface px-2 py-1.5 text-xs disabled:opacity-40" onChange={(event) => {
            const id = event.target.value
            setEnvironmentId(id); selectScreen(null); setProposal(null)
            const next = environments.find((environment) => environment.id === id)
            setDimensions(next === undefined ? DEFAULT_VIEWPORT_DIMENSIONS[viewport] : { width: next.width, height: next.height })
          }}>{[{ id: 'all', name: '전체 화면' }, ...environments].map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select> : null}
          <div role="group" aria-label="보드 모드" className="flex gap-0.5 rounded-lg border bg-surface p-0.5">
            <button type="button" aria-pressed={mode === 'edit'} className="rounded-md px-3 py-1 text-xs aria-pressed:bg-surface-raised aria-pressed:font-medium aria-pressed:text-text" onClick={() => { setMode('edit'); setActiveAction(null) }}>편집</button>
            <button type="button" disabled={selected === null} aria-pressed={mode === 'experience'} title={selected === null ? '체험할 화면을 먼저 선택하세요' : undefined} className="rounded-md px-3 py-1 text-xs aria-pressed:bg-surface-raised aria-pressed:font-medium aria-pressed:text-text disabled:opacity-40" onClick={() => setMode('experience')}>체험</button>
          </div>
          {designEditor.history.length === 0 ? null : <button type="button" className="rounded-lg border px-2 py-1.5 text-xs" onClick={() => setDesignEditor(undoDesign)}>되돌리기</button>}
          <span aria-live="polite" className="w-14 text-right text-xs text-text-subtle">{saveLabel}</span>
        </header>
        {designEditor.status === 'error' ? <div className="mt-2 flex items-center gap-2 rounded-control border border-diagnostic-error/40 bg-diagnostic-error-subtle px-3 py-2 text-xs"><p className="flex-1">배치 자동 저장 실패 · {designEditor.error}</p><button type="button" className="rounded border px-2 py-1" onClick={() => setDesignEditor((state) => ({ ...state, status: 'pending', error: null }))}>다시 시도</button></div> : null}
        {designEditor.status === 'conflict' ? <div className="mt-2 flex items-center gap-2 rounded-control border border-diagnostic-warning/40 bg-diagnostic-warning/5 px-3 py-2 text-xs"><p className="flex-1">{designEditor.error} 현재 편집 내용은 보존했습니다.</p><button type="button" className="rounded border px-2 py-1" onClick={() => { const reset = createDesignEditorState(designScope, { layouts: persistedDesign.layouts, positions: persistedDesign.positions }, planning.data?.metadata_revision ?? designEditor.metadataRevision); setDesignEditor(reset); editorRef.current = reset; rawDesignRef.current = planning.data?.metadata.design; acceptedMetadataRevisionRef.current = planning.data?.metadata_revision ?? acceptedMetadataRevisionRef.current }}>서버 배치로 다시 불러오기</button></div> : null}
        {composing === undefined ? proposalPanel : null}

        {graph.danglingPaths.length === 0 ? null : (
          <p className="mt-3 rounded-control border border-diagnostic-warning/40 bg-diagnostic-warning/5 px-3 py-2 text-xs text-text-muted">
            끝점을 찾지 못한 경로 {graph.danglingPaths.length}건은 그리지 않았습니다. 문서 편집
            화면에서 컴파일러 진단을 확인하세요.
          </p>
        )}

        <div className="relative flex min-h-0 flex-1 pt-2 xl:gap-3">
          {environmentHasNoScreens ? <section className="flex min-h-48 flex-1 items-center justify-center rounded-lg border bg-surface-raised/30 p-6 text-center"><div><p className="text-sm font-semibold">이 환경에 포함된 화면이 없습니다</p><p className="mt-1 text-xs text-text-muted">위 환경 선택에서 다른 환경이나 전체를 선택할 수 있습니다.</p></div></section> : <FlowBoard
            key={designScope}
            graph={graph}
            viewport={viewport}
            selectedId={selected?.id ?? null}
            onSelect={selectScreen}
            prototype={prototype}
            prototypeForNode={prototypeForNode}
            editable={mode === 'edit'}
            onOpen={openComposer}
            onPositionChange={moveScreen}
          />}
          {inspectorOpen && selected !== null ? <aside aria-label="선택 화면 명세와 배치" className="absolute top-2 right-0 bottom-0 z-10 w-[22rem] max-w-full overflow-y-auto rounded-xl border bg-surface shadow-lg xl:static xl:shrink-0 xl:shadow-none">
            <header className="flex items-center gap-2 border-b p-4"><h2 className="min-w-0 flex-1 text-sm font-semibold">{selected.screen.name}</h2><button type="button" aria-label="명세 패널 닫기" className="text-text-subtle" onClick={() => setInspectorOpen(false)}>×</button></header>
            {mode === 'edit' ? <div className="flex flex-wrap gap-2 border-b px-4 py-3 text-xs">
              <button type="button" disabled={selected.mockup === null} title={selected.mockup === null ? '레이아웃을 선언한 화면만 편집할 수 있습니다' : '더블클릭으로도 열 수 있습니다'} className="rounded bg-text px-3 py-1 font-medium text-surface disabled:opacity-40" onClick={() => openComposer(selected.id)}>화면 편집</button>
              <button type="button" className="rounded border px-2 py-1" onClick={() => setProposal({ kind: 'add-element', screenKey: selected.id })}>요소 추가</button>
              {interviewSubject === null ? null : <Link href={planningSubjectHref(projectId, interviewSubject)} className="rounded border px-2 py-1">AI와 확인</Link>}
            </div> : null}
            <ReadableSpecificationPanel specification={specification} screenKey={selected.screen.key} className="p-4" />
            <details className="border-t"><summary className="cursor-pointer px-4 py-3 text-xs font-semibold">원문 위치</summary><SelectedSource projectId={projectId} data={data} node={selected} /></details>
            <details className="border-t"><summary className="cursor-pointer px-4 py-3 text-xs font-semibold">미리보기 설정</summary><div className="px-4 pb-4"><div className="mt-3 space-y-3 text-xs">
              <div role="group" aria-label="목업 폭" className="flex gap-2">{VIEWPORTS.map((entry) => <button key={entry.id} type="button" aria-pressed={isViewportPresetSelected(entry.id)} className={cn('rounded border px-2 py-1', isViewportPresetSelected(entry.id) && 'bg-surface-raised font-medium')} onClick={() => { setViewport(entry.id); setDimensions(DEFAULT_VIEWPORT_DIMENSIONS[entry.id]) }}>{entry.label}</button>)}</div>
              <div className="grid grid-cols-2 gap-2"><label>너비<input aria-label="화면 너비" type="number" min={240} max={7680} value={dimensions.width} className="mt-1 w-full rounded border bg-surface px-2 py-1" onChange={(event) => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) setDimensions((current) => ({ ...current, width: Math.min(7680, Math.max(240, value)) })) }} /></label><label>높이<input aria-label="화면 높이" type="number" min={320} max={4320} value={dimensions.height} className="mt-1 w-full rounded border bg-surface px-2 py-1" onChange={(event) => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) setDimensions((current) => ({ ...current, height: Math.min(4320, Math.max(320, value)) })) }} /></label></div>
              <div role="group" aria-label="샘플 상황" className="flex flex-wrap gap-1">{([{ id: 'normal', label: '정상' }, { id: 'empty', label: '빈 상태' }, { id: 'long', label: '긴 문구' }, { id: 'many', label: '많은 데이터' }] as const).map((entry) => <button key={entry.id} type="button" aria-pressed={sampleVariant === entry.id} className="rounded border px-2 py-1 aria-pressed:bg-surface-raised" onClick={() => setSampleVariant(entry.id)}>{entry.label}</button>)}</div>
              {mode === 'experience' ? <button type="button" className="rounded border px-2 py-1" onClick={() => { setActiveAction(null); setSelectedOutcomeIdByScreen({}); setSelectedSampleIdByModel({}); setExperienceValues({}) }}>미리보기 초기화</button> : null}
            </div></div></details>
          </aside> : null}
        </div>
      </div>
      {composing === undefined || composing.mockup === null ? null : <div role="dialog" aria-modal="true" aria-label={`${composing.screen.name} 화면 편집`} className="fixed inset-0 z-50 flex flex-col bg-surface">
        <ScreenComposer
          key={`${designScope}:${composing.id}`}
          projectId={projectId}
          screen={composing.mockup}
          sourcePath={composing.screen.path}
          sourceHash={data.documentsByPath.get(composing.screen.path)?.source_hash}
          savedLayout={effectiveLayouts[composing.id]}
          onLayoutChange={(next: GroupNode) => setDesignEditor((state) => editDesign(state, (scope) => ({ ...scope, layouts: { ...scope.layouts, [composing.id]: next as LayoutNode } })))}
          dimensions={dimensions}
          onDimensionsChange={setDimensions}
          samples={samples}
          sampleVariant={sampleVariant}
          specification={specification}
          graph={graph}
          onPropose={setProposal}
          proposalPanel={proposalPanel === null ? null : <div className="border-b px-3 pb-3">{proposalPanel}</div>}
          onClose={() => setComposingKey(null)}
          canUndo={designEditor.history.length > 0}
          canRedo={designEditor.future.length > 0}
          onUndo={() => setDesignEditor(undoDesign)}
          onRedo={() => setDesignEditor(redoDesign)}
          saveLabel={saveLabel}
        />
      </div>}
    </BoardGate>
  )
}

function parseDesign(value: PlanningStateResponse['metadata']['design'], scope: string): { raw: Record<string, unknown>; layouts: Record<string, LayoutNode>; positions: Record<string, { x: number; y: number }> } { const raw = typeof value === 'object' && value !== null ? value : {}; const scopes = typeof raw.environments === 'object' && raw.environments !== null ? raw.environments as Record<string, unknown> : {}; const selected = typeof scopes[scope] === 'object' && scopes[scope] !== null ? scopes[scope] as Record<string, unknown> : {}; const layouts = parseLayouts(selected.layouts); const positions = typeof selected.positions === 'object' && selected.positions !== null ? selected.positions as Record<string, { x: number; y: number }> : {}; return { raw, layouts, positions } }
function proposalKey(proposal: SemanticProposal): string { return proposal.kind === 'add-element' ? `${proposal.kind}:${proposal.screenKey}` : proposal.kind === 'connect' || proposal.kind === 'disconnect' ? `${proposal.kind}:${proposal.sourceScreenKey}:${proposal.sourceElementId}:${proposal.outcomeId ?? ''}:${proposal.targetScreenId ?? proposal.handler?.kind ?? ''}:${proposal.handler?.id ?? ''}` : `${proposal.kind}:${proposal.binding.screenKey}:${proposal.binding.elementId ?? proposal.binding.elementPath ?? ''}` }

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
