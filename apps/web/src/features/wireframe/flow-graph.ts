import { DEFAULT_MOCKUP_DIMENSIONS } from '../mockup/screen-mockup'
import type { MockupElement, ScreenMockup } from '@/features/mockup/screen-layouts'
import type { ActionOutcome } from '@/features/mockup/prototype-contract'
import { refKey, type BoardHandlerPath, type BoardPath, type BoardScreen, type CollectedBoard } from './board-ir'

/**
 * 화면과 경로를 흐름 캔버스의 노드·간선으로 세운다.
 *
 * 노드는 **모든 화면**이다. 레이아웃을 선언한 화면은 목업으로, 선언하지 않은 화면은 빈
 * 상자로 그린다 — 조작 선언에서 모양을 유추하지 않는다. 유추한 화면은 기획자가 쓰지 않은
 * 것을 쓴 것처럼 보이게 한다 (RFC-0001).
 *
 * 자리는 경로를 따라 층으로 쌓는다. 들어오는 경로가 없는 화면이 0층이고, 거기서 닿는
 * 화면이 한 층씩 오른쪽으로 간다. 어떤 경로로도 닿지 않는 화면도 0층에 선다 — 컴파일러가
 * 그것을 `warning` 으로 알릴 뿐 지우지 않으므로 보드도 지우지 않는다.
 */

export interface FlowNode {
  id: string
  screen: BoardScreen
  /** 레이아웃을 선언했으면 그 목업. 아니면 `null` 이고 빈 상자로 그린다. */
  mockup: ScreenMockup | null
  position: { x: number; y: number }
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  /** 화살표 위에 적을 말. 설명을 적지 않았으면 출발 요소 이름을 쓴다. */
  label: string
  path: BoardPath
}

export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** 끝점을 화면 목록에서 찾지 못한 경로. 화면이 "여기 뭔가 어긋났다" 고 말할 수 있게 한다. */
  danglingPaths: BoardPath[]
}

/**
 * 체험 모드에서 버튼이 낼 수 있는 결과. 화면 이동(경로)과 화면에 머무는 처리(메시지·팝업 등)를 함께 모은다.
 *
 * 한 버튼에 결과가 여럿이면 체험하는 사람이 고른다. 그래서 이름에 결과 id 와 도착지를 같이 적는다.
 */
export function outcomesByScreen(graph: FlowGraph, handlerPaths: readonly BoardHandlerPath[] = []): Record<string, Record<string, ActionOutcome[]>> {
  const result: Record<string, Record<string, ActionOutcome[]>> = {}
  const push = (screenKey: string, elementId: string, outcome: ActionOutcome) => {
    const screen = result[screenKey] ?? (result[screenKey] = {})
    const outcomes = screen[elementId] ?? (screen[elementId] = [])
    outcomes.push(outcome)
  }
  const nameOf = (key: string) => graph.nodes.find((node) => node.id === key)?.screen.name ?? key
  const local = (id: string) => id.slice(id.lastIndexOf('.') + 1)
  for (const edge of graph.edges) {
    const outcomeId = edge.path.outcomeId ?? null
    push(edge.source, edge.path.sourceElementId, {
      id: edge.id,
      label: outcomeId === null ? edge.label : `${local(outcomeId)} → ${nameOf(edge.target)}`,
      targetScreenKey: edge.target,
    })
  }
  const visible = new Set(graph.nodes.map((node) => node.id))
  for (const path of handlerPaths) {
    const source = refKey(path.path, path.sourceScreenId)
    if (!visible.has(source)) continue
    push(source, path.sourceElementId, {
      id: path.key,
      label: `${path.outcomeId === null ? '' : `${local(path.outcomeId)} · `}${HANDLER_NAME[path.handler.kind]}`,
      targetScreenKey: null,
      handler: { kind: path.handler.kind, id: path.handler.id, content: path.handler.content },
    })
  }
  return result
}

const HANDLER_NAME = { state: '상태 표시', message: '메시지', popup: '팝업', loading: '로딩' } as const

/** 목업 폭. `screen-mockup.tsx` 의 기본 크기와 같아야 노드가 잘리지 않는다. */
const NODE_WIDTH = DEFAULT_MOCKUP_DIMENSIONS.width
const COLUMN_GAP = 180
const ROW_GAP = 120

export function buildFlowGraph(
  collected: CollectedBoard,
  mockups: ScreenMockup[],
  options: { visibleScreenKeys?: ReadonlySet<string>; positions?: Readonly<Record<string, { x: number; y: number }>>; nodeWidth?: number; nodeHeight?: number } = {},
): FlowGraph {
  /* 전부 `path + id` 로 가른다. 같은 모듈 id 를 쓰는 두 문서에서 화면 id 가 글자 그대로
     같아지므로, 바깥 id 로 묶으면 한 문서의 화면이 다른 문서의 것을 덮어쓴다. 경로의 끝점도
     자기 문서 안의 화면을 가리키므로 같은 규칙으로 푼다. */
  const mockupByKey = new Map(mockups.map((mockup) => [mockup.key, mockup]))
  const visibleScreens = options.visibleScreenKeys === undefined ? collected.screens : collected.screens.filter((screen) => options.visibleScreenKeys!.has(screen.key))
  // Source order gives cyclic flows a stable visual starting point without inventing
  // an entry-screen semantic. The compiler's alphabetical IDs are not layout order.
  const orderedScreens = [...visibleScreens].sort((a, b) => a.path.localeCompare(b.path) || (a.layoutSpan?.start ?? a.span?.start ?? 0) - (b.layoutSpan?.start ?? b.span?.start ?? 0))
  const screenByKey = new Map(visibleScreens.map((screen) => [screen.key, screen]))
  const allScreenKeys = new Set(collected.screens.map((screen) => screen.key))
  const sourceKeyOf = (path: BoardPath) => refKey(path.path, path.sourceScreenId)
  const targetKeyOf = (path: BoardPath) => refKey(path.path, path.targetScreenId)

  const danglingPaths: BoardPath[] = []
  const livePaths: BoardPath[] = []
  for (const path of collected.paths) {
    const sourceKey = sourceKeyOf(path)
    const targetKey = targetKeyOf(path)
    if (!allScreenKeys.has(sourceKey) || !allScreenKeys.has(targetKey)) {
      danglingPaths.push(path)
    } else if (screenByKey.has(sourceKey) && screenByKey.has(targetKey)) {
      livePaths.push(path)
    }
  }

  /* 층을 정한다. 들어오는 경로가 없는 화면이 0층. 순환이 있어도 멈추도록 이미 본 화면은
     다시 내리지 않는다 — 경로의 순환은 언어가 막지 않는 것이고 보드가 멈춰서는 안 된다. */
  const incoming = new Set(livePaths.map(targetKeyOf))
  const outgoing = new Map<string, string[]>()
  for (const path of livePaths) {
    const targets = outgoing.get(sourceKeyOf(path)) ?? []
    targets.push(targetKeyOf(path))
    outgoing.set(sourceKeyOf(path), targets)
  }

  const depth = new Map<string, number>()
  const queue: string[] = []
  for (const screen of orderedScreens) {
    if (!incoming.has(screen.key)) {
      depth.set(screen.key, 0)
      queue.push(screen.key)
    }
  }
  const traversal: string[] = []
  const traverse = () => {
    while (queue.length > 0) {
      const current = queue.shift()!
      traversal.push(current)
      const currentDepth = depth.get(current) ?? 0
      for (const next of outgoing.get(current) ?? []) {
        if (depth.has(next)) continue
        depth.set(next, currentDepth + 1)
        queue.push(next)
      }
    }
  }
  traverse()
  // Cyclic components still have a visible left-to-right spanning flow. Back edges
  // remain real edges; they must not collapse the entire component into one column.
  for (const screen of orderedScreens) {
    if (depth.has(screen.key)) continue
    depth.set(screen.key, 0)
    queue.push(screen.key)
    traverse()
  }

  const adjacent = new Map<string, Set<string>>()
  for (const path of livePaths) {
    const source = sourceKeyOf(path)
    const target = targetKeyOf(path)
    adjacent.set(source, new Set([...(adjacent.get(source) ?? []), target]))
    adjacent.set(target, new Set([...(adjacent.get(target) ?? []), source]))
  }
  const automaticPositions = new Map<string, { x: number; y: number }>()
  let componentTop = 0
  for (const screen of orderedScreens) {
    if (automaticPositions.has(screen.key)) continue
    const component = new Set<string>()
    const pending = [screen.key]
    while (pending.length > 0) {
      const key = pending.pop()!
      if (component.has(key)) continue
      component.add(key)
      pending.push(...(adjacent.get(key) ?? []))
    }
    const nextY = new Map<number, number>()
    for (const key of traversal.filter((key) => component.has(key))) {
      const column = depth.get(key) ?? 0
      const y = nextY.get(column) ?? componentTop
      automaticPositions.set(key, { x: column * ((options.nodeWidth ?? NODE_WIDTH) + COLUMN_GAP), y })
      nextY.set(column, y + (options.nodeHeight ?? DEFAULT_MOCKUP_DIMENSIONS.height + 48) + ROW_GAP)
    }
    componentTop = Math.max(...nextY.values()) + ROW_GAP
  }
  const nodes: FlowNode[] = visibleScreens.map((screen) => {
    return {
      id: screen.key,
      screen,
      mockup: mockupByKey.get(screen.key) ?? null,
      position: options.positions?.[screen.key] ?? automaticPositions.get(screen.key)!,
    }
  })

  const edges: FlowEdge[] = livePaths.map((path) => ({
    id: path.key,
    source: sourceKeyOf(path),
    target: targetKeyOf(path),
    label: path.label ?? elementName(mockupByKey.get(sourceKeyOf(path))?.elements ?? [], path.sourceElementId) ?? path.sourceElementId,
    path,
  }))

  return { nodes, edges, danglingPaths }
}

function elementName(elements: MockupElement[], id: string): string | undefined {
  for (const element of elements) {
    if (element.id === id && element.kind === 'button') return element.name
    const nested = element.kind === 'header' || element.kind === 'section' ? element.children : element.kind === 'form' ? element.inputs : []
    const name = elementName(nested, id)
    if (name !== undefined) return name
  }
  return undefined
}
