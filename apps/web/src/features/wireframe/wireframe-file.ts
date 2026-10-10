import { parseLayoutNode } from '../mockup/layout-tree'
import { parseDesignSystem, type DesignSystem } from '../mockup/design-system'
import { sameDesign, type DesignState, type ScreenPosition } from './design-state'

/**
 * 작업 트리의 와이어프레임 배치 파일.
 *
 * 문서 `/주문/결제.rspdl` 의 화면 배치는 바로 옆 `/주문/결제.wireframe.json` 에 둔다. 배치는 기획
 * 의미가 아니라 표시 방식이므로 컴파일하지 않지만(서버가 `.rspdl` 만 컴파일러에 넘긴다), 같은
 * 작업 트리에 있어서 변경 목록·commit·diff·잠금을 그대로 탄다.
 *
 * ```json
 * {
 *   "version": 1,
 *   "system": { "tokens": { "primary": "#2563eb" }, "components": { "button": { "base": { ... } } } },
 *   "screens": {
 *     "<화면 id>": { "position": { "x": 0, "y": 0 }, "layout": { "type": "group", ... } }
 *   }
 * }
 * ```
 *
 * `system` 은 그 문서 목업의 디자인 시스템이다(`design-system.ts`). 예전 `theme`(UI 프레임워크 이름)은
 * 더 읽지 않고, 그 문서를 다시 쓸 때 지운다.
 *
 * 쓸 때는 **바꾼 화면 항목만** 고친다. 문서에 구문 오류가 있으면 그 문서의 화면이 컴파일 결과에서
 * 빠지는데, 그때 파일을 통째로 다시 쓰면 보이지 않는 화면의 배치가 지워진다. 모르는 키도 남긴다.
 */

export const WIREFRAME_VERSION = 1
const RSPDL_SUFFIX = '.rspdl'
const WIREFRAME_SUFFIX = '.wireframe.json'

export function isRspdlPath(path: string): boolean {
  return path.endsWith(RSPDL_SUFFIX)
}

export function isWireframePath(path: string): boolean {
  return path.endsWith(WIREFRAME_SUFFIX)
}

/** 문서 경로 → 그 문서의 배치 파일 경로. */
export function wireframePathFor(documentPath: string): string {
  return `${documentPath.slice(0, -RSPDL_SUFFIX.length)}${WIREFRAME_SUFFIX}`
}

/** 배치 파일 경로 → 문서 경로. */
export function documentPathFor(wireframePath: string): string {
  return `${wireframePath.slice(0, -WIREFRAME_SUFFIX.length)}${RSPDL_SUFFIX}`
}

/** 보드와 같은 화면 key. 트리 경로에는 `:` 이 없으므로 첫 `:` 에서 가를 수 있다. */
export function screenKey(documentPath: string, screenId: string): string {
  return `${documentPath}:${screenId}`
}

function splitScreenKey(key: string): { documentPath: string; screenId: string } | null {
  const at = key.indexOf(':')
  return at <= 0 ? null : { documentPath: key.slice(0, at), screenId: key.slice(at + 1) }
}

export interface WireframeFile {
  path: string
  text: string
}

export interface ParsedWireframes {
  design: DesignState
  /** 읽지 못한 파일. 고치기 전에는 그 파일에 쓰지 않는다 — 덮어쓰면 사람이 쓴 내용이 사라진다. */
  invalid: { path: string; reason: string }[]
}

/** 배치 파일들을 화면 key 마다 하나의 편집 상태로 모은다. */
export function parseWireframes(files: readonly WireframeFile[]): ParsedWireframes {
  const layouts: DesignState['layouts'] = {}
  const positions: DesignState['positions'] = {}
  const systems: Record<string, DesignSystem> = {}
  const invalid: ParsedWireframes['invalid'] = []
  for (const file of files) {
    const raw = parseRaw(file.text)
    if (raw === null) {
      invalid.push({ path: file.path, reason: 'JSON 객체가 아니에요' })
      continue
    }
    const documentPath = documentPathFor(file.path)
    const system = parseDesignSystem(raw.system)
    if (system !== undefined) systems[documentPath] = system
    for (const [screenId, entry] of Object.entries(screensOf(raw))) {
      if (!isRecord(entry)) continue
      const key = screenKey(documentPath, screenId)
      const layout = parseLayoutNode(entry.layout)
      if (layout !== null) layouts[key] = layout
      const position = parsePosition(entry.position)
      if (position !== null) positions[key] = position
    }
  }
  return { design: { layouts, positions, systems }, invalid }
}

export interface WireframeWrite {
  path: string
  /** 작업 트리에 아직 없는 파일이면 만든다. */
  exists: boolean
  text: string
}

/**
 * `base` 에서 `working` 으로 바뀐 화면만 각 문서의 배치 파일에 반영한다.
 *
 * `files` 는 서버에 있는 지금 파일들이다. 바뀐 화면이 없는 문서는 쓰지 않는다.
 */
export function wireframeWrites(
  files: readonly WireframeFile[],
  base: DesignState,
  working: DesignState,
): WireframeWrite[] {
  const changedByDocument = new Map<string, Set<string>>()
  const keys = new Set([
    ...Object.keys(base.layouts),
    ...Object.keys(working.layouts),
    ...Object.keys(base.positions),
    ...Object.keys(working.positions),
  ])
  for (const key of keys) {
    const before = pick(base, key)
    const after = pick(working, key)
    if (sameDesign(before, after)) continue
    const split = splitScreenKey(key)
    if (split === null) continue
    const changed = changedByDocument.get(split.documentPath) ?? new Set<string>()
    changed.add(split.screenId)
    changedByDocument.set(split.documentPath, changed)
  }
  const systemChanged = new Set<string>()
  for (const documentPath of new Set([...Object.keys(base.systems ?? {}), ...Object.keys(working.systems ?? {})])) {
    if (sameDesign({ layouts: {}, positions: {}, systems: { s: (base.systems ?? {})[documentPath] ?? {} } }, { layouts: {}, positions: {}, systems: { s: (working.systems ?? {})[documentPath] ?? {} } })) continue
    systemChanged.add(documentPath)
    if (!changedByDocument.has(documentPath)) changedByDocument.set(documentPath, new Set())
  }

  const byPath = new Map(files.map((file) => [file.path, file]))
  const writes: WireframeWrite[] = []
  for (const [documentPath, screenIds] of changedByDocument) {
    const path = wireframePathFor(documentPath)
    const existing = byPath.get(path)
    const raw = existing === undefined ? null : parseRaw(existing.text)
    if (existing !== undefined && raw === null) {
      throw new Error(`${path} 를 읽지 못해서 쓰지 않았어요. 파일을 먼저 고쳐 주세요.`)
    }
    const next: Record<string, unknown> = { version: WIREFRAME_VERSION, ...(raw ?? {}) }
    delete next.theme
    if (systemChanged.has(documentPath)) {
      const system = (working.systems ?? {})[documentPath]
      if (system === undefined || Object.keys(system).length === 0) delete next.system
      else next.system = system
    }
    const screens: Record<string, unknown> = { ...screensOf(raw ?? {}) }
    for (const screenId of [...screenIds].sort()) {
      const key = screenKey(documentPath, screenId)
      const previous = isRecord(screens[screenId]) ? screens[screenId] : {}
      const entry: Record<string, unknown> = { ...previous }
      delete entry.layout
      delete entry.position
      const position = working.positions[key]
      if (position !== undefined) entry.position = { x: Math.round(position.x), y: Math.round(position.y) }
      const layout = working.layouts[key]
      if (layout !== undefined) entry.layout = layout
      if (Object.keys(entry).length === 0) delete screens[screenId]
      else screens[screenId] = entry
    }
    next.screens = screens
    writes.push({ path, exists: existing !== undefined, text: `${JSON.stringify(next, null, 2)}\n` })
  }
  return writes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function pick(design: DesignState, key: string): DesignState {
  const layout = design.layouts[key]
  const position = design.positions[key]
  return {
    layouts: layout === undefined ? {} : { [key]: layout },
    positions: position === undefined ? {} : { [key]: position },
  }
}

function parseRaw(text: string): Record<string, unknown> | null {
  if (text.trim() === '') return {}
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function screensOf(raw: Record<string, unknown>): Record<string, unknown> {
  return isRecord(raw.screens) ? raw.screens : {}
}

function parsePosition(value: unknown): ScreenPosition | null {
  if (!isRecord(value)) return null
  const { x, y } = value
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y) ? { x, y } : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

