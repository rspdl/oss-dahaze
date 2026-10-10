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

export interface ElementNode {
  type: 'element'
  /** `id:<요소 id>` 또는 id 가 없을 때 `path:<요소 경로>`. */
  ref: string
  kind: ElementKind
  style: NodeStyle
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

export type DesignKind = 'text' | 'rectangle' | 'divider' | 'spacer'
export type TextStyle = 'title' | 'body' | 'caption'
export type TextTone = 'strong' | 'default' | 'muted'

/** 문서에 없는 디자인 전용 노드. */
export interface DesignNode {
  type: 'design'
  id: string
  design: DesignKind
  style: NodeStyle
  text?: string
  textStyle?: TextStyle
  tone?: TextTone
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
  const prune = (nodes: LayoutNode[], owner: string | null): LayoutNode[] => nodes.flatMap((node): LayoutNode[] => {
    if (node.type === 'design') return [node]
    // 빈 그룹도 남긴다. 사용자가 만든 프레임이고, 지우는 것도 사용자가 한다.
    if (node.type === 'group') return [{ ...node, children: prune(node.children, owner) }]
    const entry = declared.get(node.ref)
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
    const node = defaultElementNode(entry.element, entry.path)
    parent.children.push(node)
    // 새로 붙인 영역의 자식은 기본 배치에 이미 들어 있다.
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
  }
}

export function updateDesign(root: GroupNode, key: string, patch: Partial<Pick<DesignNode, 'text' | 'textStyle' | 'tone'>>): GroupNode {
  return mapNode(root, (node) => nodeKey(node) === key && node.type === 'design' ? { ...node, ...patch } : node) as GroupNode
}

export const DESIGN_LABEL: Record<DesignKind, string> = { text: '텍스트', rectangle: '사각형', divider: '구분선', spacer: '여백' }

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
const DESIGNS = new Set<string>(['text', 'rectangle', 'divider', 'spacer'])
const KINDS = new Set<string>(Object.keys(KIND_LABEL))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function number(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

function parseSize(value: unknown): Size | null {
  if (value === 'hug' || value === 'fill') return value
  return number(value, 1, 8000)
}

function parseStyle(value: unknown): NodeStyle | null {
  if (!isRecord(value)) return null
  const width = parseSize(value.width)
  const height = parseSize(value.height)
  const radius = number(value.radius, 0, 200)
  // 회색만 쓰기 전에 저장된 'accent' 는 회색으로 읽는다.
  const fill = value.fill === 'accent' ? 'gray' : value.fill
  if (width === null || height === null || radius === null || typeof fill !== 'string' || !FILLS.has(fill) || typeof value.border !== 'boolean') return null
  return { width, height, fill: fill as Fill, border: value.border, radius }
}

function parseContainer(value: unknown): ContainerLayout | null {
  if (!isRecord(value)) return null
  const gap = number(value.gap, 0, 400)
  const paddingX = number(value.paddingX, 0, 400)
  const paddingY = number(value.paddingY, 0, 400)
  if (gap === null || paddingX === null || paddingY === null) return null
  if (typeof value.direction !== 'string' || !DIRECTIONS.has(value.direction) || typeof value.main !== 'string' || !ARRANGEMENTS.has(value.main) || typeof value.cross !== 'string' || !ALIGNS.has(value.cross)) return null
  return { direction: value.direction as Direction, gap, paddingX, paddingY, main: value.main as Arrangement, cross: value.cross as Align }
}

export function parseLayoutNode(value: unknown, depth = 0): LayoutNode | null {
  if (!isRecord(value) || depth > 32) return null
  const style = parseStyle(value.style)
  if (style === null) return null
  const children = Array.isArray(value.children) ? value.children.map((child) => parseLayoutNode(child, depth + 1)).filter((child): child is LayoutNode => child !== null) : undefined
  if (value.type === 'group') {
    const layout = parseContainer(value.layout)
    if (typeof value.id !== 'string' || layout === null) return null
    return { type: 'group', id: value.id, style, layout, children: children ?? [] }
  }
  if (value.type === 'design' && typeof value.id === 'string' && typeof value.design === 'string' && DESIGNS.has(value.design)) {
    const node: DesignNode = { type: 'design', id: value.id, design: value.design as DesignKind, style }
    if (node.design === 'text') {
      node.text = typeof value.text === 'string' ? value.text.slice(0, 2000) : ''
      node.textStyle = value.textStyle === 'title' || value.textStyle === 'caption' ? value.textStyle : 'body'
      node.tone = value.tone === 'strong' || value.tone === 'muted' ? value.tone : 'default'
    }
    return node
  }
  if (value.type === 'element' && typeof value.ref === 'string' && typeof value.kind === 'string' && KINDS.has(value.kind)) {
    const layout = value.layout === undefined ? undefined : parseContainer(value.layout) ?? undefined
    return { type: 'element', ref: value.ref, kind: value.kind as ElementKind, style, ...(layout === undefined ? {} : { layout, children: children ?? [] }) }
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
