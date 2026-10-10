import type { ElementSelection } from './prototype-contract'
import type { MockupElement, ScreenMockup } from './screen-layouts'

/**
 * 화면 배치를 Jetpack Compose 의 Column · Row · Box 와 같은 트리로 표현한다.
 *
 * 요소가 무엇인지는 문서가 정한다. 이 트리는 그 요소를 **어떻게 늘어놓을지**만 담고 기획
 * 원문과 따로 저장된다. 그래서 요소는 자기가 선언된 영역(머리글·영역·입력 그룹·화면 최상위)
 * 안에서만 옮길 수 있다. 영역 밖으로 옮기면 기획 구조가 바뀌므로 그것은 컴파일러를 거치는
 * 제안으로 처리한다.
 *
 * 텍스트·사각형·구분선·여백은 **디자인 전용** 노드다. 기획 의미가 없고 배치 정보에만 있으므로
 * 어디로든 옮기고 지울 수 있다. 색은 회색 단계만 쓴다.
 */

export type Direction = 'column' | 'row' | 'box'
/** 주 축(방향) 정렬. Compose 의 Arrangement. */
export type Arrangement = 'start' | 'center' | 'end' | 'space-between'
/** 교차 축 정렬. Compose 의 Alignment. */
export type Align = 'start' | 'center' | 'end'
/** `hug` 은 내용 크기(wrapContent), `fill` 은 남은 공간 채우기, 숫자는 고정 px. */
export type Size = 'hug' | 'fill' | number
/** 회색 단계만 쓴다. 흰색 → 밝은 회색 → 회색 → 진한 회색. */
export type Fill = 'none' | 'surface' | 'raised' | 'gray' | 'strong'

export interface ContainerLayout {
  direction: Direction
  gap: number
  paddingX: number
  paddingY: number
  /** column 은 세로, row 는 가로, box 는 세로 정렬. */
  main: Arrangement
  /** column 은 가로, row 는 세로, box 는 가로 정렬. */
  cross: Align
}

export interface NodeStyle {
  width: Size
  height: Size
  fill: Fill
  border: boolean
  radius: number
}

export type ElementKind = MockupElement['kind']

/**
 * 문서 요소를 어떤 UI 로 보일지. 의미(무엇이 있는가)는 문서가 정하고 모양만 고른다.
 * - 목록: `table` 표(기본) · `cards` 카드 격자 · `list` 한 줄 목록
 * - 버튼: `primary` · `secondary` · `ghost` · `link`. 없으면 행동이 있는 버튼이 주 버튼이다.
 */
export type ListAppearance = 'table' | 'cards' | 'list'
export type ButtonAppearance = 'primary' | 'secondary' | 'ghost' | 'link'
export type ElementAppearance = ListAppearance | ButtonAppearance

export interface ElementNode {
  type: 'element'
  /** `id:<요소 id>` 또는 id 가 없을 때 `path:<요소 경로>`. */
  ref: string
  kind: ElementKind
  style: NodeStyle
  appearance?: ElementAppearance
  /** 머리글·영역·입력 그룹처럼 자식을 가진 요소만 둔다. */
  layout?: ContainerLayout
  children?: LayoutNode[]
}

export interface GroupNode {
  type: 'group'
  id: string
  style: NodeStyle
  layout: ContainerLayout
  children: LayoutNode[]
}

export type DesignKind =
  | 'text' | 'rectangle' | 'divider' | 'spacer' | 'image' | 'button'
  | 'badge' | 'avatar' | 'icon' | 'stat' | 'tabs' | 'progress' | 'search'
/** `display` 는 히어로 제목처럼 큰 글자. */
export type TextStyle = 'display' | 'title' | 'body' | 'caption'
export type TextTone = 'strong' | 'default' | 'muted'
export type ButtonVariant = 'primary' | 'secondary' | 'ghost'

/**
 * 문서에 없는 디자인 전용 노드. 히어로 영역의 큰 제목·이미지 자리·CTA 버튼처럼 기획 의미가 없는
 * 표현을 맡는다. 디자인 전용 버튼은 행동이 없다 — 행동이 있는 버튼은 문서에 선언한다.
 */
export interface DesignNode {
  type: 'design'
  id: string
  design: DesignKind
  style: NodeStyle
  /**
   * 텍스트의 내용, 버튼·배지의 이름, 이미지 자리의 설명, 아바타의 이름, 통계의 이름, 검색칸의 안내 문구.
   * 탭은 쉼표로 나눈 탭 이름이고 첫 탭이 선택된 탭이다.
   */
  text?: string
  /** 통계 카드의 값, 진행 막대의 퍼센트(0~100). 문서에 없는 자리 값이다. */
  value?: string
  textStyle?: TextStyle
  tone?: TextTone
  variant?: ButtonVariant
}

export type LayoutNode = ElementNode | GroupNode | DesignNode
export type ContainerNode = GroupNode | (ElementNode & { layout: ContainerLayout; children: LayoutNode[] })

export const ROOT_ID = 'root'

export function nodeKey(node: LayoutNode): string {
  return node.type === 'group' ? `group:${node.id}` : node.type === 'design' ? `design:${node.id}` : `element:${node.ref}`
}

export function isContainer(node: LayoutNode): node is ContainerNode {
  return node.type === 'group' || (node.type === 'element' && node.layout !== undefined && node.children !== undefined)
}

export function elementRef(element: MockupElement, path: string): string {
  return element.id === null ? `path:${path}` : `id:${element.id}`
}

/** 요소 종류별 기본 배치. 지금까지 목업이 그리던 모양과 같다. */
function defaultElementNode(element: MockupElement, path: string): ElementNode {
  const base = { type: 'element' as const, ref: elementRef(element, path), kind: element.kind }
  const style = (overrides: Partial<NodeStyle>): NodeStyle => ({ width: 'fill', height: 'hug', fill: 'none', border: false, radius: 0, ...overrides })
  switch (element.kind) {
    case 'header':
      return { ...base, style: style({ fill: 'raised' }), layout: { direction: 'row', gap: 12, paddingX: 16, paddingY: 12, main: 'start', cross: 'center' }, children: element.children.map((child, index) => defaultElementNode(child, `${path}.children.${index}`)) }
    case 'section':
      return { ...base, style: style({}), layout: { direction: 'column', gap: 12, paddingX: 16, paddingY: 12, main: 'start', cross: 'start' }, children: element.children.map((child, index) => defaultElementNode(child, `${path}.children.${index}`)) }
    case 'form':
      return { ...base, style: style({ fill: 'surface', border: true, radius: 6 }), layout: { direction: 'column', gap: 12, paddingX: 12, paddingY: 12, main: 'start', cross: 'start' }, children: element.inputs.map((child, index) => defaultElementNode(child, `${path}.inputs.${index}`)) }
    case 'heading':
    case 'button':
      return { ...base, style: style({ width: 'hug' }) }
    default:
      return { ...base, style: style({}) }
  }
}

export function defaultLayout(screen: ScreenMockup): GroupNode {
  return {
    type: 'group', id: ROOT_ID,
    style: { width: 'fill', height: 'fill', fill: 'none', border: false, radius: 0 },
    layout: { direction: 'column', gap: 0, paddingX: 0, paddingY: 0, main: 'start', cross: 'start' },
    children: screen.elements.map((element, index) => defaultElementNode(element, `elements.${index}`)),
  }
}

/** 선언된 요소 하나. 트리를 맞추고, 목업이 내용을 그리고, 기획 제안을 만들 때 쓴다. */
export interface DeclaredElement {
  ref: string
  element: MockupElement
  path: string
  /** 이 요소가 선언된 영역의 ref. 화면 최상위면 `null`. */
  owner: string | null
}

export function declaredElements(screen: ScreenMockup): Map<string, DeclaredElement> {
  const result = new Map<string, DeclaredElement>()
  const walk = (elements: MockupElement[], prefix: string, owner: string | null) => elements.forEach((element, index) => {
    const path = `${prefix}.${index}`
    const ref = elementRef(element, path)
    result.set(ref, { ref, element, path, owner })
    if (element.kind === 'header' || element.kind === 'section') walk(element.children, `${path}.children`, ref)
    if (element.kind === 'form') walk(element.inputs, `${path}.inputs`, ref)
  })
  walk(screen.elements, 'elements', null)
  return result
}

/**
 * 저장된 트리를 지금 문서에 맞춘다.
 *
 * - 문서에서 사라졌거나 종류가 바뀐 요소, 다른 영역으로 옮겨진 요소는 트리에서 뺀다.
 * - 비게 된 그룹은 지운다.
 * - 트리에 없는 요소는 자기 영역의 끝에 기본 배치로 붙인다.
 */
export function resolveLayout(screen: ScreenMockup, saved: LayoutNode | undefined): GroupNode {
  if (saved === undefined || saved.type !== 'group' || saved.id !== ROOT_ID) return defaultLayout(screen)
  const declared = declaredElements(screen)
  const placed = new Set<string>()
  /*
    자기 영역 밖에 놓인 요소. 자리는 지킬 수 없지만 고른 모양(표·카드·크기)까지 버리면 사람이나 AI 가
    고친 것이 소리 없이 사라진다. 모양을 기억했다가 자기 영역 끝에 붙일 때 입힌다.
  */
  const stray = new Map<string, Pick<ElementNode, 'style' | 'appearance'>>()
  const prune = (nodes: LayoutNode[], owner: string | null): LayoutNode[] => nodes.flatMap((node): LayoutNode[] => {
    if (node.type === 'design') return [node]
    // 빈 그룹도 남긴다. 사용자가 만든 프레임이고, 지우는 것도 사용자가 한다.
    if (node.type === 'group') return [{ ...node, children: prune(node.children, owner) }]
    const entry = declared.get(node.ref)
    if (entry !== undefined && entry.element.kind === node.kind && entry.owner !== owner && !placed.has(node.ref)) {
      stray.set(node.ref, { style: node.style, ...(node.appearance === undefined ? {} : { appearance: node.appearance }) })
    }
    if (entry === undefined || entry.element.kind !== node.kind || entry.owner !== owner || placed.has(node.ref)) return []
    placed.add(node.ref)
    const fallback = defaultElementNode(entry.element, entry.path)
    if (fallback.children === undefined) return [{ ...node, layout: undefined, children: undefined }]
    return [{ ...node, layout: node.layout ?? fallback.layout, children: prune(node.children ?? [], node.ref) }]
  })
  const root: GroupNode = { ...saved, children: prune(saved.children, null) }
  const containers = new Map<string | null, ContainerNode>([[null, root]])
  walkLayout(root, (node) => { if (node.type === 'element' && isContainer(node)) containers.set(node.ref, node) })
  for (const entry of declared.values()) {
    if (placed.has(entry.ref)) continue
    const parent = containers.get(entry.owner)
    if (parent === undefined) continue
    const restore = (child: ElementNode): ElementNode => ({
      ...child,
      ...stray.get(child.ref),
      ...(child.children === undefined ? {} : { children: child.children.map((grand) => grand.type === 'element' ? restore(grand) : grand) }),
    })
    // 새로 붙인 영역의 자식은 기본 배치에 이미 들어 있다. 밖에 놓였던 모양을 거기에 입힌다.
    const node = restore(defaultElementNode(entry.element, entry.path))
    parent.children.push(node)
    walkLayout(node, (child) => {
      if (child.type !== 'element') return
      placed.add(child.ref)
      if (isContainer(child)) containers.set(child.ref, child)
    })
  }
  return root
}

export function walkLayout(node: LayoutNode, visit: (node: LayoutNode, parent: ContainerNode | null) => void, parent: ContainerNode | null = null): void {
  visit(node, parent)
  if (isContainer(node)) for (const child of node.children) walkLayout(child, visit, node)
}

export function findNode(root: LayoutNode, key: string): LayoutNode | null {
  let found: LayoutNode | null = null
  walkLayout(root, (node) => { if (found === null && nodeKey(node) === key) found = node })
  return found
}

export function findParent(root: LayoutNode, key: string): ContainerNode | null {
  let found: ContainerNode | null = null
  walkLayout(root, (node, parent) => { if (found === null && nodeKey(node) === key) found = parent })
  return found
}

/** 노드가 속한 기획 영역. 요소 영역이면 그 ref, 화면 최상위면 `null`. */
export function semanticOwner(root: LayoutNode, key: string): string | null | undefined {
  const chain: LayoutNode[] = []
  const search = (node: LayoutNode): boolean => {
    if (nodeKey(node) === key) return true
    if (!isContainer(node)) return false
    chain.push(node)
    for (const child of node.children) if (search(child)) return true
    chain.pop()
    return false
  }
  if (!search(root)) return undefined
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const node = chain[index]!
    if (node.type === 'element') return node.ref
  }
  return null
}

/** 컨테이너 자신이 자식에게 주는 기획 영역. */
function ownerInside(root: LayoutNode, container: LayoutNode): string | null | undefined {
  return container.type === 'element' ? container.ref : semanticOwner(root, nodeKey(container))
}

function isDescendant(node: LayoutNode, key: string): boolean {
  let found = false
  walkLayout(node, (child) => { if (nodeKey(child) === key) found = true })
  return found
}

/** 안에 기획 요소가 하나도 없는 노드. 어느 영역으로든 옮길 수 있다. */
export function isDesignOnly(node: LayoutNode): boolean {
  let free = true
  walkLayout(node, (child) => { if (child.type === 'element') free = false })
  return free
}

export function canMove(root: LayoutNode, key: string, parentKey: string): boolean {
  const node = findNode(root, key)
  const parent = findNode(root, parentKey)
  if (node === null || parent === null || !isContainer(parent) || key === nodeKey(root)) return false
  if (isDescendant(node, parentKey)) return false
  return isDesignOnly(node) || semanticOwner(root, key) === ownerInside(root, parent)
}

function mapNode(node: LayoutNode, update: (node: LayoutNode) => LayoutNode): LayoutNode {
  const next = update(node)
  if (!isContainer(next)) return next
  return { ...next, children: next.children.map((child) => mapNode(child, update)) } as LayoutNode
}

function removeNode(root: GroupNode, key: string): GroupNode {
  return mapNode(root, (node) => isContainer(node) ? { ...node, children: node.children.filter((child) => nodeKey(child) !== key) } as LayoutNode : node) as GroupNode
}

/** `index` 는 노드를 뺀 뒤의 자식 목록 기준 자리다. */
export function moveNode(root: GroupNode, key: string, parentKey: string, index: number): GroupNode {
  if (!canMove(root, key, parentKey)) return root
  const node = findNode(root, key)!
  const without = removeNode(root, key)
  return mapNode(without, (candidate) => {
    if (nodeKey(candidate) !== parentKey || !isContainer(candidate)) return candidate
    const children = [...candidate.children]
    children.splice(Math.max(0, Math.min(index, children.length)), 0, node)
    return { ...candidate, children } as LayoutNode
  }) as GroupNode
}

/** 같은 부모 안에서 한 칸 앞이나 뒤로 옮긴다. */
export function shiftNode(root: GroupNode, key: string, offset: -1 | 1): GroupNode {
  const parent = findParent(root, key)
  if (parent === null) return root
  const index = parent.children.findIndex((child) => nodeKey(child) === key)
  const target = index + offset
  if (target < 0 || target >= parent.children.length) return root
  return moveNode(root, key, nodeKey(parent), target)
}

export function updateNode(root: GroupNode, key: string, update: { style?: Partial<NodeStyle>; layout?: Partial<ContainerLayout> }): GroupNode {
  return mapNode(root, (node) => {
    if (nodeKey(node) !== key) return node
    const style = { ...node.style, ...update.style }
    if (!isContainer(node) || update.layout === undefined) return { ...node, style } as LayoutNode
    return { ...node, style, layout: { ...node.layout, ...update.layout } } as LayoutNode
  }) as GroupNode
}

/**
 * 방향을 바꿔도 화면에서 보이는 정렬은 그대로 둔다. Row 는 주 축이 가로이고 Column·Box 는
 * 세로이므로, Row 와 나머지 사이를 오갈 때 두 축의 정렬을 맞바꾼다.
 */
export function changeDirection(layout: ContainerLayout, direction: Direction): ContainerLayout {
  if (layout.direction === direction) return layout
  const swap = (layout.direction === 'row') !== (direction === 'row')
  const main: Arrangement = swap ? layout.cross : layout.main
  const cross: Align = swap ? (layout.main === 'space-between' ? 'start' : layout.main) : layout.cross
  return { ...layout, direction, main: direction === 'box' && main === 'space-between' ? 'start' : main, cross }
}

/** 노드를 새 Column·Row·Box 그룹으로 감싼다. Figma 의 "자동 레이아웃 추가"(Shift+A). */
export function wrapNode(root: GroupNode, key: string, direction: Direction, newId: string): GroupNode {
  if (key === nodeKey(root)) return root
  const node = findNode(root, key)
  if (node === null) return root
  const group: GroupNode = {
    type: 'group', id: newId,
    style: { width: node.style.width === 'fill' ? 'fill' : 'hug', height: 'hug', fill: 'none', border: false, radius: 0 },
    layout: { direction, gap: 8, paddingX: 0, paddingY: 0, main: 'start', cross: direction === 'row' ? 'center' : 'start' },
    children: [node],
  }
  // 새 그룹 안에도 같은 노드가 있으므로 한 번만 바꾼다.
  let wrapped = false
  return mapNode(root, (candidate) => {
    if (wrapped || !isContainer(candidate) || !candidate.children.some((child) => nodeKey(child) === key)) return candidate
    wrapped = true
    return { ...candidate, children: candidate.children.map((child) => nodeKey(child) === key ? group : child) } as LayoutNode
  }) as GroupNode
}

/** 그룹을 풀고 자식을 그 자리에 놓는다. */
export function unwrapGroup(root: GroupNode, key: string): GroupNode {
  const node = findNode(root, key)
  if (node === null || node.type !== 'group' || key === nodeKey(root)) return root
  return mapNode(root, (candidate) => isContainer(candidate) ? { ...candidate, children: candidate.children.flatMap((child) => nodeKey(child) === key ? node.children : [child]) } as LayoutNode : candidate) as GroupNode
}

export function insertNode(root: GroupNode, node: LayoutNode, parentKey: string, index: number): GroupNode {
  let inserted = false
  return mapNode(root, (candidate) => {
    if (inserted || nodeKey(candidate) !== parentKey || !isContainer(candidate)) return candidate
    inserted = true
    const children = [...candidate.children]
    children.splice(Math.max(0, Math.min(index, children.length)), 0, node)
    return { ...candidate, children } as LayoutNode
  }) as GroupNode
}

/**
 * 디자인 노드와 그룹만 지운다. 그룹 안의 기획 요소는 지우지 않고 그룹 자리로 꺼낸다.
 * 기획 요소 자체를 지우는 것은 삭제 제안으로 한다.
 */
export function deleteNode(root: GroupNode, key: string): GroupNode {
  const node = findNode(root, key)
  if (node === null || node.type === 'element' || key === nodeKey(root)) return root
  const kept = node.type === 'group' ? node.children.filter((child) => !isDesignOnly(child)) : []
  return mapNode(root, (candidate) => isContainer(candidate) && candidate.children.some((child) => nodeKey(child) === key)
    ? { ...candidate, children: candidate.children.flatMap((child) => nodeKey(child) === key ? kept : [child]) } as LayoutNode
    : candidate) as GroupNode
}

export function newNodeId(root: LayoutNode, prefix: 'g' | 'd' = 'g'): string {
  const used = new Set<string>()
  walkLayout(root, (node) => { if (node.type !== 'element') used.add(node.id) })
  let index = used.size
  while (used.has(`${prefix}${index}`)) index += 1
  return `${prefix}${index}`
}

/** @deprecated `newNodeId` 와 같다. */
export const newGroupId = (root: LayoutNode) => newNodeId(root, 'g')

export function createGroup(direction: Direction, id: string): GroupNode {
  return {
    type: 'group', id,
    style: { width: 'fill', height: 'hug', fill: 'none', border: false, radius: 0 },
    layout: { direction, gap: 8, paddingX: 0, paddingY: 0, main: 'start', cross: direction === 'row' ? 'center' : 'start' },
    children: [],
  }
}

export function createDesignNode(design: DesignKind, id: string): DesignNode {
  const style = (overrides: Partial<NodeStyle>): NodeStyle => ({ width: 'hug', height: 'hug', fill: 'none', border: false, radius: 0, ...overrides })
  switch (design) {
    case 'text': return { type: 'design', id, design, text: '텍스트', textStyle: 'body', tone: 'default', style: style({}) }
    case 'rectangle': return { type: 'design', id, design, style: style({ width: 'fill', height: 120, fill: 'gray', radius: 4 }) }
    case 'divider': return { type: 'design', id, design, style: style({ width: 'fill' }) }
    case 'spacer': return { type: 'design', id, design, style: style({ width: 16, height: 16 }) }
    case 'image': return { type: 'design', id, design, text: '이미지', style: style({ width: 'fill', height: 220, radius: 8 }) }
    case 'button': return { type: 'design', id, design, text: '버튼', variant: 'primary', style: style({}) }
    case 'badge': return { type: 'design', id, design, text: '배지', variant: 'secondary', style: style({}) }
    case 'avatar': return { type: 'design', id, design, text: '사용자', style: style({ width: 40, height: 40 }) }
    case 'icon': return { type: 'design', id, design, text: '아이콘', style: style({ width: 24, height: 24 }) }
    case 'stat': return { type: 'design', id, design, text: '지표 이름', value: '—', style: style({ width: 'fill' }) }
    case 'tabs': return { type: 'design', id, design, text: '전체, 진행 중, 완료', style: style({ width: 'fill' }) }
    case 'progress': return { type: 'design', id, design, text: '진행률', value: '60', style: style({ width: 'fill' }) }
    case 'search': return { type: 'design', id, design, text: '검색', style: style({ width: 'fill' }) }
  }
}

/** 카드 프레임. 테두리·모서리·안쪽 여백이 있는 Column 이다. 테마가 카드 그림자를 정한다. */
export function createCard(id: string): GroupNode {
  return {
    type: 'group', id,
    style: { width: 'fill', height: 'hug', fill: 'surface', border: true, radius: 12 },
    layout: { direction: 'column', gap: 8, paddingX: 20, paddingY: 20, main: 'start', cross: 'start' },
    children: [],
  }
}

export function updateDesign(root: GroupNode, key: string, patch: Partial<Pick<DesignNode, 'text' | 'textStyle' | 'tone' | 'variant' | 'value'>>): GroupNode {
  return mapNode(root, (node) => nodeKey(node) === key && node.type === 'design' ? { ...node, ...patch } : node) as GroupNode
}

export const DESIGN_LABEL: Record<DesignKind, string> = {
  text: '텍스트', rectangle: '사각형', divider: '구분선', spacer: '여백', image: '이미지', button: '버튼',
  badge: '배지', avatar: '아바타', icon: '아이콘', stat: '통계', tabs: '탭', progress: '진행 막대', search: '검색칸',
}

/** 요소 노드의 모양을 바꾼다. 목록은 표·카드·목록, 버튼은 주·보조·텍스트·링크. */
export function setAppearance(root: GroupNode, key: string, appearance: ElementAppearance | undefined): GroupNode {
  return mapNode(root, (node) => {
    if (nodeKey(node) !== key || node.type !== 'element') return node
    const next = { ...node }
    if (appearance === undefined) delete next.appearance
    else next.appearance = appearance
    return next
  }) as GroupNode
}

/* ---------- 섹션 템플릿 ---------- */

export type SectionTemplate = 'hero-center' | 'hero-split' | 'feature-grid' | 'cta-banner' | 'card-grid' | 'stats-row' | 'profile-card' | 'pricing' | 'tabs-panel'

export const SECTION_LABEL: Record<SectionTemplate, string> = {
  'hero-center': '히어로 · 가운데',
  'hero-split': '히어로 · 이미지 나란히',
  'feature-grid': '기능 소개 3칸',
  'cta-banner': '행동 유도 띠',
  'card-grid': '카드 격자 (이미지·제목·버튼)',
  'stats-row': '통계 카드 4칸',
  'profile-card': '프로필 카드',
  'pricing': '가격표 3단',
  'tabs-panel': '탭 + 검색 막대',
}

/** 트리에서 아직 쓰지 않은 id 를 차례로 낸다. 노드 여러 개를 한 번에 만들 때 겹치지 않게. */
export function idFactory(root: LayoutNode): (prefix: 'g' | 'd') => string {
  const used = new Set<string>()
  walkLayout(root, (node) => { if (node.type !== 'element') used.add(node.id) })
  return (prefix) => {
    let index = used.size
    while (used.has(`${prefix}${index}`)) index += 1
    used.add(`${prefix}${index}`)
    return `${prefix}${index}`
  }
}

/**
 * 자주 쓰는 랜딩 섹션을 디자인 전용 노드로 만든다. 기획 요소는 넣지 않는다 — 문구는 자리 문구이고
 * 사람이 고쳐 쓴다. 문서의 버튼·입력을 히어로 안에 두고 싶으면 같은 영역 안에서 끌어 넣는다.
 */
export function createSection(template: SectionTemplate, nextId: (prefix: 'g' | 'd') => string): GroupNode {
  const group = (direction: Direction, layout: Partial<ContainerLayout>, style: Partial<NodeStyle>, children: LayoutNode[]): GroupNode => ({
    type: 'group', id: nextId('g'),
    style: { width: 'fill', height: 'hug', fill: 'none', border: false, radius: 0, ...style },
    layout: { direction, gap: 12, paddingX: 0, paddingY: 0, main: 'start', cross: 'start', ...layout },
    children,
  })
  const text = (value: string, textStyle: TextStyle, tone: TextTone = 'default', style: Partial<NodeStyle> = {}): DesignNode => ({ type: 'design', id: nextId('d'), design: 'text', text: value, textStyle, tone, style: { width: 'hug', height: 'hug', fill: 'none', border: false, radius: 0, ...style } })
  const button = (value: string, variant: ButtonVariant): DesignNode => ({ type: 'design', id: nextId('d'), design: 'button', text: value, variant, style: { width: 'hug', height: 'hug', fill: 'none', border: false, radius: 0 } })
  const image = (value: string, height: number): DesignNode => ({ type: 'design', id: nextId('d'), design: 'image', text: value, style: { width: 'fill', height, fill: 'none', border: false, radius: 12 } })
  const design = (kind: DesignKind, value: string, extra: { variant?: ButtonVariant; value?: string; style?: Partial<NodeStyle> } = {}): DesignNode => {
    const node = createDesignNode(kind, nextId('d'))
    const withText = kind === 'rectangle' || kind === 'divider' || kind === 'spacer' ? {} : { text: value }
    return { ...node, ...withText, ...(extra.variant === undefined ? {} : { variant: extra.variant }), ...(extra.value === undefined ? {} : { value: extra.value }), style: { ...node.style, ...extra.style } }
  }
  const actions = () => group('row', { gap: 8, cross: 'center' }, { width: 'hug' }, [button('시작하기', 'primary'), button('더 알아보기', 'secondary')])
  switch (template) {
    case 'hero-center':
      return group('column', { gap: 16, paddingX: 32, paddingY: 64, cross: 'center' }, { fill: 'raised' }, [
        text('새 소식', 'caption', 'muted'),
        text('한 문장으로 말하는 가치 제안', 'display', 'strong'),
        text('누가 무엇을 얻는지 한두 줄로 설명합니다.', 'body', 'muted'),
        actions(),
      ])
    case 'hero-split':
      return group('row', { gap: 32, paddingX: 32, paddingY: 48, cross: 'center' }, {}, [
        group('column', { gap: 16 }, {}, [
          text('한 문장으로 말하는 가치 제안', 'display', 'strong'),
          text('누가 무엇을 얻는지 한두 줄로 설명합니다.', 'body', 'muted'),
          actions(),
        ]),
        image('대표 이미지', 280),
      ])
    case 'feature-grid': {
      const card = (title: string) => group('column', { gap: 8, paddingX: 20, paddingY: 20 }, { border: true, radius: 12 }, [
        { type: 'design', id: nextId('d'), design: 'rectangle', style: { width: 36, height: 36, fill: 'gray', border: false, radius: 8 } },
        text(title, 'title', 'strong'),
        text('이 기능이 해결하는 문제를 짧게 씁니다.', 'body', 'muted'),
      ])
      return group('column', { gap: 24, paddingX: 32, paddingY: 48, cross: 'center' }, {}, [
        text('주요 기능', 'title', 'strong'),
        group('row', { gap: 16 }, {}, [card('기능 하나'), card('기능 둘'), card('기능 셋')]),
      ])
    }
    case 'card-grid': {
      const card = (title: string) => group('column', { gap: 10, paddingX: 0, paddingY: 0 }, { border: true, radius: 12, fill: 'surface' }, [
        image('카드 이미지', 140),
        group('column', { gap: 6, paddingX: 16, paddingY: 12 }, {}, [
          design('badge', '분류', { variant: 'secondary' }),
          text(title, 'title', 'strong'),
          text('카드에 들어갈 짧은 설명입니다.', 'body', 'muted'),
          button('자세히', 'secondary'),
        ]),
      ])
      return group('row', { gap: 16, paddingX: 24, paddingY: 24 }, {}, [card('카드 제목 하나'), card('카드 제목 둘'), card('카드 제목 셋')])
    }
    case 'stats-row': {
      const stat = (label: string) => design('stat', label, { value: '—', style: { width: 'fill' } })
      return group('row', { gap: 12, paddingX: 24, paddingY: 16 }, {}, [stat('지표 하나'), stat('지표 둘'), stat('지표 셋'), stat('지표 넷')])
    }
    case 'profile-card':
      return group('row', { gap: 16, paddingX: 20, paddingY: 20, cross: 'center' }, { border: true, radius: 12, fill: 'surface' }, [
        design('avatar', '이름', { style: { width: 56, height: 56 } }),
        group('column', { gap: 4 }, {}, [text('이름', 'title', 'strong'), text('역할이나 소개 한 줄', 'body', 'muted')]),
        design('badge', '상태', { variant: 'primary' }),
      ])
    case 'pricing': {
      const tier = (name: string, featured: boolean) => group('column', { gap: 12, paddingX: 24, paddingY: 24 }, { border: true, radius: 12, fill: featured ? 'raised' : 'surface' }, [
        text(name, 'title', 'strong'),
        text('가격', 'display', 'strong'),
        design('divider', ''),
        text('포함 항목 하나', 'body', 'muted'),
        text('포함 항목 둘', 'body', 'muted'),
        button('선택하기', featured ? 'primary' : 'secondary'),
      ])
      return group('row', { gap: 16, paddingX: 24, paddingY: 32 }, {}, [tier('기본', false), tier('추천', true), tier('전문가', false)])
    }
    case 'tabs-panel':
      return group('column', { gap: 12, paddingX: 24, paddingY: 16 }, {}, [
        design('tabs', '전체, 진행 중, 완료'),
        design('search', '검색어를 입력하세요'),
      ])
    case 'cta-banner':
      return group('row', { gap: 16, paddingX: 32, paddingY: 28, main: 'space-between', cross: 'center' }, { fill: 'strong', radius: 12 }, [
        group('column', { gap: 4 }, { width: 'hug' }, [text('지금 바로 시작하세요', 'title', 'strong'), text('설치 없이 바로 써 볼 수 있습니다.', 'body', 'default')]),
        button('무료로 시작', 'primary'),
      ])
  }
}

/** 기획 제안·명세 패널이 쓰는 선택 정보. */
export function elementSelection(screen: ScreenMockup, entry: DeclaredElement, sourceHash?: string): ElementSelection {
  const { element, path } = entry
  return {
    screenKey: screen.key, elementId: element.id ?? undefined, elementPath: path, sourceHash, elementKind: element.kind,
    name: elementLabel(element),
    ...(element.kind === 'button' ? { actionId: element.actionId } : {}),
    ...(element.kind === 'input' ? { fieldId: element.field.id } : {}),
    ...(element.kind === 'list' ? { modelId: element.modelId, fieldIds: element.fields.map((field) => field.id) } : {}),
    ...(element.kind === 'heading' || element.kind === 'placeholder' ? { text: element.text } : {}),
  }
}

export const KIND_LABEL: Record<ElementKind, string> = {
  header: '머리글', section: '영역', heading: '제목', form: '입력 그룹', input: '입력', list: '목록', button: '버튼', placeholder: '자리표시자', unrecognized: '미지원 요소',
}

export const DIRECTION_LABEL: Record<Direction, string> = { column: 'Column', row: 'Row', box: 'Box' }

export function elementLabel(element: MockupElement): string {
  switch (element.kind) {
    case 'input': return element.field.name
    case 'list': return element.modelName
    case 'button': return element.name
    case 'heading':
    case 'placeholder': return element.text
    case 'unrecognized': return element.rawKind
    default: return KIND_LABEL[element.kind]
  }
}

/* ---------- 저장 형식 검사 ---------- */

const DIRECTIONS = new Set<string>(['column', 'row', 'box'])
const ARRANGEMENTS = new Set<string>(['start', 'center', 'end', 'space-between'])
const ALIGNS = new Set<string>(['start', 'center', 'end'])
const FILLS = new Set<string>(['none', 'surface', 'raised', 'gray', 'strong'])
const DESIGNS = new Set<string>(['text', 'rectangle', 'divider', 'spacer', 'image', 'button', 'badge', 'avatar', 'icon', 'stat', 'tabs', 'progress', 'search'])
const APPEARANCES = new Set<string>(['table', 'cards', 'list', 'primary', 'secondary', 'ghost', 'link'])
const KINDS = new Set<string>(Object.keys(KIND_LABEL))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function number(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

function parseSize(value: unknown, fallback: Size): Size {
  if (value === 'hug' || value === 'fill') return value
  return number(value, 1, 8000) ?? fallback
}

/*
  읽기는 너그럽게 한다. 사람이나 AI 가 파일을 직접 쓸 때 기본값을 빼먹어도 노드를 버리지 않고
  기본값으로 채운다. 쓰기는 언제나 모든 값을 채운 모양으로 한다.
*/
function parseStyle(value: unknown, defaults: NodeStyle): NodeStyle {
  if (!isRecord(value)) return defaults
  // 회색만 쓰기 전에 저장된 'accent' 는 회색으로 읽는다.
  const fill = value.fill === 'accent' ? 'gray' : value.fill
  return {
    width: parseSize(value.width, defaults.width),
    height: parseSize(value.height, defaults.height),
    fill: typeof fill === 'string' && FILLS.has(fill) ? fill as Fill : defaults.fill,
    border: typeof value.border === 'boolean' ? value.border : defaults.border,
    radius: number(value.radius, 0, 200) ?? defaults.radius,
  }
}

function parseContainer(value: unknown): ContainerLayout | null {
  if (!isRecord(value)) return null
  const direction = typeof value.direction === 'string' && DIRECTIONS.has(value.direction) ? value.direction as Direction : 'column'
  return {
    direction,
    gap: number(value.gap, 0, 400) ?? 0,
    paddingX: number(value.paddingX, 0, 400) ?? 0,
    paddingY: number(value.paddingY, 0, 400) ?? 0,
    main: typeof value.main === 'string' && ARRANGEMENTS.has(value.main) ? value.main as Arrangement : 'start',
    cross: typeof value.cross === 'string' && ALIGNS.has(value.cross) ? value.cross as Align : 'start',
  }
}

const HUG: NodeStyle = { width: 'hug', height: 'hug', fill: 'none', border: false, radius: 0 }
const FILL_WIDTH: NodeStyle = { ...HUG, width: 'fill' }

export function parseLayoutNode(value: unknown, depth = 0): LayoutNode | null {
  if (!isRecord(value) || depth > 32) return null
  const style = parseStyle(value.style, value.type === 'group' || value.type === 'element' ? FILL_WIDTH : HUG)
  const children = Array.isArray(value.children) ? value.children.map((child) => parseLayoutNode(child, depth + 1)).filter((child): child is LayoutNode => child !== null) : undefined
  if (value.type === 'group') {
    const layout = parseContainer(value.layout ?? {})
    if (typeof value.id !== 'string' || layout === null) return null
    return { type: 'group', id: value.id, style, layout, children: children ?? [] }
  }
  if (value.type === 'design' && typeof value.id === 'string' && typeof value.design === 'string' && DESIGNS.has(value.design)) {
    const node: DesignNode = { type: 'design', id: value.id, design: value.design as DesignKind, style }
    if (!['rectangle', 'divider', 'spacer'].includes(node.design)) {
      node.text = typeof value.text === 'string' ? value.text.slice(0, 2000) : node.design === 'text' ? '' : DESIGN_LABEL[node.design]
    }
    if ((node.design === 'stat' || node.design === 'progress') && (typeof value.value === 'string' || typeof value.value === 'number')) node.value = String(value.value).slice(0, 200)
    if (node.design === 'badge') node.variant = value.variant === 'primary' || value.variant === 'ghost' ? value.variant : 'secondary'
    if (node.design === 'text') {
      node.textStyle = value.textStyle === 'display' || value.textStyle === 'title' || value.textStyle === 'caption' ? value.textStyle : 'body'
      node.tone = value.tone === 'strong' || value.tone === 'muted' ? value.tone : 'default'
    }
    if (node.design === 'button') node.variant = value.variant === 'secondary' || value.variant === 'ghost' ? value.variant : 'primary'
    return node
  }
  if (value.type === 'element' && typeof value.ref === 'string' && typeof value.kind === 'string' && KINDS.has(value.kind)) {
    const layout = value.layout === undefined ? undefined : parseContainer(value.layout) ?? undefined
    const appearance = typeof value.appearance === 'string' && APPEARANCES.has(value.appearance) ? { appearance: value.appearance as ElementAppearance } : {}
    return { type: 'element', ref: value.ref, kind: value.kind as ElementKind, style, ...appearance, ...(layout === undefined ? {} : { layout, children: children ?? [] }) }
  }
  return null
}

export function parseLayouts(value: unknown): Record<string, LayoutNode> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([key, raw]) => {
    const node = parseLayoutNode(raw)
    return node === null ? [] : [[key, node]]
  }))
}
