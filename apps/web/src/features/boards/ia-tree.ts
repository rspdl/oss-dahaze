import type { BoardCategory, BoardScreen, CollectedBoard } from './board-ir'

/**
 * 분류와 화면을 트리로 세우고 자리를 잡는다.
 *
 * **정렬하지 않는다.** `information_architecture` 는 선언 순서(전위 순회)로 오고 화면도
 * 선언 순서로 온다. 정보구조에서 형제의 순서는 곧 메뉴 순서이므로, 이름순으로 다시 세우면
 * 기획자가 적은 결정을 버리는 것이 된다.
 *
 * 깊이가 왼쪽에서 오른쪽으로 자란다. 세로는 잎을 하나씩 내려 쌓고, 가지는 자기 잎들의
 * 가운데에 놓는다 — 그래야 부모가 자식 무리 옆에 서고 선이 꼬이지 않는다.
 */

/** 분류에도 화면에도 쓰는 공통 노드. 보드는 둘을 같은 캔버스에 그린다. */
export interface IaNode {
  id: string
  kind: 'category' | 'screen'
  name: string
  /** 0 이 최상위. 가로 자리를 정한다. */
  depth: number
  position: { x: number; y: number }
  category: BoardCategory | null
  screen: BoardScreen | null
  /** 미분류 묶음처럼 IR 에 없는 노드인지. 화면이 그것을 솔직히 말할 수 있게 한다. */
  synthetic: boolean
}

export interface IaEdge {
  id: string
  source: string
  target: string
}

export interface IaTree {
  nodes: IaNode[]
  edges: IaEdge[]
}

/** 분류에 담기지 않은 화면을 모으는 자리. IR 에 없는 노드라 id 를 알아볼 수 있게 둔다. */
export const UNCATEGORIZED_ID = '__uncategorized__'

const COLUMN_WIDTH = 300
const ROW_HEIGHT = 84

interface Placement {
  node: IaNode
  /** 이 가지가 차지한 잎의 첫 줄과 끝 줄. 가운데를 구하는 데만 쓴다. */
  firstRow: number
  lastRow: number
}

export function buildIaTree(collected: CollectedBoard): IaTree {
  const nodes: IaNode[] = []
  const edges: IaEdge[] = []

  /* 분류를 부모별로 모은다. 선언 순서가 곧 형제 순서이므로 들어온 차례대로 밀어 넣는다. */
  const childCategories = new Map<string, BoardCategory[]>()
  const roots: BoardCategory[] = []
  const categoryIds = new Set(collected.categories.map((category) => category.id))

  for (const category of collected.categories) {
    /* 부모를 찾지 못한 분류는 고아로 버리지 않고 최상위로 올린다. 컴파일러가 없는 부모를
       거부하므로 여기까지 오는 경우는 드물지만, 버리면 화면이 문서에 대해 거짓말을 한다. */
    if (category.parentId === null || !categoryIds.has(category.parentId)) {
      roots.push(category)
      continue
    }
    const siblings = childCategories.get(category.parentId) ?? []
    siblings.push(category)
    childCategories.set(category.parentId, siblings)
  }

  const screensByCategory = new Map<string, BoardScreen[]>()
  const uncategorized: BoardScreen[] = []
  for (const screen of collected.screens) {
    if (screen.categoryId === null || !categoryIds.has(screen.categoryId)) {
      uncategorized.push(screen)
      continue
    }
    const members = screensByCategory.get(screen.categoryId) ?? []
    members.push(screen)
    screensByCategory.set(screen.categoryId, members)
  }

  /* 분류 안의 차례를 기획자가 적은 대로 되돌린다.
     `module.screens` 는 **id 순으로 정렬돼** 오므로 그대로 쓰면 `[시설 목록 화면, 시설 상세
     화면]` 이라고 적은 순서가 뒤집힌다. 여기서 하는 것은 순서를 새로 정하는 것이 아니라
     머리말에 적힌 차례를 복원하는 것이다. */
  for (const members of screensByCategory.values()) {
    members.sort((left, right) => (left.categoryOrder ?? 0) - (right.categoryOrder ?? 0))
  }

  let nextRow = 0

  function placeScreen(screen: BoardScreen, depth: number): Placement {
    const row = nextRow
    nextRow += 1
    const node: IaNode = {
      id: screen.key,
      kind: 'screen',
      name: screen.name,
      depth,
      position: { x: depth * COLUMN_WIDTH, y: row * ROW_HEIGHT },
      category: null,
      screen,
      synthetic: false,
    }
    nodes.push(node)
    return { node, firstRow: row, lastRow: row }
  }

  function placeCategory(category: BoardCategory, depth: number): Placement {
    const children: Placement[] = []
    for (const child of childCategories.get(category.id) ?? []) {
      children.push(placeCategory(child, depth + 1))
    }
    for (const screen of screensByCategory.get(category.id) ?? []) {
      children.push(placeScreen(screen, depth + 1))
    }

    /* 자식이 없는 분류도 자리를 차지해야 다음 형제와 겹치지 않는다. */
    const firstRow = children.length === 0 ? nextRow : children[0]!.firstRow
    const lastRow = children.length === 0 ? nextRow : children[children.length - 1]!.lastRow
    if (children.length === 0) nextRow += 1

    const node: IaNode = {
      id: category.key,
      kind: 'category',
      name: category.name,
      depth,
      position: {
        x: depth * COLUMN_WIDTH,
        y: ((firstRow + lastRow) / 2) * ROW_HEIGHT,
      },
      category,
      screen: null,
      synthetic: false,
    }
    nodes.push(node)

    for (const child of children) {
      edges.push({ id: `${node.id}->${child.node.id}`, source: node.id, target: child.node.id })
    }

    return { node, firstRow, lastRow }
  }

  for (const root of roots) placeCategory(root, 0)

  /* 분류에 담기지 않은 화면은 숨기지 않는다. 컴파일러도 그 사실을 `info` 로 알릴 뿐
     오류로 만들지 않으므로, 보드가 더 엄격하거나 더 조용해서는 안 된다. */
  if (uncategorized.length > 0) {
    const children = uncategorized.map((screen) => placeScreen(screen, 1))
    const firstRow = children[0]!.firstRow
    const lastRow = children[children.length - 1]!.lastRow
    const node: IaNode = {
      id: UNCATEGORIZED_ID,
      kind: 'category',
      name: '미분류',
      depth: 0,
      position: { x: 0, y: ((firstRow + lastRow) / 2) * ROW_HEIGHT },
      category: null,
      screen: null,
      synthetic: true,
    }
    nodes.push(node)
    for (const child of children) {
      edges.push({ id: `${node.id}->${child.node.id}`, source: node.id, target: child.node.id })
    }
  }

  return { nodes, edges }
}
