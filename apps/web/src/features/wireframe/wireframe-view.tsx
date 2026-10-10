'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  createTreeFile,
  getListTreeChangesQueryKey,
  getListTreeQueryKey,
  getReadTreeFileQueryKey,
  saveTreeFile,
  type TreeFileResponse,
} from '@dahaze/api-client'
import { spanToLineColumn, type ByteSpan } from '@dahaze/rspdl-editor'
import { Button, EmptyState, ErrorState, Skeleton, cn } from '@dahaze/ui'

import { buildAppShell } from '@/features/mockup/app-shell'
import { collectScreenMockups } from '@/features/mockup/screen-layouts'
import { DEFAULT_MOCKUP_DIMENSIONS } from '@/features/mockup/screen-mockup'
import { declaredElements, elementLabel, type GroupNode, type LayoutNode } from '@/features/mockup/layout-tree'
import type { PrototypeAction, PrototypeMode } from '@/features/mockup/prototype-contract'
import { useTreeCompilation } from '@/features/workspace/use-tree-compilation'
import { useWorkspaceStore } from '@/features/workspace/workspace-store'
import { errorDetail, errorMessage } from '@/shared/api/errors'
import { FlowIcon, WarningIcon } from '@/shared/ui/icons'
import { collectBoard, screenSourceSpan } from './board-ir'
import {
  acknowledgeDesign,
  createDesignEditorState,
  editDesign,
  isDirty,
  reconcileServerDesign,
  redoDesign,
  restoreDesignDraft,
  serializeDesignDraft,
  undoDesign,
  type DesignEditorState,
} from './design-state'
import { FlowBoard, FLOW_CARD_HEIGHT, FLOW_CARD_WIDTH } from './flow-board'
import { buildFlowGraph, outcomesByScreen, type FlowNode } from './flow-graph'
import { ScreenComposer } from './screen-composer'
import { isRspdlPath, isWireframePath, parseWireframes, wireframePathFor, wireframeWrites, type WireframeFile } from './wireframe-file'

/**
 * 와이어프레임 뷰: 컴파일한 화면을 회색 목업으로 그리고, 화면 사이 경로를 선으로 잇는다.
 *
 * - 화면 모양은 컴파일러가 준 `screen_layouts` 다. 선언하지 않은 화면은 빈 상자로 둔다.
 * - 보드 위치와 화면 안 배치(Column·Row·Box 트리)는 문서 옆 `<문서>.wireframe.json` 에 저장한다.
 *   편집이 멈추고 잠시 뒤 바뀐 문서의 배치 파일만 쓴다. 쓰면 작업 트리의 변경 목록에 나타나고,
 *   다른 파일처럼 골라서 commit 한다.
 * - 기획 요소를 더하거나 지우는 일은 여기서 하지 않는다. "원문 열기"로 문서 뷰에서 고친다.
 */
export function WireframeView({
  projectId,
  onOpen,
}: {
  projectId: string
  onOpen: (location: { path: string; line?: number }) => void
}) {
  const { tree, paths, files, readError, compile } = useTreeCompilation(projectId)

  if (tree.isError || readError !== null) {
    return (
      <Centered>
        <ErrorState
          title="작업 트리를 읽지 못했어요"
          description={errorMessage(tree.error ?? readError)}
          action={
            <Button variant="secondary" size="sm" onClick={() => void tree.refetch()}>
              다시 불러오기
            </Button>
          }
        />
      </Centered>
    )
  }
  if (tree.isSuccess && !paths.some(isRspdlPath)) {
    return (
      <Centered>
        <EmptyState
          icon={<FlowIcon className="size-6" />}
          title="아직 문서가 없어요"
          description="문서에 화면을 선언하면 여기서 와이어프레임으로 볼 수 있어요."
        />
      </Centered>
    )
  }
  if (compile.isError) {
    return (
      <Centered>
        <ErrorState
          title="컴파일하지 못했어요"
          description={errorMessage(compile.error)}
          action={
            <Button variant="secondary" size="sm" onClick={() => void compile.refetch()}>
              다시 시도
            </Button>
          }
        />
      </Centered>
    )
  }
  if (compile.data === undefined || files === null) {
    return (
      <div className="space-y-3 p-6" aria-busy>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <Wireframes
      projectId={projectId}
      response={compile.data.response}
      texts={compile.data.texts}
      files={files}
      stale={compile.isPlaceholderData}
      onOpen={onOpen}
    />
  )
}

function Wireframes({
  projectId,
  response,
  texts,
  files,
  stale,
  onOpen,
}: {
  projectId: string
  response: { result?: unknown }
  texts: Map<string, string>
  files: TreeFileResponse[]
  stale: boolean
  onOpen: (location: { path: string; line?: number }) => void
}) {
  const queryClient = useQueryClient()
  const board = useMemo(() => collectBoard(response), [response])
  const mockups = useMemo(() => collectScreenMockups(response), [response])

  /* ---------- 배치 파일 ↔ 편집 상태 ---------- */
  const wireframeFiles = useMemo<WireframeFile[]>(
    () => files.filter((file) => isWireframePath(file.path)).map((file) => ({ path: file.path, text: file.text })),
    [files],
  )
  const serverStamp = useMemo(
    () => files.filter((file) => isWireframePath(file.path)).map((file) => `${file.path}@${file.updated_at}`).join('|'),
    [files],
  )
  const persisted = useMemo(() => parseWireframes(wireframeFiles), [wireframeFiles])
  const filesRef = useRef(wireframeFiles)
  useEffect(() => { filesRef.current = wireframeFiles }, [wireframeFiles])

  const draftKey = `dahaze:wireframe-draft:${projectId}`
  const [editor, setEditor] = useState<DesignEditorState>(() => {
    const initial = createDesignEditorState(projectId, persisted.design, serverStamp)
    const draft = readDraft(draftKey, projectId)
    return draft === null ? initial : reconcileServerDesign(draft, persisted.design, serverStamp).state
  })
  const editorRef = useRef(editor)
  useEffect(() => { editorRef.current = editor }, [editor])

  /* 서버 파일이 바뀌면(저장 결과·다른 사람·AI) 편집을 지키면서 받아들인다. */
  useEffect(() => {
    setEditor((state) => reconcileServerDesign(state, persisted.design, serverStamp).state)
  }, [persisted.design, serverStamp])

  /* 저장 안 한 편집은 탭을 옮겨도 남도록 세션 저장소에 둔다. 저장소를 못 쓰면 그냥 넘어간다. */
  useEffect(() => {
    try {
      const draft = serializeDesignDraft(editor)
      if (draft === null) sessionStorage.removeItem(draftKey)
      else sessionStorage.setItem(draftKey, draft)
    } catch {
      /* 비공개 창 등 */
    }
  }, [draftKey, editor])

  const saving = useRef(false)
  const save = useCallback(async () => {
    const current = editorRef.current
    if (!isDirty(current) || current.status === 'conflict' || saving.current) return
    saving.current = true
    const generation = current.generation
    const snapshot = current.working
    setEditor((state) => ({ ...state, status: 'saving', error: null }))
    try {
      const before = filesRef.current
      const writes = wireframeWrites(before, current.base, snapshot)
      for (const write of writes) {
        if (write.exists) await saveTreeFile(projectId, { path: write.path, content: write.text })
        else {
          const at = write.path.lastIndexOf('/')
          await createTreeFile(projectId, { parent: at === 0 ? '/' : write.path.slice(0, at), name: write.path.slice(at + 1), content: write.text })
        }
      }
      /* 파일에 쓴 그대로 다시 읽은 모양을 기준으로 삼는다. 그래야 서버에서 다시 읽은 것과 비교가 맞다. */
      const written = new Map(writes.map((write) => [write.path, write.text]))
      const after = [
        ...before.map((file) => ({ path: file.path, text: written.get(file.path) ?? file.text })),
        ...writes.filter((write) => !write.exists).map((write) => ({ path: write.path, text: write.text })),
      ]
      const savedBase = parseWireframes(after).design
      setEditor((state) => acknowledgeDesign(state, generation, savedBase, `saved#${generation}`))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListTreeQueryKey(projectId) }),
        queryClient.invalidateQueries({ queryKey: getListTreeChangesQueryKey(projectId) }),
        ...writes.map((write) => queryClient.invalidateQueries({ queryKey: getReadTreeFileQueryKey(projectId, { path: write.path }) })),
      ])
    } catch (error) {
      setEditor((state) => ({ ...state, status: 'error', error: saveErrorMessage(error) }))
    } finally {
      saving.current = false
    }
  }, [projectId, queryClient])
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save }, [save])

  useEffect(() => {
    if (editor.status !== 'pending') return
    const timer = window.setTimeout(() => void save(), 700)
    return () => window.clearTimeout(timer)
  }, [editor.generation, editor.status, save])
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => { if (isDirty(editorRef.current)) event.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      if (isDirty(editorRef.current)) void saveRef.current()
    }
  }, [])

  /* ---------- 보드 ---------- */
  const [dimensions, setDimensions] = useState(DEFAULT_MOCKUP_DIMENSIONS)
  const [mode, setMode] = useState<PrototypeMode>('edit')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [composingKey, setComposingKey] = useState<string | null>(null)

  const positions = editor.working.positions
  const layouts = editor.working.layouts
  const systems = editor.working.systems
  const graph = useMemo(
    () => buildFlowGraph(board, mockups.screens, { positions, nodeWidth: FLOW_CARD_WIDTH, nodeHeight: FLOW_CARD_HEIGHT }),
    [board, mockups.screens, positions],
  )
  const outcomes = useMemo(() => outcomesByScreen(graph, board.handlerPaths), [graph, board.handlerPaths])
  const selected: FlowNode | null = graph.nodes.find((node) => node.id === selectedId) ?? null

  const select = useCallback((id: string | null) => setSelectedId(id), [])
  const moveScreen = useCallback(
    (key: string, position: { x: number; y: number }) =>
      setEditor((state) => editDesign(state, (design) => ({ ...design, positions: { ...design.positions, [key]: { x: Math.round(position.x), y: Math.round(position.y) } } }))),
    [],
  )
  const openComposer = useCallback((key: string) => { setSelectedId(key); setMode('edit'); setComposingKey(key) }, [])
  const undo = useCallback(() => setEditor(undoDesign), [])
  const redo = useCallback(() => setEditor(redoDesign), [])

  const lineOf = useCallback((path: string, span: ByteSpan | null) => {
    const text = texts.get(path)
    return span === null || text === undefined ? undefined : spanToLineColumn(text, span).line
  }, [texts])
  const openSource = useCallback((node: FlowNode) => onOpen({ path: node.screen.path, line: lineOf(node.screen.path, screenSourceSpan(node.screen)) }), [lineOf, onOpen])
  const layoutFileExists = useCallback((node: FlowNode) => wireframeFiles.some((file) => file.path === wireframePathFor(node.screen.path)), [wireframeFiles])

  /* 체험 상태: 버튼마다 고른 결과, 지금 떠 있는 메시지·팝업. 화면을 옮기면 떠 있는 것은 닫는다. */
  const [activeAction, setActiveAction] = useState<PrototypeAction | null>(null)
  const [chosenOutcomes, setChosenOutcomes] = useState<Record<string, Record<string, string>>>({})
  const goTo = useCallback((key: string) => { setActiveAction(null); setSelectedId(key) }, [])
  const prototype = useMemo(() => ({
    dimensions,
    mode,
    onNavigate: goTo,
    onAction: (action: PrototypeAction) => {
      const target = action.outcome.targetScreenKey
      if (target !== null && target !== undefined && graph.nodes.some((node) => node.id === target)) goTo(target)
      else setActiveAction(action.outcome.handler === null || action.outcome.handler === undefined ? null : action)
    },
  }), [dimensions, goTo, graph.nodes, mode])
  const shells = useMemo(() => new Map(graph.nodes.map((node) => [node.id, buildAppShell(board, node.id)])), [board, graph.nodes])
  const prototypeForNode = useCallback((node: FlowNode) => ({
    ...prototype,
    layout: layouts[node.id],
    shell: shells.get(node.id) ?? null,
    system: systems?.[node.screen.path],
    outcomesByElementId: outcomes[node.id],
    selectedOutcomeIdByElementId: chosenOutcomes[node.id],
    activeOutcome: activeAction?.screenKey === node.id ? activeAction.outcome : null,
    onOutcomeSelect: (elementId: string, outcomeId: string) => {
      setActiveAction(null)
      setChosenOutcomes((current) => ({ ...current, [node.id]: { ...current[node.id], [elementId]: outcomeId } }))
    },
    onOutcomeDismiss: () => setActiveAction(null),
  }), [activeAction, chosenOutcomes, layouts, outcomes, prototype, shells, systems])

  const composing = composingKey === null ? undefined : graph.nodes.find((node) => node.id === composingKey)

  /* AI 대화가 "이 화면" 을 알 수 있게, 편집 중이거나 고른 화면을 작업공간에 알린다. */
  const setFocus = useWorkspaceStore((state) => state.setFocus)
  const focusNode = composing ?? selected
  const focusPath = focusNode?.screen.path
  const focusWireframe = focusPath === undefined ? undefined : wireframePathFor(focusPath)
  const focusExists = focusWireframe !== undefined && wireframeFiles.some((file) => file.path === focusWireframe)
  const focusElements = useMemo(() => {
    const mockup = focusNode?.mockup
    if (mockup === null || mockup === undefined) return undefined
    /* id 가 있는 요소만 싣는다. 배치 파일은 `id:<요소 id>` 로만 가리킬 수 있다. */
    return [...declaredElements(mockup).values()].flatMap((entry) => entry.element.id === null ? [] : [{
      id: entry.element.id,
      kind: entry.element.kind,
      label: elementLabel(entry.element),
      ...(entry.owner?.startsWith('id:') ? { owner: entry.owner.slice(3) } : {}),
    }])
  }, [focusNode])
  useEffect(() => {
    setFocus(focusNode === undefined || focusNode === null
      ? { view: 'wireframe' }
      : { view: 'wireframe', documentPath: focusNode.screen.path, screenId: focusNode.screen.id, screenName: focusNode.screen.name, wireframePath: focusWireframe, wireframeExists: focusExists, elements: focusElements })
  }, [focusElements, focusExists, focusNode, focusWireframe, setFocus])
  useEffect(() => () => setFocus(null), [setFocus])
  const saveLabel = editor.status === 'saving' ? '저장 중' : editor.status === 'conflict' ? '충돌' : editor.status === 'error' ? '저장 실패' : isDirty(editor) ? '저장 대기' : '저장됨'

  const reload = () => setEditor(createDesignEditorState(projectId, persisted.design, serverStamp))
  const notice = (
    <SaveNotice
      editor={editor}
      invalid={persisted.invalid}
      onRetry={() => setEditor((state) => ({ ...state, status: 'pending', error: null }))}
      onReload={reload}
      onOpenFile={(path) => onOpen({ path })}
    />
  )

  const unparsed = board.unparsed.length === 0 ? null : (
    <UnparsedDocuments files={board.unparsed} onOpen={(path) => onOpen({ path })} />
  )
  if (board.screens.length === 0) {
    return (
      <Centered>
        {unparsed === null ? (
          <EmptyState
            icon={<FlowIcon className="size-6" />}
            title="선언된 화면이 없어요"
            description="문서에 화면을 선언하면 여기에 나타나고, '화면:' 으로 레이아웃을 선언하면 그 화면이 그려져요."
          />
        ) : (
          <div className="w-full max-w-lg">{unparsed}</div>
        )}
      </Centered>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3">
        <span className="mr-auto text-caption text-text-subtle tabular-nums">
          화면 {graph.nodes.length} · 연결 {graph.edges.length}
          {stale ? ' · 다시 컴파일하는 중' : ''}
        </span>
        <div role="group" aria-label="보드 모드" className="flex gap-0.5 rounded-lg border bg-surface p-0.5">
          <button type="button" aria-pressed={mode === 'edit'} className="rounded-md px-2.5 py-1 text-xs text-text-muted aria-pressed:bg-surface-raised aria-pressed:font-medium aria-pressed:text-text" onClick={() => setMode('edit')}>편집</button>
          <button type="button" aria-pressed={mode === 'experience'} disabled={selected === null} title={selected === null ? '체험할 화면을 먼저 고르세요' : '버튼을 눌러 연결된 화면으로 이동해 봅니다'} className="rounded-md px-2.5 py-1 text-xs text-text-muted aria-pressed:bg-surface-raised aria-pressed:font-medium aria-pressed:text-text disabled:opacity-40" onClick={() => setMode('experience')}>체험</button>
        </div>
        <button type="button" disabled={editor.history.length === 0} className="rounded-lg border px-2 py-1 text-xs disabled:opacity-40" onClick={undo}>되돌리기</button>
        <span aria-live="polite" className="w-16 text-right text-xs text-text-subtle">{saveLabel}</span>
      </header>
      {composing === undefined ? notice : null}
      {unparsed === null ? null : <div className="px-3 pt-2">{unparsed}</div>}
      {graph.danglingPaths.length === 0 ? null : (
        <p className="mx-3 mt-2 flex items-center gap-1.5 rounded-control border border-diagnostic-warning/40 bg-diagnostic-warning/5 px-3 py-2 text-xs text-text-muted">
          <WarningIcon className="size-4 text-diagnostic-warning" />
          끝점을 찾지 못한 경로 {graph.danglingPaths.length}건은 그리지 않았어요. 문서 뷰에서 컴파일러 진단을 확인하세요.
        </p>
      )}

      <div className="relative flex min-h-0 flex-1 gap-2 p-2">
        <FlowBoard
          graph={graph}
          selectedId={selected?.id ?? null}
          onSelect={select}
          prototype={prototype}
          prototypeForNode={prototypeForNode}
          editable={mode === 'edit'}
          onOpen={openComposer}
          onPositionChange={moveScreen}
        />
        {selected === null || mode !== 'edit' ? null : (
          <ScreenInspector
            node={selected}
            graph={graph}
            onClose={() => setSelectedId(null)}
            onCompose={() => openComposer(selected.id)}
            onOpenSource={() => openSource(selected)}
            onSelect={select}
          />
        )}
      </div>

      {composing === undefined || composing.mockup === null ? null : (
        /* 가운데 패널만 덮는다. 오른쪽 AI 대화를 열어 둔 채 편집하고, AI 가 바꾼 배치가 바로 보이게. */
        <div role="dialog" aria-label={`${composing.screen.name} 화면 편집`} className="absolute inset-0 z-30 flex flex-col bg-surface">
          <ScreenComposer
            key={composing.id}
            screen={composing.mockup}
            savedLayout={layouts[composing.id]}
            shell={shells.get(composing.id) ?? null}
            system={systems?.[composing.screen.path]}
            onSystemChange={(system) => setEditor((state) => editDesign(state, (design) => {
              const next = { ...design.systems }
              if (system === undefined) delete next[composing.screen.path]
              else next[composing.screen.path] = system
              return { ...design, systems: next }
            }))}
            onLayoutChange={(next: GroupNode) => setEditor((state) => editDesign(state, (design) => ({ ...design, layouts: { ...design.layouts, [composing.id]: next as LayoutNode } })))}
            dimensions={dimensions}
            onDimensionsChange={setDimensions}
            onOpenSource={() => { setComposingKey(null); openSource(composing) }}
            onOpenLayoutFile={layoutFileExists(composing) ? () => { setComposingKey(null); onOpen({ path: wireframePathFor(composing.screen.path) }) } : undefined}
            notice={notice}
            onClose={() => setComposingKey(null)}
            canUndo={editor.history.length > 0}
            canRedo={editor.future.length > 0}
            onUndo={undo}
            onRedo={redo}
            saveLabel={saveLabel}
          />
        </div>
      )}
    </div>
  )
}

/** 고른 화면의 요약: 어디에 선언됐는지, 어디로 가고 어디서 오는지. */
function ScreenInspector({
  node,
  graph,
  onClose,
  onCompose,
  onOpenSource,
  onSelect,
}: {
  node: FlowNode
  graph: ReturnType<typeof buildFlowGraph>
  onClose: () => void
  onCompose: () => void
  onOpenSource: () => void
  onSelect: (id: string) => void
}) {
  const nameOf = (id: string) => graph.nodes.find((entry) => entry.id === id)?.screen.name ?? id
  const outgoing = graph.edges.filter((edge) => edge.source === node.id)
  const incoming = graph.edges.filter((edge) => edge.target === node.id)
  return (
    <aside aria-label="고른 화면" className="absolute top-2 right-2 bottom-2 z-10 flex w-72 max-w-[calc(100%-1rem)] flex-col overflow-y-auto rounded-xl border bg-surface text-xs shadow-lg lg:static lg:shadow-none">
      <header className="flex items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{node.screen.name}</h2>
          <p className="truncate font-mono text-[11px] text-text-subtle">{node.screen.id}</p>
        </div>
        <button type="button" aria-label="닫기" className="text-text-subtle" onClick={onClose}>×</button>
      </header>
      <div className="flex flex-wrap gap-1.5 border-b px-4 py-3">
        <button type="button" disabled={node.mockup === null} title={node.mockup === null ? "'화면:' 레이아웃을 선언한 화면만 편집할 수 있어요" : '카드를 더블클릭해도 열려요'} className="rounded bg-text px-3 py-1 font-medium text-surface disabled:opacity-40" onClick={onCompose}>화면 편집</button>
        <button type="button" className="rounded border px-2 py-1" onClick={onOpenSource}>원문 열기</button>
      </div>
      <dl className="space-y-1 border-b px-4 py-3">
        <div className="flex gap-2"><dt className="w-10 shrink-0 text-text-subtle">문서</dt><dd className="min-w-0 truncate font-mono">{node.screen.path}</dd></div>
        {node.screen.categoryId === null ? null : <div className="flex gap-2"><dt className="w-10 shrink-0 text-text-subtle">분류</dt><dd className="min-w-0 truncate font-mono">{node.screen.categoryId}</dd></div>}
      </dl>
      <EdgeList title="나가는 연결" empty="이 화면에서 가는 경로가 없어요." items={outgoing.map((edge) => ({ id: edge.id, label: edge.label, other: edge.target }))} nameOf={nameOf} onSelect={onSelect} arrow="→" />
      <EdgeList title="들어오는 연결" empty="이 화면으로 오는 경로가 없어요." items={incoming.map((edge) => ({ id: edge.id, label: edge.label, other: edge.source }))} nameOf={nameOf} onSelect={onSelect} arrow="←" />
    </aside>
  )
}

function EdgeList({ title, empty, items, nameOf, onSelect, arrow }: {
  title: string
  empty: string
  items: { id: string; label: string; other: string }[]
  nameOf: (id: string) => string
  onSelect: (id: string) => void
  arrow: string
}) {
  return (
    <section className="border-b px-4 py-3">
      <h3 className="mb-1.5 font-semibold">{title}</h3>
      {items.length === 0 ? <p className="text-text-subtle">{empty}</p> : (
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="flex w-full items-baseline gap-1.5 rounded px-1 py-1 text-left hover:bg-surface-raised" onClick={() => onSelect(item.other)}>
                <span className="text-text-subtle">{arrow}</span>
                <span className="min-w-0 flex-1 truncate">{nameOf(item.other)}</span>
                <span className="max-w-[45%] shrink-0 truncate text-text-subtle">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 오류 때문에 컴파일러가 구조를 내보내지 않은 문서. 이 문서들의 화면은 보드에 없다. */
function UnparsedDocuments({ files, onOpen }: { files: { path: string; errorCount: number }[]; onOpen: (path: string) => void }) {
  return (
    <section aria-labelledby="wireframe-unparsed" className="rounded-control border border-diagnostic-warning/40 bg-diagnostic-warning/5 px-3 py-2 text-xs">
      <h2 id="wireframe-unparsed" className="flex items-center gap-1.5 font-semibold text-diagnostic-warning">
        <WarningIcon className="size-4" />
        화면을 읽지 못한 문서 {files.length}개
      </h2>
      <p className="mt-0.5 text-text-muted">오류가 하나라도 있으면 컴파일러가 그 문서의 구조를 내보내지 않아요. 오류를 고치면 화면이 나타나요.</p>
      <ul className="mt-1.5">
        {files.map((file) => (
          <li key={file.path}>
            <button type="button" className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-surface-raised" onClick={() => onOpen(file.path)}>
              <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
              <span className="shrink-0 text-text-subtle tabular-nums">오류 {file.errorCount.toLocaleString('ko-KR')}개 · 진단 보기</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SaveNotice({ editor, invalid, onRetry, onReload, onOpenFile }: {
  editor: DesignEditorState
  invalid: { path: string; reason: string }[]
  onRetry: () => void
  onReload: () => void
  onOpenFile: (path: string) => void
}) {
  const rows: ReactNode[] = []
  if (editor.status === 'error') {
    rows.push(
      <div key="error" className="flex items-center gap-2 rounded-control border border-diagnostic-error/40 bg-diagnostic-error-subtle px-3 py-2 text-xs">
        <p className="flex-1">배치 저장 실패 · {editor.error}</p>
        <button type="button" className="rounded border px-2 py-1" onClick={onRetry}>다시 시도</button>
      </div>,
    )
  }
  if (editor.status === 'conflict') {
    rows.push(
      <div key="conflict" className="flex items-center gap-2 rounded-control border border-diagnostic-warning/40 bg-diagnostic-warning/5 px-3 py-2 text-xs">
        <p className="flex-1">{editor.error} 지금 편집한 내용은 저장하지 않고 남겨 두었어요.</p>
        <button type="button" className="rounded border px-2 py-1" onClick={onReload}>저장된 배치로 다시 불러오기</button>
      </div>,
    )
  }
  for (const file of invalid) {
    rows.push(
      <div key={file.path} className="flex items-center gap-2 rounded-control border border-diagnostic-warning/40 bg-diagnostic-warning/5 px-3 py-2 text-xs">
        <p className="flex-1"><span className="font-mono">{file.path}</span> 를 읽지 못했어요({file.reason}). 이 문서의 배치는 기본 모양으로 보여요.</p>
        <button type="button" className="rounded border px-2 py-1" onClick={() => onOpenFile(file.path)}>파일 열기</button>
      </div>,
    )
  }
  return rows.length === 0 ? null : <div className="space-y-1.5 px-3 pt-2">{rows}</div>
}

function saveErrorMessage(error: unknown): string {
  if (errorDetail(error)?.code === 'locked') return 'AI 작업이 배치 파일을 쓰고 있어요. 작업이 끝난 뒤 다시 시도해 주세요.'
  return error instanceof Error && !('status' in error) ? error.message : errorMessage(error)
}

function readDraft(key: string, scope: string): DesignEditorState | null {
  try {
    return restoreDesignDraft(sessionStorage.getItem(key), scope)
  } catch {
    return null
  }
}

function Centered({ children }: { children: ReactNode }) {
  return <div className={cn('flex flex-1 items-center justify-center p-8')}>{children}</div>
}
