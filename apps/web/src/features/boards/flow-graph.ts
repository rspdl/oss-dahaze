import type { MockupViewport } from '@/features/mockup/screen-mockup'
import type { ScreenMockup } from '@/features/mockup/screen-layouts'
import type { ActionOutcome } from '@/features/mockup/prototype-contract'
import { refKey, type BoardPath, type BoardScreen, type CollectedBoard } from './board-ir'

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

export function outcomesByScreen(graph: FlowGraph): Record<string, Record<string, ActionOutcome[]>> {
  const result: Record<string, Record<string, ActionOutcome[]>> = {}
  for (const edge of graph.edges) {
    const screen = result[edge.source] ?? (result[edge.source] = {})
    const outcomes = screen[edge.path.sourceElementId] ?? (screen[edge.path.sourceElementId] = [])
    outcomes.push({ id: edge.id, label: edge.label, targetScreenKey: edge.target })
  }
  return result
}

/** 목업 폭. `screen-mockup.tsx` 의 기기 폭과 같아야 노드가 잘리지 않는다. */
const NODE_WIDTH: Record<MockupViewport, number> = { desktop: 1024, mobile: 390 }
const COLUMN_GAP = 180
const ROW_GAP = 120
/** 빈 상자의 높이. 목업은 내용만큼 자라므로 층 간격은 넉넉히 둔다. */
const ROW_HEIGHT = 520

export function buildFlowGraph(
  collected: CollectedBoard,
  mockups: ScreenMockup[],
  viewport: MockupViewport,
  options: { visibleScreenKeys?: ReadonlySet<string>; positions?: Readonly<Record<string, { x: number; y: number }>>; nodeWidth?: number } = {},
): FlowGraph {
  /* 전부 `path + id` 로 가른다. 같은 모듈 id 를 쓰는 두 문서에서 화면 id 가 글자 그대로
     같아지므로, 바깥 id 로 묶으면 한 문서의 화면이 다른 문서의 것을 덮어쓴다. 경로의 끝점도
     자기 문서 안의 화면을 가리키므로 같은 규칙으로 푼다. */
  const mockupByKey = new Map(mockups.map((mockup) => [mockup.key, mockup]))
  const visibleScreens = options.visibleScreenKeys === undefined ? collected.screens : collected.screens.filter((screen) => options.visibleScreenKeys!.has(screen.key))
  const screenByKey = new Map(visibleScreens.map((screen) => [screen.key, screen]))
  const sourceKeyOf = (path: BoardPath) => refKey(path.path, path.sourceScreenId)
  const targetKeyOf = (path: BoardPath) => refKey(path.path, path.targetScreenId)

  const danglingPaths: BoardPath[] = []
  const livePaths: BoardPath[] = []
  for (const path of collected.paths) {
    if (screenByKey.has(sourceKeyOf(path)) && screenByKey.has(targetKeyOf(path))) {
      livePaths.push(path)
    } else {
      danglingPaths.push(path)
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
  for (const screen of visibleScreens) {
    if (!incoming.has(screen.key)) {
      depth.set(screen.key, 0)
      queue.push(screen.key)
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!
    const currentDepth = depth.get(current) ?? 0
    for (const next of outgoing.get(current) ?? []) {
      if (depth.has(next)) continue
      depth.set(next, currentDepth + 1)
      queue.push(next)
    }
  }
  /* 순환 안에만 있는 화면은 위 탐색이 닿지 못한다. 선언 순서대로 0층에 세운다. */
  for (const screen of visibleScreens) {
    if (!depth.has(screen.key)) depth.set(screen.key, 0)
  }

  const rowInColumn = new Map<number, number>()
  const nodes: FlowNode[] = visibleScreens.map((screen) => {
    const column = depth.get(screen.key) ?? 0
    const row = rowInColumn.get(column) ?? 0
    rowInColumn.set(column, row + 1)
    return {
      id: screen.key,
      screen,
      mockup: mockupByKey.get(screen.key) ?? null,
      position: options.positions?.[screen.key] ?? {
        x: column * ((options.nodeWidth ?? NODE_WIDTH[viewport]) + COLUMN_GAP),
        y: row * (ROW_HEIGHT + ROW_GAP),
      },
    }
  })

  const edges: FlowEdge[] = livePaths.map((path) => ({
    id: path.key,
    source: sourceKeyOf(path),
    target: targetKeyOf(path),
    label: path.label ?? path.sourceElementId,
    path,
  }))

  return { nodes, edges, danglingPaths }
}
