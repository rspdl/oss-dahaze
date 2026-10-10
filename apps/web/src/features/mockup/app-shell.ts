import type { BoardCategory, BoardScreen, CollectedBoard } from '../wireframe/board-ir'

/**
 * 화면을 앱 안에 놓고 그리기 위한 틀: 왼쪽 메뉴, 위쪽 경로 표시, 주소.
 *
 * 새 의미를 만들지 않는다. 메뉴는 문서의 `정보구조:` 그대로다 — 화면이 담긴 최상위 분류가 앱
 * 하나이고, 그 아래 분류가 메뉴 묶음, 분류에 담긴 화면이 메뉴 항목이다. 순서도 문서에 쓴 순서다.
 * 주소는 분류와 화면의 id 끝 조각을 이은 것이라 보여주기만 할 뿐 라우팅 규칙을 정하지 않는다.
 *
 * 어느 분류에도 담기지 않은 화면은 틀 없이 그린다. 메뉴를 지어내면 기획자가 쓰지 않은 구조를
 * 쓴 것처럼 보인다.
 */

export interface AppShellItem {
  screenKey: string
  name: string
  route: string
  current: boolean
}

export interface AppShellGroup {
  key: string
  name: string
  items: AppShellItem[]
  groups: AppShellGroup[]
}

export interface AppShellModel {
  /** 최상위 분류 이름. 앱 이름 자리에 쓴다. */
  appName: string
  /** 최상위 분류에 바로 담긴 화면. */
  items: AppShellItem[]
  groups: AppShellGroup[]
  /** 최상위 분류부터 화면까지의 이름. */
  breadcrumb: string[]
  route: string
  roleNames: string[]
  /** `popup` 이면 앱 위에 띄운 창으로 그린다. */
  kind: string | null
}

const local = (id: string) => id.slice(id.lastIndexOf('.') + 1)

export function buildAppShell(board: CollectedBoard, screenKey: string): AppShellModel | null {
  const screen = board.screens.find((entry) => entry.key === screenKey)
  if (screen === undefined || screen.categoryId === null) return null

  const categories = board.categories.filter((category) => category.path === screen.path)
  const byId = new Map(categories.map((category) => [category.id, category]))
  const chain: BoardCategory[] = []
  for (let current = byId.get(screen.categoryId); current !== undefined; current = current.parentId === null ? undefined : byId.get(current.parentId)) {
    if (chain.includes(current)) break
    chain.unshift(current)
  }
  const root = chain[0]
  if (root === undefined) return null

  const screensIn = (categoryId: string) =>
    board.screens
      .filter((entry) => entry.path === screen.path && entry.categoryId === categoryId)
      .sort((a, b) => (a.categoryOrder ?? 0) - (b.categoryOrder ?? 0))
  const routeOf = (entry: BoardScreen, trail: BoardCategory[]) => `/${[...trail.map((category) => local(category.id)), local(entry.id)].join('/')}`
  const item = (entry: BoardScreen, trail: BoardCategory[]): AppShellItem => ({ screenKey: entry.key, name: entry.name, route: routeOf(entry, trail), current: entry.key === screen.key })
  const group = (category: BoardCategory, trail: BoardCategory[]): AppShellGroup => {
    const next = [...trail, category]
    return {
      key: category.key,
      name: category.name,
      items: screensIn(category.id).map((entry) => item(entry, next)),
      groups: categories.filter((child) => child.parentId === category.id).map((child) => group(child, next)),
    }
  }

  return {
    appName: root.name,
    items: screensIn(root.id).map((entry) => item(entry, [root])),
    groups: categories.filter((child) => child.parentId === root.id).map((child) => group(child, [root])),
    breadcrumb: [...chain.map((category) => category.name), screen.name],
    route: routeOf(screen, chain),
    roleNames: screen.roleNames ?? [],
    kind: screen.kind ?? null,
  }
}
