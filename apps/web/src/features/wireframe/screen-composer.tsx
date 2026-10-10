'use client'

import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@dahaze/ui'

import type { AppShellModel } from '@/features/mockup/app-shell'
import { composeCode } from '@/features/mockup/compose-code'
import { reactCode } from '@/features/mockup/react-code'
import { UI_THEMES, UI_THEME_LABEL, type UiTheme } from '@/features/mockup/ui-theme'
import {
  canMove, changeDirection, createDesignNode, createSection, idFactory, SECTION_LABEL, isDesignOnly, createGroup, declaredElements, defaultLayout, deleteNode, DESIGN_LABEL, DIRECTION_LABEL, elementLabel, findNode, findParent, insertNode, isContainer, KIND_LABEL,
  moveNode, newNodeId, nodeKey, resolveLayout, shiftNode, unwrapGroup, updateDesign, updateNode, wrapNode,
  type Align, type Arrangement, type ContainerLayout, type DesignKind, type DesignNode, type Direction, type Fill, type GroupNode, type LayoutNode, type ButtonVariant, type SectionTemplate, type NodeStyle, type Size, type TextStyle, type TextTone,
} from '@/features/mockup/layout-tree'
import { FILL_BACKGROUND } from '@/features/mockup/layout-style'
import type { MockupDimensions } from '@/features/mockup/prototype-contract'
import { DEFAULT_VIEWPORT_DIMENSIONS, ScreenMockupFrame } from '@/features/mockup/screen-mockup'
import type { ScreenMockup } from '@/features/mockup/screen-layouts'

/**
 * 화면 하나를 Figma 처럼 고치는 편집기.
 *
 * 배치는 Jetpack Compose 의 Column · Row · Box 트리다. 왼쪽 레이어에서 구조를 보고, 가운데
 * 캔버스에서 고르고 끌어 순서를 바꾸고, 오른쪽에서 방향·정렬·간격·크기를 정한다. 같은 트리를
 * Compose 코드로도 볼 수 있다.
 *
 * 위쪽 도구 막대로 프레임(Column·Row·Box)과 디자인 전용 노드(텍스트·사각형·구분선·여백)를
 * 넣는다. 이것들은 배치 파일에만 있어 마음대로 옮기고 지운다. 기획 요소를 더하거나 지우거나
 * 다른 영역으로 옮기는 것은 기획 구조를 바꾸는 일이라 여기서 하지 않는다. 문서를 고치면(사람이든
 * AI 든) 컴파일 결과가 바뀌고 배치가 그것을 따라간다.
 *
 * 색은 회색 단계만 쓴다.
 */
export interface ScreenComposerProps {
  screen: ScreenMockup
  savedLayout: LayoutNode | undefined
  /** 화면을 둘러싼 앱 틀. 편집 대상은 아니고 맥락으로 보여준다. */
  shell?: AppShellModel | null
  /** 이 문서의 목업을 그릴 UI 프레임워크. 문서마다 하나다. */
  theme: UiTheme
  onThemeChange: (theme: UiTheme) => void
  onLayoutChange: (next: GroupNode) => void
  dimensions: MockupDimensions
  onDimensionsChange: (next: MockupDimensions) => void
  /** 화면을 선언한 원문 줄을 문서 뷰에서 연다. */
  onOpenSource: () => void
  /** 배치 파일이 이미 있으면 그것을 문서 뷰에서 연다. */
  onOpenLayoutFile?: () => void
  /** 저장 실패·충돌 안내. 편집기 위에 띄운다. */
  notice?: React.ReactNode
  onClose: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  saveLabel: string
}

type DropTarget = { parentKey: string; index: number; line: { left: number; top: number; width: number; height: number } }

const DEVICE_PRESETS = [
  { id: 'desktop', label: '데스크톱', ...DEFAULT_VIEWPORT_DIMENSIONS.desktop },
  { id: 'mobile', label: '모바일', ...DEFAULT_VIEWPORT_DIMENSIONS.mobile },
] as const

export function ScreenComposer(props: ScreenComposerProps) {
  const { screen, savedLayout, onLayoutChange, dimensions, onUndo, onRedo } = props
  const root = useMemo(() => resolveLayout(screen, savedLayout), [screen, savedLayout])
  const declared = useMemo(() => declaredElements(screen), [screen])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [tab, setTab] = useState<'design' | 'compose' | 'react'>('design')
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [fitScale, setFitScale] = useState(1)
  const canvasRef = useRef<HTMLDivElement>(null)
  const selected = selectedKey === null ? null : findNode(root, selectedKey)
  const scale = zoom === 'fit' ? fitScale : zoom

  useEffect(() => {
    const element = canvasRef.current
    if (element === null) return
    const measure = () => setFitScale(Math.min(1, (element.clientWidth - 64) / (dimensions.width + 2), (element.clientHeight - 64) / (dimensions.height + 2)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [dimensions.width, dimensions.height, tab])

  const apply = useCallback((next: GroupNode) => { if (next !== root) onLayoutChange(next) }, [onLayoutChange, root])
  /** Figma 처럼 고른 프레임 안 끝에, 프레임이 아니면 고른 노드 바로 뒤에 넣는다. */
  const insert = useCallback((node: LayoutNode) => {
    const target = selectedKey === null ? null : findNode(root, selectedKey)
    let parentKey = nodeKey(root)
    let index = root.children.length
    if (target !== null && isContainer(target)) { parentKey = nodeKey(target); index = target.children.length }
    else if (target !== null) {
      const parent = findParent(root, nodeKey(target))
      if (parent !== null) { parentKey = nodeKey(parent); index = parent.children.findIndex((child) => nodeKey(child) === nodeKey(target)) + 1 }
    }
    apply(insertNode(root, node, parentKey, index))
    setSelectedKey(nodeKey(node))
  }, [apply, root, selectedKey])
  const insertFrame = useCallback((direction: Direction) => insert(createGroup(direction, newNodeId(root, 'g'))), [insert, root])
  const insertDesign = useCallback((design: DesignKind) => insert(createDesignNode(design, newNodeId(root, 'd'))), [insert, root])
  /* 섹션은 고른 자리에 넣되, 아무것도 고르지 않았으면 화면 맨 위에 둔다. 히어로는 보통 첫 자리다. */
  const insertSection = useCallback((template: SectionTemplate) => {
    const section = createSection(template, idFactory(root))
    if (selectedKey !== null && selectedKey !== nodeKey(root)) { insert(section); return }
    apply(insertNode(root, section, nodeKey(root), 0))
    setSelectedKey(nodeKey(section))
  }, [apply, insert, root, selectedKey])
  const remove = useCallback((key: string) => {
    const parent = findParent(root, key)
    const next = deleteNode(root, key)
    if (next === root) return
    apply(next)
    setSelectedKey(parent === null ? null : nodeKey(parent))
  }, [apply, root])

  const wrap = useCallback((key: string, direction: Direction) => {
    const id = newNodeId(root, 'g')
    apply(wrapNode(root, key, direction, id))
    setSelectedKey(`group:${id}`)
  }, [apply, root])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target !== null && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) return
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) onRedo(); else onUndo(); return }
      if (meta && event.key.toLowerCase() === 'y') { event.preventDefault(); onRedo(); return }
      if (meta) return
      if (!event.shiftKey && !event.altKey) {
        const shortcut = ({ f: () => insertFrame('column'), t: () => insertDesign('text'), r: () => insertDesign('rectangle') } as Record<string, () => void>)[event.key.toLowerCase()]
        if (shortcut !== undefined) { event.preventDefault(); shortcut(); return }
      }
      if (selectedKey === null) return
      if (event.key === 'Escape') { event.preventDefault(); const parent = findParent(root, selectedKey); setSelectedKey(parent === null ? null : nodeKey(parent)); return }
      if (event.key === 'Enter') { const node = findNode(root, selectedKey); if (node !== null && isContainer(node) && node.children[0] !== undefined) { event.preventDefault(); setSelectedKey(nodeKey(node.children[0])) } return }
      if (event.shiftKey && event.key.toLowerCase() === 'a') { event.preventDefault(); wrap(selectedKey, 'column'); return }
      if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); remove(selectedKey); return }
      const offset = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 0
      if (offset !== 0) { event.preventDefault(); apply(shiftNode(root, selectedKey, offset)) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [apply, insertDesign, insertFrame, onRedo, onUndo, remove, root, selectedKey, wrap])

  /* ---------- 캔버스에서 끌어 순서 바꾸기 ---------- */
  const drag = useRef<{ key: string; x: number; y: number; active: boolean; pointerId: number } | null>(null)
  const suppressClick = useRef(false)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  // 포인터를 빨리 놓으면 상태가 갱신되기 전에 끝나므로 놓을 자리는 ref 에서 읽는다.
  const dropRef = useRef<DropTarget | null>(null)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)

  const findDropTarget = (key: string, x: number, y: number): DropTarget | null => {
    const canvas = canvasRef.current
    if (canvas === null) return null
    const stack = document.elementsFromPoint(x, y)
    for (const candidate of stack) {
      if (!(candidate instanceof HTMLElement) || !canvas.contains(candidate)) continue
      const container = candidate.closest<HTMLElement>('[data-node-key][data-layout]')
      if (container === null) continue
      let current: HTMLElement | null = container
      while (current !== null && canvas.contains(current)) {
        const parentKey = current.dataset.nodeKey
        if (parentKey !== undefined && current.dataset.layout !== undefined && canMove(root, key, parentKey)) return dropAt(canvas, current, parentKey, key, x, y)
        current = current.parentElement?.closest<HTMLElement>('[data-node-key][data-layout]') ?? null
      }
      return null
    }
    return null
  }

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || tab !== 'design') return
    const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-node-key]')
    if (hit === null) return
    const hitKey = hit.dataset.nodeKey!
    // 고른 노드 안을 잡으면 그 노드를 끈다. 화면 전체가 골라져 있으면 잡은 노드를 끈다.
    const selectedElement = selectedKey === null || selectedKey === nodeKey(root) ? null : canvasRef.current?.querySelector<HTMLElement>(`[data-node-key="${CSS.escape(selectedKey)}"]`)
    const key = selectedElement !== null && selectedElement !== undefined && selectedElement.contains(hit) ? selectedKey! : hitKey
    if (key === nodeKey(root)) return
    event.preventDefault()
    drag.current = { key, x: event.clientX, y: event.clientY, active: false, pointerId: event.pointerId }
  }
  const onCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current === null || current.pointerId !== event.pointerId) return
    if (!current.active) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return
      current.active = true
      setDraggingKey(current.key)
      setSelectedKey(current.key)
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    dropRef.current = findDropTarget(current.key, event.clientX, event.clientY)
    setDropTarget(dropRef.current)
  }
  const endDrag = (commit: boolean) => {
    const current = drag.current
    drag.current = null
    if (current?.active === true) {
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
      const target = dropRef.current
      if (commit && target !== null) apply(moveNode(root, current.key, target.parentKey, target.index))
    }
    dropRef.current = null
    setDropTarget(null)
    setDraggingKey(null)
  }

  const editor = useMemo(() => ({
    selectedKey, hoveredKey: draggingKey === null ? hoveredKey : null,
    onSelect: (key: string) => { if (suppressClick.current) { suppressClick.current = false; return } setSelectedKey(key) },
    onHover: setHoveredKey,
  }), [draggingKey, hoveredKey, selectedKey])

  const code = useMemo(() => (tab === 'react' ? reactCode(screen, root) : composeCode(screen, root)), [root, screen, tab])
  const [copied, setCopied] = useState(false)

  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <button type="button" className="rounded-md px-2 py-1 text-xs text-text-muted hover:bg-surface-raised" onClick={props.onClose}>← 화면 흐름</button>
      <h1 className="min-w-0 truncate text-sm font-semibold">{screen.screenName ?? screen.screenId}</h1>
      <div role="tablist" aria-label="편집기 보기" className="ml-2 flex gap-0.5 rounded-lg border bg-surface p-0.5">
        {([['design', '디자인'], ['compose', 'Compose'], ['react', 'React · shadcn']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className="rounded-md px-3 py-1 text-xs text-text-muted aria-selected:bg-surface-raised aria-selected:font-medium aria-selected:text-text" onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'design' ? <div role="toolbar" aria-label="넣기" className="flex items-center gap-0.5 rounded-lg border bg-surface p-0.5 text-xs">
        {([['column', '↓ Column', 'F'], ['row', '→ Row', null], ['box', '▣ Box', null]] as const).map(([direction, label, key]) => <button key={direction} type="button" title={`${DIRECTION_LABEL[direction]} 프레임 넣기${key === null ? '' : ` (${key})`}`} className="rounded-md px-2 py-1 text-text-muted hover:bg-surface-raised hover:text-text" onClick={() => insertFrame(direction)}>{label}</button>)}
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        {([['text', 'T 텍스트', 'T'], ['button', '▭ 버튼', null], ['image', '▨ 이미지', null], ['rectangle', '□ 사각형', 'R'], ['divider', '— 구분선', null], ['spacer', '↕ 여백', null]] as const).map(([design, label, key]) => <button key={design} type="button" title={`${DESIGN_LABEL[design]} 넣기 · 디자인 전용${key === null ? '' : ` (${key})`}`} className="rounded-md px-2 py-1 text-text-muted hover:bg-surface-raised hover:text-text" onClick={() => insertDesign(design)}>{label}</button>)}
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <select aria-label="섹션 넣기" value="" className="rounded-md bg-transparent px-1 py-1 text-text-muted hover:text-text" onChange={(event) => { if (event.target.value !== '') insertSection(event.target.value as SectionTemplate) }}>
          <option value="">＋ 섹션</option>
          {(Object.keys(SECTION_LABEL) as SectionTemplate[]).map((template) => <option key={template} value={template}>{SECTION_LABEL[template]}</option>)}
        </select>
      </div> : null}
      <div className="mr-auto" />
      <select aria-label="UI 스타일" title="이 문서의 목업을 그릴 UI 프레임워크" className="rounded-md border bg-surface px-2 py-1 text-xs" value={props.theme} onChange={(event) => props.onThemeChange(event.target.value as UiTheme)}>
        {UI_THEMES.map((theme) => <option key={theme} value={theme}>{UI_THEME_LABEL[theme]}</option>)}
      </select>
      <select aria-label="기기 크기" className="rounded-md border bg-surface px-2 py-1 text-xs" value={DEVICE_PRESETS.find((preset) => preset.width === dimensions.width && preset.height === dimensions.height)?.id ?? 'custom'} onChange={(event) => { const preset = DEVICE_PRESETS.find((entry) => entry.id === event.target.value); if (preset !== undefined) props.onDimensionsChange({ width: preset.width, height: preset.height }) }}>
        {DEVICE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} {preset.width}×{preset.height}</option>)}
        <option value="custom" disabled>사용자 지정 {dimensions.width}×{dimensions.height}</option>
      </select>
      <div className="flex items-center rounded-md border text-xs">
        <button type="button" aria-label="축소" className="px-2 py-1" onClick={() => setZoom(Math.max(0.1, Math.round((scale - 0.1) * 10) / 10))}>−</button>
        <button type="button" title="화면에 맞추기" className="w-12 py-1 tabular-nums" onClick={() => setZoom('fit')}>{Math.round(scale * 100)}%</button>
        <button type="button" aria-label="확대" className="px-2 py-1" onClick={() => setZoom(Math.min(3, Math.round((scale + 0.1) * 10) / 10))}>+</button>
      </div>
      <button type="button" aria-label="실행 취소" title="실행 취소 (⌘Z)" disabled={!props.canUndo} className="rounded-md border px-1.5 py-1 disabled:opacity-40" onClick={onUndo}><svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 3 2 6l3 3" /><path d="M2 6h7a4 4 0 0 1 0 8H7" /></svg></button>
      <button type="button" aria-label="다시 실행" title="다시 실행 (⌘⇧Z)" disabled={!props.canRedo} className="rounded-md border px-1.5 py-1 disabled:opacity-40" onClick={onRedo}><svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m11 3 3 3-3 3" /><path d="M14 6H7a4 4 0 0 0 0 8h2" /></svg></button>
      <span aria-live="polite" className="w-14 text-right text-xs text-text-subtle">{props.saveLabel}</span>
    </header>
    {props.notice}
    <div className="flex min-h-0 flex-1">
      <LayersPanel root={root} declared={declared} selectedKey={selectedKey} hoveredKey={hoveredKey} onSelect={setSelectedKey} onHover={setHoveredKey} onMove={(key, parentKey, index) => apply(moveNode(root, key, parentKey, index))} />
      {tab === 'design'
        ? <div
            ref={canvasRef}
            aria-label="화면 캔버스"
            className={cn('relative min-w-0 flex-1 overflow-auto bg-canvas select-none', draggingKey !== null && 'cursor-grabbing')}
            style={{ backgroundImage: 'radial-gradient(var(--color-border) 1px, transparent 1px)', backgroundSize: '16px 16px' }}
            onClick={() => { if (suppressClick.current) { suppressClick.current = false; return } setSelectedKey(null) }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={() => endDrag(true)}
            onPointerCancel={() => endDrag(false)}
            onPointerLeave={() => { if (drag.current === null) setHoveredKey(null) }}
            onWheel={(event) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); setZoom(Math.min(3, Math.max(0.1, scale * (event.deltaY < 0 ? 1.1 : 0.9)))) }}
          >
            <div className="p-8" style={{ width: (dimensions.width + 2) * scale + 64, height: (dimensions.height + 2) * scale + 64 }}>
              <div style={{ width: dimensions.width + 2, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="shadow-lg">
                <ScreenMockupFrame screen={screen} layout={root} dimensions={dimensions} showCaption={false} editor={editor} shell={props.shell} theme={props.theme} />
              </div>
            </div>
            {dropTarget === null ? null : <div aria-hidden className="pointer-events-none absolute z-30 rounded-full bg-text" style={dropTarget.line} />}
          </div>
        : <div className="relative min-w-0 flex-1 overflow-auto bg-surface-raised/40">
            <button type="button" className="absolute top-3 right-3 rounded-md border bg-surface px-2 py-1 text-xs" onClick={() => { void navigator.clipboard.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }) }}>{copied ? '복사함' : '복사'}</button>
            <pre aria-label={tab === 'react' ? 'React 코드' : 'Compose 코드'} className="p-4 pr-20 font-mono text-xs leading-relaxed text-text">{code}</pre>
          </div>}
      <PropertiesPanel {...props} root={root} declared={declared} selected={selected} canvasRef={canvasRef} apply={apply} wrap={wrap} onSelect={setSelectedKey} />
    </div>
  </div>
}

/** 컨테이너 안에서 포인터가 가리키는 자리와 그 자리를 보여줄 선. 좌표는 캔버스 스크롤 기준이다. */
function dropAt(canvas: HTMLElement, container: HTMLElement, parentKey: string, draggedKey: string, x: number, y: number): DropTarget {
  const direction = container.dataset.layout as Direction
  const children = [...container.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.dataset.nodeKey !== undefined && child.dataset.nodeKey !== draggedKey)
  const horizontal = direction === 'row'
  let index = children.length
  if (direction !== 'box') {
    index = children.findIndex((child) => {
      const rect = child.getBoundingClientRect()
      return horizontal ? x < rect.left + rect.width / 2 : y < rect.top + rect.height / 2
    })
    if (index === -1) index = children.length
  }
  const base = canvas.getBoundingClientRect()
  const toCanvas = (rect: DOMRect) => ({ left: rect.left - base.left + canvas.scrollLeft, top: rect.top - base.top + canvas.scrollTop, width: rect.width, height: rect.height })
  const box = toCanvas(container.getBoundingClientRect())
  const reference = children[index] ?? children[index - 1]
  if (reference === undefined) return { parentKey, index, line: horizontal ? { left: box.left + 4, top: box.top + 4, width: 2, height: Math.max(16, box.height - 8) } : { left: box.left + 4, top: box.top + 4, width: Math.max(16, box.width - 8), height: 2 } }
  const rect = toCanvas(reference.getBoundingClientRect())
  const after = children[index] === undefined
  return horizontal
    ? { parentKey, index, line: { left: (after ? rect.left + rect.width + 2 : rect.left - 3), top: rect.top, width: 2, height: rect.height } }
    : { parentKey, index, line: { left: rect.left, top: (after ? rect.top + rect.height + 2 : rect.top - 3), width: rect.width, height: 2 } }
}

/* ---------- 레이어 ---------- */

const DIRECTION_GLYPH: Record<Direction, string> = { column: '↓', row: '→', box: '▣' }
const KIND_GLYPH: Record<string, string> = { heading: 'H', button: '▭', input: '⌶', list: '≡', placeholder: '◌', unrecognized: '?' }
const DESIGN_GLYPH: Record<DesignKind, string> = { text: 'T', rectangle: '□', divider: '—', spacer: '↕', image: '▨', button: '▭' }

function nodeTitle(node: LayoutNode, declared: ReturnType<typeof declaredElements>): { glyph: string; title: string; detail: string | null } {
  if (node.type === 'group') return { glyph: DIRECTION_GLYPH[node.layout.direction], title: node.id === 'root' ? '화면' : DIRECTION_LABEL[node.layout.direction], detail: node.id === 'root' ? DIRECTION_LABEL[node.layout.direction] : '프레임' }
  if (node.type === 'design') return { glyph: DESIGN_GLYPH[node.design], title: (node.design === 'text' || node.design === 'button' || node.design === 'image') && node.text !== undefined && node.text.trim() !== '' ? node.text : DESIGN_LABEL[node.design], detail: '디자인' }
  const entry = declared.get(node.ref)
  const label = entry === undefined ? node.ref : elementLabel(entry.element)
  if (isContainer(node)) return { glyph: DIRECTION_GLYPH[node.layout.direction], title: label, detail: DIRECTION_LABEL[node.layout.direction] }
  return { glyph: KIND_GLYPH[node.kind] ?? '·', title: label, detail: KIND_LABEL[node.kind] }
}

function LayersPanel({ root, declared, selectedKey, hoveredKey, onSelect, onHover, onMove }: {
  root: GroupNode
  declared: ReturnType<typeof declaredElements>
  selectedKey: string | null
  hoveredKey: string | null
  onSelect: (key: string) => void
  onHover: (key: string | null) => void
  onMove: (key: string, parentKey: string, index: number) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [hint, setHint] = useState<{ key: string; position: 'before' | 'after' | 'inside' } | null>(null)

  const resolveDrop = (targetKey: string, position: 'before' | 'after' | 'inside'): { parentKey: string; index: number } | null => {
    if (dragKey === null || dragKey === targetKey) return null
    if (position === 'inside') {
      const target = findNode(root, targetKey)
      if (target === null || !isContainer(target) || !canMove(root, dragKey, targetKey)) return null
      return { parentKey: targetKey, index: target.children.filter((child) => nodeKey(child) !== dragKey).length }
    }
    const parent = findParent(root, targetKey)
    if (parent === null || !canMove(root, dragKey, nodeKey(parent))) return null
    const siblings = parent.children.filter((child) => nodeKey(child) !== dragKey)
    const index = siblings.findIndex((child) => nodeKey(child) === targetKey)
    return { parentKey: nodeKey(parent), index: position === 'after' ? index + 1 : index }
  }

  const row = (node: LayoutNode, depth: number): React.ReactNode => {
    const key = nodeKey(node)
    const { glyph, title, detail } = nodeTitle(node, declared)
    const container = isContainer(node)
    const open = !collapsed.has(key)
    const isRoot = key === nodeKey(root)
    return <li key={key} role="treeitem" aria-selected={selectedKey === key} aria-expanded={container ? open : undefined}>
      <div
        draggable={!isRoot}
        className={cn('relative flex h-7 cursor-default items-center gap-1 rounded pr-2 text-xs', selectedKey === key ? 'bg-surface-raised font-medium text-text' : hoveredKey === key ? 'bg-surface-raised/50' : 'text-text-muted', dragKey === key && 'opacity-40', hint?.key === key && hint.position === 'inside' && 'ring-1 ring-text-subtle')}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => onSelect(key)}
        onPointerEnter={() => onHover(key)}
        onPointerLeave={() => onHover(null)}
        onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); setDragKey(key) }}
        onDragEnd={() => { setDragKey(null); setHint(null) }}
        onDragOver={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const ratio = (event.clientY - rect.top) / rect.height
          const position = isRoot || (container && ratio > 0.3 && ratio < 0.7) ? 'inside' : ratio < 0.5 ? 'before' : 'after'
          if (resolveDrop(key, position) === null) { setHint(null); return }
          event.preventDefault()
          setHint({ key, position })
        }}
        onDrop={(event) => {
          event.preventDefault()
          const drop = hint === null || dragKey === null ? null : resolveDrop(hint.key, hint.position)
          if (drop !== null && dragKey !== null) onMove(dragKey, drop.parentKey, drop.index)
          setDragKey(null); setHint(null)
        }}
      >
        {container && !isRoot ? <button type="button" aria-label={open ? '접기' : '펼치기'} className="w-3 text-[10px] text-text-subtle" onClick={(event) => { event.stopPropagation(); setCollapsed((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next }) }}>{open ? '▾' : '▸'}</button> : <span className="w-3" />}
        <span aria-hidden className="w-4 text-center text-text-subtle">{glyph}</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {detail === null ? null : <span className="shrink-0 text-[10px] text-text-subtle">{detail}</span>}
        {hint?.key === key && hint.position !== 'inside' ? <span aria-hidden className={cn('pointer-events-none absolute right-1 h-0.5 rounded-full bg-text', hint.position === 'before' ? 'top-0' : 'bottom-0')} style={{ left: 6 + depth * 14 }} /> : null}
      </div>
      {container && open && node.children.length > 0 ? <ul role="group">{node.children.map((child) => row(child, depth + 1))}</ul> : null}
    </li>
  }

  return <aside aria-label="레이어" className="flex w-48 shrink-0 flex-col border-r bg-surface">
    <p className="px-3 pt-3 pb-2 text-xs font-semibold">레이어</p>
    <ul role="tree" aria-label="배치 트리" className="min-h-0 flex-1 overflow-auto px-1 pb-3">{row(root, 0)}</ul>
    <p className="border-t px-3 py-2 text-[10px] leading-relaxed text-text-subtle">F 프레임 · T 텍스트 · R 사각형 · ⇧A 감싸기 · ⌫ 삭제 · 방향키 순서 · Esc 상위</p>
  </aside>
}

/* ---------- 속성 ---------- */

function PropertiesPanel({ root, declared, selected, canvasRef, apply, wrap, onSelect, ...props }: ScreenComposerProps & {
  root: GroupNode
  declared: ReturnType<typeof declaredElements>
  selected: LayoutNode | null
  canvasRef: React.RefObject<HTMLDivElement | null>
  apply: (next: GroupNode) => void
  wrap: (key: string, direction: Direction) => void
  onSelect: (key: string | null) => void
}) {
  const node = selected ?? root
  const key = nodeKey(node)
  const isRoot = key === nodeKey(root)
  const { title, detail } = nodeTitle(node, declared)
  const setStyle = (style: Partial<NodeStyle>) => apply(updateNode(root, key, { style }))
  const setLayout = (layout: Partial<ContainerLayout>) => apply(updateNode(root, key, { layout }))
  const measure = (axis: 'width' | 'height') => {
    const element = canvasRef.current?.querySelector<HTMLElement>(`[data-node-key="${CSS.escape(key)}"]`)
    return element === null || element === undefined ? 120 : Math.max(1, Math.round(axis === 'width' ? element.offsetWidth : element.offsetHeight))
  }
  const entry = node.type === 'element' ? declared.get(node.ref) : undefined

  return <aside aria-label="속성" className="w-64 shrink-0 overflow-y-auto border-l bg-surface text-xs">
    <div className="flex items-baseline gap-2 border-b px-4 py-3">
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
      {detail === null ? null : <span className="shrink-0 text-text-subtle">{detail}</span>}
    </div>

    {isContainer(node) ? <Section title="자동 레이아웃">
      <Segmented label="방향" value={node.layout.direction} options={[['column', '↓ 세로'], ['row', '→ 가로'], ['box', '▣ 겹침']]} onChange={(direction) => setLayout(changeDirection(node.layout, direction))} />
      <div className="flex gap-3">
        <AlignmentGrid layout={node.layout} onChange={(main, cross) => setLayout({ main, cross })} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <NumberField label="간격" value={node.layout.gap} disabled={node.layout.main === 'space-between' || node.layout.direction === 'box'} onChange={(gap) => setLayout({ gap })} />
          {node.layout.direction === 'box' ? null : <label className="flex items-center gap-1.5"><input type="checkbox" checked={node.layout.main === 'space-between'} onChange={(event) => setLayout({ main: event.target.checked ? 'space-between' : 'start' })} />균등 분배</label>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="가로 여백" value={node.layout.paddingX} onChange={(paddingX) => setLayout({ paddingX })} />
        <NumberField label="세로 여백" value={node.layout.paddingY} onChange={(paddingY) => setLayout({ paddingY })} />
      </div>
    </Section> : null}

    {node.type === 'design' && node.design === 'text' ? <TextSection node={node} onChange={(patch) => apply(updateDesign(root, key, patch))} /> : null}
    {node.type === 'design' && node.design === 'button' ? <ButtonSection node={node} onChange={(patch) => apply(updateDesign(root, key, patch))} /> : null}
    {node.type === 'design' && node.design === 'image' ? <Section title="이미지"><label className="flex flex-col gap-1 text-text-muted">설명<input aria-label="이미지 설명" value={node.text ?? ''} className="rounded border bg-surface px-2 py-1 text-text" onChange={(event) => apply(updateDesign(root, key, { text: event.target.value }))} /></label><p className="text-text-subtle">디자인 전용 · 실제 이미지가 아니라 자리만 잡습니다.</p></Section> : null}

    {isRoot ? null : <Section title="크기">
      <SizeField label="너비" value={node.style.width} onChange={(width) => setStyle({ width })} measure={() => measure('width')} />
      <SizeField label="높이" value={node.style.height} onChange={(height) => setStyle({ height })} measure={() => measure('height')} />
    </Section>}

    {node.type === 'design' && (node.design === 'divider' || node.design === 'spacer') ? null : <Section title="모양">
      <div className="flex items-center gap-2">
        <span className="w-10 text-text-muted">배경</span>
        {(['none', 'surface', 'raised', 'gray', 'strong'] as Fill[]).map((fill) => <button key={fill} type="button" aria-label={`배경 ${FILL_NAME[fill]}`} aria-pressed={node.style.fill === fill} title={FILL_NAME[fill]} className="size-6 rounded border aria-pressed:ring-2 aria-pressed:ring-text" style={{ background: FILL_BACKGROUND[fill] ?? 'repeating-linear-gradient(45deg, transparent 0 4px, var(--color-border) 4px 5px)' }} onClick={() => setStyle({ fill })} />)}
      </div>
      <div className="grid grid-cols-2 items-end gap-2">
        <label className="flex items-center gap-1.5 pb-1.5"><input type="checkbox" checked={node.style.border} onChange={(event) => setStyle({ border: event.target.checked })} />테두리</label>
        <NumberField label="모서리" value={node.style.radius} max={200} onChange={(radius) => setStyle({ radius })} />
      </div>
    </Section>}

    {isRoot ? null : <Section title="정리">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="rounded border px-2 py-1" title="Shift+A" onClick={() => wrap(key, 'column')}>Column으로 감싸기</button>
        <button type="button" className="rounded border px-2 py-1" onClick={() => wrap(key, 'row')}>Row로 감싸기</button>
        {node.type === 'group' ? <button type="button" className="rounded border px-2 py-1" onClick={() => { const parent = findParent(root, key); apply(unwrapGroup(root, key)); onSelect(parent === null ? null : nodeKey(parent)) }}>그룹 해제</button> : null}
        {node.type === 'element' ? null : <button type="button" className="rounded border px-2 py-1" title="Delete" onClick={() => { const parent = findParent(root, key); apply(deleteNode(root, key)); onSelect(parent === null ? null : nodeKey(parent)) }}>삭제</button>}
      </div>
      {node.type === 'group' && !isDesignOnly(node) ? <p className="text-text-subtle">삭제해도 안의 기획 요소는 남습니다.</p> : null}
    </Section>}

    {entry !== undefined ? <Section title="기획 요소">
      <p className="text-text-muted">{KIND_LABEL[entry.element.kind]} · {elementLabel(entry.element)}{entry.element.id === null ? null : <span className="ml-1 font-mono text-text-subtle">{entry.element.id}</span>}</p>
      {entry.element.id === null ? <p className="text-diagnostic-warning">요소 ID가 없어 문서가 바뀌면 이 배치가 풀릴 수 있어요. 문서에서 요소에 ID를 붙여 주세요.</p> : null}
      <p className="text-text-subtle">요소를 더하거나 지우거나 다른 영역으로 옮기려면 문서를 고치세요. 여기서는 선언된 영역 안의 순서와 모양만 바꿉니다.</p>
      <button type="button" className="rounded border px-2 py-1" onClick={props.onOpenSource}>원문 열기</button>
    </Section> : null}

    {isRoot ? <Section title="화면">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="rounded border px-2 py-1" onClick={props.onOpenSource}>원문 열기</button>
        {props.onOpenLayoutFile === undefined ? null : <button type="button" className="rounded border px-2 py-1" onClick={props.onOpenLayoutFile}>배치 파일 열기</button>}
        <button type="button" className="rounded border px-2 py-1" onClick={() => { apply(defaultLayout(props.screen)); onSelect(null) }}>배치 초기화</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="화면 너비" value={props.dimensions.width} min={240} max={7680} onChange={(width) => props.onDimensionsChange({ ...props.dimensions, width })} />
        <NumberField label="화면 높이" value={props.dimensions.height} min={320} max={4320} onChange={(height) => props.onDimensionsChange({ ...props.dimensions, height })} />
      </div>
    </Section> : null}
  </aside>
}

const FILL_NAME: Record<Fill, string> = { none: '없음', surface: '흰색', raised: '밝은 회색', gray: '회색', strong: '진한 회색' }

function TextSection({ node, onChange }: { node: DesignNode; onChange: (patch: Partial<Pick<DesignNode, 'text' | 'textStyle' | 'tone'>>) => void }) {
  return <Section title="텍스트">
    <textarea aria-label="텍스트 내용" rows={3} value={node.text ?? ''} className="w-full resize-y rounded border bg-surface px-2 py-1.5 text-text" onChange={(event) => onChange({ text: event.target.value })} />
    <Segmented<TextStyle> label="글자 크기" value={node.textStyle ?? 'body'} options={[['display', '큰 제목'], ['title', '제목'], ['body', '본문'], ['caption', '캡션']]} onChange={(textStyle) => onChange({ textStyle })} />
    <Segmented<TextTone> label="글자 색" value={node.tone ?? 'default'} options={[['strong', '진하게'], ['default', '보통'], ['muted', '흐리게']]} onChange={(tone) => onChange({ tone })} />
    <p className="text-text-subtle">디자인 전용 · 기획 문서에는 없는 문구입니다.</p>
  </Section>
}

function ButtonSection({ node, onChange }: { node: DesignNode; onChange: (patch: Partial<Pick<DesignNode, 'text' | 'variant'>>) => void }) {
  return <Section title="버튼">
    <input aria-label="버튼 이름" value={node.text ?? ''} className="w-full rounded border bg-surface px-2 py-1.5 text-text" onChange={(event) => onChange({ text: event.target.value })} />
    <Segmented<ButtonVariant> label="버튼 모양" value={node.variant ?? 'primary'} options={[['primary', '주 버튼'], ['secondary', '보조'], ['ghost', '텍스트']]} onChange={(variant) => onChange({ variant })} />
    <p className="text-text-subtle">디자인 전용 · 행동이 없습니다. 행동이 있는 버튼은 문서에 선언하세요.</p>
  </Section>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2.5 border-b px-4 py-3"><h3 className="font-semibold">{title}</h3>{children}</section>
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  return <div role="group" aria-label={label} className="flex gap-0.5 rounded-md border bg-surface-raised/40 p-0.5">
    {options.map(([id, text]) => <button key={id} type="button" aria-pressed={value === id} className="flex-1 rounded px-1.5 py-1 aria-pressed:bg-surface aria-pressed:font-medium aria-pressed:text-text aria-pressed:shadow-sm" onClick={() => onChange(id)}>{text}</button>)}
  </div>
}

const STEPS: Align[] = ['start', 'center', 'end']

/** Figma 의 정렬 상자. 칸 하나가 주 축·교차 축 정렬 한 쌍이다. */
function AlignmentGrid({ layout, onChange }: { layout: ContainerLayout; onChange: (main: Arrangement, cross: Align) => void }) {
  const spread = layout.main === 'space-between'
  return <div role="group" aria-label="정렬" className="grid size-[4.5rem] shrink-0 grid-cols-3 gap-0.5 rounded-md border bg-surface-raised/40 p-1">
    {STEPS.flatMap((vertical) => STEPS.map((horizontal) => {
      const main = layout.direction === 'row' ? horizontal : vertical
      const cross = layout.direction === 'row' ? vertical : horizontal
      const active = layout.cross === cross && (spread || layout.main === main)
      return <button key={`${vertical}-${horizontal}`} type="button" aria-label={`정렬 ${ALIGN_NAME[vertical]} ${ALIGN_NAME_H[horizontal]}`} aria-pressed={active} className="flex items-center justify-center rounded hover:bg-surface" onClick={() => onChange(spread ? 'space-between' : main, cross)}>
        <span className={cn('rounded-full', active ? 'size-2 bg-text' : 'size-1 bg-text-subtle')} />
      </button>
    }))}
  </div>
}

const ALIGN_NAME: Record<Align, string> = { start: '위', center: '가운데', end: '아래' }
const ALIGN_NAME_H: Record<Align, string> = { start: '왼쪽', center: '가운데', end: '오른쪽' }

function SizeField({ label, value, onChange, measure }: { label: string; value: Size; onChange: (value: Size) => void; measure: () => number }) {
  const mode = typeof value === 'number' ? 'fixed' : value
  return <div className="flex items-center gap-2">
    <span className="w-8 shrink-0 text-text-muted">{label}</span>
    <div className="min-w-0 flex-1"><Segmented label={`${label} 규칙`} value={mode} options={[['hug', '맞춤'], ['fill', '채우기'], ['fixed', '고정']]} onChange={(next) => onChange(next === 'fixed' ? measure() : next)} /></div>
    {typeof value === 'number' ? <input aria-label={`${label} px`} type="number" min={1} value={value} className="w-14 rounded border bg-surface px-1.5 py-1" onChange={(event) => { const number = event.target.valueAsNumber; if (Number.isFinite(number) && number >= 1) onChange(Math.min(8000, number)) }} /> : null}
  </div>
}

function NumberField({ label, value, onChange, min = 0, max = 400, disabled = false }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; disabled?: boolean }) {
  return <label className={cn('flex flex-col gap-1 text-text-muted', disabled && 'opacity-40')}>{label}
    <input type="number" min={min} max={max} value={value} disabled={disabled} className="w-full rounded border bg-surface px-2 py-1 text-text" onChange={(event) => { const number = event.target.valueAsNumber; if (Number.isFinite(number)) onChange(Math.min(max, Math.max(min, number))) }} />
  </label>
}
