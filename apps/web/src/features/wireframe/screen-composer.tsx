'use client'

import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownIcon, ArrowRightIcon, CardIcon, ChevronDownIcon, ChevronUpIcon, ClickIcon, CodeIcon, cn, FileTextIcon, FrameBoxIcon, FrameColumnIcon, FrameRowIcon,
  FillHeightIcon, FillWidthIcon, GridIcon, HugHeightIcon, HugWidthIcon, ImageIcon, ListIcon, PaletteIcon, ParentIcon, PlusIcon, Popover, PopoverContent, PopoverTrigger,
  ResetIcon, RulerIcon, TableIcon, TextIcon, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, TrashIcon, UnwrapIcon, WarningIcon, WrapIcon, XIcon,
} from '@dahaze/ui'

import type { AppShellModel } from '@/features/mockup/app-shell'
import {
  canMove, changeDirection, componentOf, createCard, createDesignNode, createSection, effectiveLook, idFactory, SECTION_LABEL, isDesignOnly, createGroup, declaredElements, defaultLayout, deleteNode, DESIGN_LABEL, DIRECTION_LABEL, elementLabel, findNode, findParent, insertNode, isContainer, KIND_LABEL,
  moveNode, newNodeId, nodeKey, patchNode, resolveLayout, shiftNode, unwrapGroup, updateNode, wrapNode,
  type Align, type Arrangement, type AxisKey, type ContainerLayout, type DesignKind, type DesignNode, type Direction, type GroupNode, type LayoutNode, type NodePatch, type SectionTemplate, type NodeStyle, type Size,
} from '@/features/mockup/layout-tree'
import {
  COMPONENT_NAMES, COMPONENTS, componentStyles, cssToText, DEFAULT_TOKENS, isTokenName, resolvedTokens, systemVariables, TOKEN_GROUP_LABEL, textToCss,
  type ComponentName, type ComponentOverride, type Css, type DesignSystem, type TokenGroup,
} from '@/features/mockup/design-system'
import type { MockupDimensions } from '@/features/mockup/prototype-contract'
import { DesignPreview, ScreenMockupFrame } from '@/features/mockup/screen-mockup'
import type { ScreenMockup } from '@/features/mockup/screen-layouts'

/**
 * 화면 하나를 Figma 처럼 고치는 편집기.
 *
 * 배치는 Jetpack Compose 의 Column · Row · Box 트리다. 왼쪽 레이어에서 구조를 보고, 가운데
 * 캔버스에서 고르고 끌어 순서를 바꾸고, 오른쪽에서 방향·정렬·간격·크기와 겉모양을 정한다.
 *
 * 겉모양은 와이어프레임 디자인 시스템(`design-system.ts`)이 맡는다. 노드마다 컴포넌트의 축 값
 * (모양·크기·글자 색)을 고르고, 남는 것은 CSS 로 직접 쓴다. 문서 전체의 토큰과 컴포넌트 스타일은
 * 디자인 시스템 패널에서 바꾼다.
 *
 * 위쪽 도구 막대로 프레임(Column·Row·Box)과 디자인 전용 노드를 넣는다. 이것들은 배치 파일에만 있어
 * 마음대로 옮기고 지운다. 기획 요소를 더하거나 지우거나 다른 영역으로 옮기는 것은 기획 구조를 바꾸는
 * 일이라 여기서 하지 않는다. 문서를 고치면(사람이든 AI 든) 컴파일 결과가 바뀌고 배치가 그것을 따라간다.
 */
export interface ScreenComposerProps {
  screen: ScreenMockup
  savedLayout: LayoutNode | undefined
  /** 화면을 둘러싼 앱 틀. 편집 대상은 아니고 맥락으로 보여준다. */
  shell?: AppShellModel | null
  /** 이 문서의 디자인 시스템. 문서마다 하나다. 없으면 기본 회색 시스템이다. */
  system: DesignSystem | undefined
  onSystemChange: (system: DesignSystem | undefined) => void
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

export function ScreenComposer(props: ScreenComposerProps) {
  const { screen, savedLayout, onLayoutChange, dimensions, onUndo, onRedo } = props
  const root = useMemo(() => resolveLayout(screen, savedLayout), [screen, savedLayout])
  const declared = useMemo(() => declaredElements(screen), [screen])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [panel, setPanel] = useState<'properties' | 'system'>('properties')
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
  }, [dimensions.width, dimensions.height])

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
  const actions: NodeActions = {
    selectParent: (key) => { const parent = findParent(root, key); setSelectedKey(parent === null ? null : nodeKey(parent)) },
    shift: (key, offset) => apply(shiftNode(root, key, offset)),
    wrap: (key) => wrap(key, 'column'),
    unwrap: (key) => { const parent = findParent(root, key); apply(unwrapGroup(root, key)); setSelectedKey(parent === null ? null : nodeKey(parent)) },
    remove,
    openSource: props.onOpenSource,
  }

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
    if (event.button !== 0) return
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

  const tool = 'flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text'
  return <TooltipProvider delayDuration={150}><div className="flex h-full min-h-0 flex-col">
    <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <Tip label="화면 흐름으로"><button type="button" aria-label="화면 흐름으로" className={tool} onClick={props.onClose}>←</button></Tip>
      <h1 className="min-w-0 truncate text-sm font-semibold">{screen.screenName ?? screen.screenId}</h1>
      <div role="toolbar" aria-label="넣기" className="ml-2 flex items-center gap-0.5 rounded-lg border bg-surface p-0.5">
        <Tip label="Column 프레임 · F"><button type="button" aria-label="Column 프레임 넣기" className={tool} onClick={() => insertFrame('column')}><FrameColumnIcon /></button></Tip>
        <Tip label="Row 프레임"><button type="button" aria-label="Row 프레임 넣기" className={tool} onClick={() => insertFrame('row')}><FrameRowIcon /></button></Tip>
        <Tip label="Box 프레임 · 겹침"><button type="button" aria-label="Box 프레임 넣기" className={tool} onClick={() => insertFrame('box')}><FrameBoxIcon /></button></Tip>
        <Tip label="카드"><button type="button" aria-label="카드 넣기" className={tool} onClick={() => insert(createCard(newNodeId(root, 'g')))}><CardIcon /></button></Tip>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <Tip label="텍스트 · T"><button type="button" aria-label="텍스트 넣기" className={tool} onClick={() => insertDesign('text')}><TextIcon /></button></Tip>
        <Tip label="버튼"><button type="button" aria-label="버튼 넣기" className={tool} onClick={() => insertDesign('button')}><ClickIcon /></button></Tip>
        <Tip label="이미지"><button type="button" aria-label="이미지 넣기" className={tool} onClick={() => insertDesign('image')}><ImageIcon /></button></Tip>
        <ComponentPicker system={props.system} onPick={insertDesign} className={tool} />
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <SectionPicker onPick={insertSection} className={tool} />
      </div>
      <div className="mr-auto" />
      <Tip label="디자인 시스템 · 토큰과 컴포넌트 스타일"><button type="button" aria-label="디자인 시스템" aria-pressed={panel === 'system'} className={cn(tool, 'border aria-pressed:bg-surface-raised aria-pressed:text-text')} onClick={() => setPanel((current) => current === 'system' ? 'properties' : 'system')}><PaletteIcon /></button></Tip>
      <div className="flex items-center rounded-md border text-xs">
        <button type="button" aria-label="축소" className="px-2 py-1" onClick={() => setZoom(Math.max(0.1, Math.round((scale - 0.1) * 10) / 10))}>−</button>
        <Tip label="화면에 맞추기"><button type="button" aria-label="화면에 맞추기" className="w-12 py-1 tabular-nums" onClick={() => setZoom('fit')}>{Math.round(scale * 100)}%</button></Tip>
        <button type="button" aria-label="확대" className="px-2 py-1" onClick={() => setZoom(Math.min(3, Math.round((scale + 0.1) * 10) / 10))}>+</button>
      </div>
      <Tip label="실행 취소 · ⌘Z"><button type="button" aria-label="실행 취소" disabled={!props.canUndo} className="rounded-md border px-1.5 py-1 disabled:opacity-40" onClick={onUndo}><svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 3 2 6l3 3" /><path d="M2 6h7a4 4 0 0 1 0 8H7" /></svg></button></Tip>
      <Tip label="다시 실행 · ⌘⇧Z"><button type="button" aria-label="다시 실행" disabled={!props.canRedo} className="rounded-md border px-1.5 py-1 disabled:opacity-40" onClick={onRedo}><svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m11 3 3 3-3 3" /><path d="M14 6H7a4 4 0 0 0 0 8h2" /></svg></button></Tip>
      <SaveState label={props.saveLabel} />
    </header>
    {props.notice}
    <div className="flex min-h-0 flex-1">
      <LayersPanel root={root} declared={declared} selectedKey={selectedKey} hoveredKey={hoveredKey} onSelect={setSelectedKey} onHover={setHoveredKey} onMove={(key, parentKey, index) => apply(moveNode(root, key, parentKey, index))} onRemove={remove} />
      <div
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
                <ScreenMockupFrame screen={screen} layout={root} dimensions={dimensions} showCaption={false} editor={editor} shell={props.shell} system={props.system} />
              </div>
            </div>
            {dropTarget === null ? null : <div aria-hidden className="pointer-events-none absolute z-30 rounded-full bg-text" style={dropTarget.line} />}
          </div>
      {panel === 'system'
        ? <SystemPanel system={props.system} onChange={props.onSystemChange} onClose={() => setPanel('properties')} />
        : <PropertiesPanel {...props} root={root} declared={declared} selected={selected} canvasRef={canvasRef} apply={apply} actions={actions} onSelect={setSelectedKey} />}
    </div>
  </div></TooltipProvider>
}

/** 노드 하나에 할 수 있는 동작. 속성 패널 맨 위와 레이어 행이 함께 쓴다. */
interface NodeActions {
  selectParent: (key: string) => void
  shift: (key: string, offset: -1 | 1) => void
  wrap: (key: string) => void
  unwrap: (key: string) => void
  remove: (key: string) => void
  openSource: () => void
}

function Tip({ label, children, side = 'bottom' }: { label: React.ReactNode; children: React.ReactElement; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent side={side}>{label}</TooltipContent></Tooltip>
}

/** 저장 상태를 점 하나로. 글은 툴팁과 접근성 이름에 둔다. */
function SaveState({ label }: { label: string }) {
  const tone = label === '저장됨' ? 'bg-success' : label === '저장 대기' || label === '저장 중' ? 'animate-pulse bg-text-subtle' : 'bg-diagnostic-error'
  return <Tip label={label}><span role="status" aria-label={label} className="flex size-7 items-center justify-center"><span className={cn('size-2 rounded-full', tone)} /></span></Tip>
}

const PICKABLE: DesignKind[] = ['text', 'button', 'image', 'badge', 'avatar', 'icon', 'stat', 'tabs', 'progress', 'search', 'input', 'checkbox', 'switch', 'rectangle', 'divider', 'spacer']

/** 컴포넌트를 글 목록이 아니라 실제 모양으로 고른다. */
function ComponentPicker({ system, onPick, className }: { system: DesignSystem | undefined; onPick: (kind: DesignKind) => void; className: string }) {
  const [open, setOpen] = useState(false)
  return <Popover open={open} onOpenChange={setOpen}>
    <Tip label="컴포넌트"><PopoverTrigger asChild><button type="button" aria-label="컴포넌트 넣기" className={className}><PlusIcon /></button></PopoverTrigger></Tip>
    <PopoverContent align="start" className="w-[22rem] p-2">
      <div aria-label="컴포넌트" className="grid grid-cols-4 gap-1">
        {PICKABLE.map((kind) => <button key={kind} type="button" aria-label={`${DESIGN_LABEL[kind]} 넣기`} className="flex flex-col items-center gap-1 rounded-md border border-transparent p-1.5 hover:border-border hover:bg-surface-raised" onClick={() => { onPick(kind); setOpen(false) }}>
          <span className="flex h-10 w-full items-center justify-center overflow-hidden rounded bg-canvas"><DesignPreview node={pickerNode(kind)} system={system} className="scale-[0.8]" /></span>
          <span className="text-[10px] text-text-muted">{DESIGN_LABEL[kind]}</span>
        </button>)}
      </div>
    </PopoverContent>
  </Popover>
}

/** 고르기 칸에 맞는 작은 견본. */
function pickerNode(kind: DesignKind): DesignNode {
  const node = createDesignNode(kind, 'preview')
  const style = { width: 'hug' as const, height: 'hug' as const }
  switch (kind) {
    case 'text': return { ...node, text: 'Aa', variant: 'title', tone: 'strong', style }
    case 'button':
    case 'badge':
    case 'checkbox': return { ...node, text: 'Aa', style }
    case 'image': return { ...node, text: '', css: { width: 56, height: 32, minHeight: 0 }, style }
    case 'avatar': return { ...node, text: 'Aa', size: 'sm', style }
    case 'stat': return { ...node, text: 'KPI', value: '12', css: { padding: 6, gap: 0 }, parts: { value: { fontSize: 14 } }, style }
    case 'tabs': return { ...node, text: 'A, B', style }
    case 'progress': return { ...node, text: '', css: { width: 64 }, style }
    case 'search': return { ...node, text: '', css: { width: 72, minHeight: 24 }, style }
    case 'input': return { ...node, text: '', value: '', css: { width: 72 }, parts: { control: { minHeight: 24 } }, style }
    case 'switch': return { ...node, text: '', style }
    case 'rectangle': return { ...node, css: { width: 40, height: 24 }, style }
    case 'divider': return { ...node, css: { width: 56 }, style }
    case 'spacer': return { ...node, css: { width: 40, height: 16, outline: '1px dashed var(--color-border-strong)' }, style }
    default: return { ...node, style }
  }
}

function SectionPicker({ onPick, className }: { onPick: (template: SectionTemplate) => void; className: string }) {
  const [open, setOpen] = useState(false)
  return <Popover open={open} onOpenChange={setOpen}>
    <Tip label="섹션"><PopoverTrigger asChild><button type="button" aria-label="섹션 넣기" className={className}><GridIcon /></button></PopoverTrigger></Tip>
    <PopoverContent align="start" className="w-56 p-1">
      {(Object.keys(SECTION_LABEL) as SectionTemplate[]).map((template) => <button key={template} type="button" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-surface-raised" onClick={() => { onPick(template); setOpen(false) }}>{SECTION_LABEL[template]}</button>)}
    </PopoverContent>
  </Popover>
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

const SHORTCUTS = [['F', '프레임'], ['T', '텍스트'], ['R', '사각형'], ['⇧A', '감싸기'], ['⌫', '삭제'], ['↑↓', '순서'], ['Esc', '상위'], ['↵', '안으로']] as const

const DIRECTION_GLYPH: Record<Direction, string> = { column: '↓', row: '→', box: '▣' }
const KIND_GLYPH: Record<string, string> = { heading: 'H', button: '▭', input: '⌶', list: '≡', placeholder: '◌', unrecognized: '?' }
const DESIGN_GLYPH: Record<DesignKind, string> = { text: 'T', rectangle: '□', divider: '—', spacer: '↕', image: '▨', button: '▭', badge: '◖', avatar: '●', icon: '◇', stat: '#', tabs: '⊟', progress: '▬', search: '⌕', input: '⌶', checkbox: '☐', switch: '◐' }

function nodeTitle(node: LayoutNode, declared: ReturnType<typeof declaredElements>): { glyph: string; title: string; detail: string | null } {
  if (node.type === 'group') return { glyph: DIRECTION_GLYPH[node.layout.direction], title: node.id === 'root' ? '화면' : DIRECTION_LABEL[node.layout.direction], detail: node.id === 'root' ? DIRECTION_LABEL[node.layout.direction] : node.variant === undefined || node.variant === 'plain' ? '프레임' : COMPONENTS.frame.axes.variant!.options[node.variant]?.label ?? node.variant }
  if (node.type === 'design') return { glyph: DESIGN_GLYPH[node.design], title: node.text !== undefined && node.text.trim() !== '' ? node.text : DESIGN_LABEL[node.design], detail: DESIGN_LABEL[node.design] }
  const entry = declared.get(node.ref)
  const label = entry === undefined ? node.ref : elementLabel(entry.element)
  if (isContainer(node)) return { glyph: DIRECTION_GLYPH[node.layout.direction], title: label, detail: DIRECTION_LABEL[node.layout.direction] }
  return { glyph: KIND_GLYPH[node.kind] ?? '·', title: label, detail: KIND_LABEL[node.kind] }
}

function LayersPanel({ root, declared, selectedKey, hoveredKey, onSelect, onHover, onMove, onRemove }: {
  root: GroupNode
  declared: ReturnType<typeof declaredElements>
  selectedKey: string | null
  hoveredKey: string | null
  onSelect: (key: string) => void
  onHover: (key: string | null) => void
  onMove: (key: string, parentKey: string, index: number) => void
  onRemove: (key: string) => void
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
        {(selectedKey === key || hoveredKey === key) && !isRoot && node.type !== 'element'
          ? <button type="button" aria-label={`${title} 삭제`} title="삭제 · ⌫" className="flex size-5 shrink-0 items-center justify-center rounded text-text-subtle hover:bg-surface hover:text-diagnostic-error" onClick={(event) => { event.stopPropagation(); onRemove(key) }}><TrashIcon className="size-3.5" /></button>
          : detail === null ? null : <span className="shrink-0 text-[10px] text-text-subtle">{detail}</span>}
        {hint?.key === key && hint.position !== 'inside' ? <span aria-hidden className={cn('pointer-events-none absolute right-1 h-0.5 rounded-full bg-text', hint.position === 'before' ? 'top-0' : 'bottom-0')} style={{ left: 6 + depth * 14 }} /> : null}
      </div>
      {container && open && node.children.length > 0 ? <ul role="group">{node.children.map((child) => row(child, depth + 1))}</ul> : null}
    </li>
  }

  return <aside aria-label="레이어" className="flex w-48 shrink-0 flex-col border-r bg-surface">
    <div className="flex items-center px-3 pt-3 pb-2">
      <p className="flex-1 text-xs font-semibold">레이어</p>
      <Tip side="right" label={<span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-normal">{SHORTCUTS.map(([key, label]) => <React.Fragment key={key}><kbd className="font-mono">{key}</kbd><span>{label}</span></React.Fragment>)}</span>}>
        <span aria-label="단축키" className="flex size-5 items-center justify-center rounded border text-[10px] text-text-subtle">⌘</span>
      </Tip>
    </div>
    <ul role="tree" aria-label="배치 트리" className="min-h-0 flex-1 overflow-auto px-1 pb-3">{row(root, 0)}</ul>
  </aside>
}

/* ---------- 속성 ---------- */

function PropertiesPanel({ root, declared, selected, canvasRef, apply, actions, onSelect, ...props }: ScreenComposerProps & {
  root: GroupNode
  declared: ReturnType<typeof declaredElements>
  selected: LayoutNode | null
  canvasRef: React.RefObject<HTMLDivElement | null>
  apply: (next: GroupNode) => void
  actions: NodeActions
  onSelect: (key: string | null) => void
}) {
  const node = selected ?? root
  const key = nodeKey(node)
  const isRoot = key === nodeKey(root)
  const { glyph, title, detail } = nodeTitle(node, declared)
  const setStyle = (style: Partial<NodeStyle>) => apply(updateNode(root, key, { style }))
  const setLayout = (layout: Partial<ContainerLayout>) => apply(updateNode(root, key, { layout }))
  const patch = (next: NodePatch) => apply(patchNode(root, key, next))
  const measure = (axis: 'width' | 'height') => {
    const element = canvasRef.current?.querySelector<HTMLElement>(`[data-node-key="${CSS.escape(key)}"]`)
    return element === null || element === undefined ? 120 : Math.max(1, Math.round(axis === 'width' ? element.offsetWidth : element.offsetHeight))
  }
  const entry = node.type === 'element' ? declared.get(node.ref) : undefined
  const component = componentOf(node)
  const tokens = useMemo(() => Object.keys(resolvedTokens(props.system)), [props.system])
  const parent = isRoot ? null : findParent(root, key)
  const index = parent === null ? -1 : parent.children.findIndex((child) => nodeKey(child) === key)
  const vertical = parent?.layout.direction !== 'row'

  return <aside aria-label="속성" className="flex w-72 shrink-0 flex-col border-l bg-surface text-xs">
    <TokenList id="wf-token-values" tokens={tokens} />
    <div className="border-b px-3 pt-3 pb-2">
      <div className="flex items-center gap-2">
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded bg-surface-raised text-text-muted">{glyph}</span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        {detail === null ? null : <span className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-muted">{detail}</span>}
        {node.type === 'design' ? <Tip label="디자인 전용 · 문서에는 없는 요소"><span aria-label="디자인 전용" className="size-2.5 shrink-0 rounded-full border border-dashed border-text-subtle" /></Tip> : null}
      </div>
      {isRoot ? null : <div role="toolbar" aria-label="노드 동작" className="mt-2 flex items-center gap-0.5">
        <ActionButton label="상위 선택 · Esc" onClick={() => actions.selectParent(key)}><ParentIcon /></ActionButton>
        <ActionButton label={vertical ? '위로 · ↑' : '앞으로 · ←'} disabled={index <= 0} onClick={() => actions.shift(key, -1)}>{vertical ? <ChevronUpIcon /> : <span className="rotate-[-90deg]"><ChevronUpIcon /></span>}</ActionButton>
        <ActionButton label={vertical ? '아래로 · ↓' : '뒤로 · →'} disabled={parent === null || index >= parent.children.length - 1} onClick={() => actions.shift(key, 1)}>{vertical ? <ChevronDownIcon /> : <span className="rotate-[-90deg]"><ChevronDownIcon /></span>}</ActionButton>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <ActionButton label="프레임으로 감싸기 · ⇧A" onClick={() => actions.wrap(key)}><WrapIcon /></ActionButton>
        {node.type === 'group' ? <ActionButton label="프레임 풀기" onClick={() => actions.unwrap(key)}><UnwrapIcon /></ActionButton> : null}
        {node.type === 'element' ? <ActionButton label="원문 열기" onClick={actions.openSource}><CodeIcon /></ActionButton> : null}
        <span className="flex-1" />
        <ActionButton
          label={node.type === 'element' ? '문서 요소는 원문에서 지웁니다' : node.type === 'group' && !isDesignOnly(node) ? '삭제 · 안의 문서 요소는 남습니다 · ⌫' : '삭제 · ⌫'}
          disabled={node.type === 'element'}
          danger
          onClick={() => actions.remove(key)}
        ><TrashIcon /></ActionButton>
      </div>}
      {entry !== undefined ? <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-muted">
        <span className="rounded border px-1.5 py-0.5">{KIND_LABEL[entry.element.kind]}</span>
        {entry.element.id === null
          ? <Tip label="요소 ID가 없어 문서가 바뀌면 배치가 풀릴 수 있어요. 원문에서 ID를 붙여 주세요."><span className="flex items-center gap-1 text-diagnostic-warning"><WarningIcon className="size-3.5" />ID 없음</span></Tip>
          : <span className="truncate font-mono text-text-subtle">{entry.element.id}</span>}
      </div> : null}
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto">
      {node.type === 'design' ? <ContentSection node={node} onChange={patch} /> : null}

      {component === null ? null : <ComponentSection name={component} node={node} system={props.system} onChange={patch} />}

      {isContainer(node) ? <Section title="자동 레이아웃">
        <Segmented label="방향" value={node.layout.direction} options={[['column', <ArrowDownIcon key="c" />, '세로'], ['row', <ArrowRightIcon key="r" />, '가로'], ['box', <FrameBoxIcon key="b" />, '겹침']]} onChange={(direction) => setLayout(changeDirection(node.layout, direction))} />
        <div className="flex gap-3">
          <AlignmentGrid layout={node.layout} onChange={(main, cross) => setLayout({ main, cross })} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <NumberField label="간격" icon={node.layout.direction === 'row' ? '⇿' : '⇳'} value={node.layout.gap} disabled={node.layout.main === 'space-between' || node.layout.direction === 'box'} onChange={(gap) => setLayout({ gap })} />
            {node.layout.direction === 'box' ? null : <Tip label="균등 분배"><button type="button" aria-label="균등 분배" aria-pressed={node.layout.main === 'space-between'} className="flex h-7 items-center justify-center gap-1 rounded border text-text-subtle aria-pressed:border-text aria-pressed:bg-surface-raised aria-pressed:text-text" onClick={() => setLayout({ main: node.layout.main === 'space-between' ? 'start' : 'space-between' })}>
              <span className={cn('flex w-10 justify-between', node.layout.direction === 'column' && 'rotate-90')}><span className="h-3 w-1 rounded-sm bg-current" /><span className="h-3 w-1 rounded-sm bg-current" /><span className="h-3 w-1 rounded-sm bg-current" /></span>
            </button></Tip>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField label="가로 안쪽 여백" icon="↔" value={node.layout.paddingX} onChange={(paddingX) => setLayout({ paddingX })} />
          <NumberField label="세로 안쪽 여백" icon="↕" value={node.layout.paddingY} onChange={(paddingY) => setLayout({ paddingY })} />
        </div>
      </Section> : null}

      {isRoot ? null : <Section title="크기">
        <SizeField axis="width" value={node.style.width} onChange={(width) => setStyle({ width })} measure={() => measure('width')} />
        <SizeField axis="height" value={node.style.height} onChange={(height) => setStyle({ height })} measure={() => measure('height')} />
      </Section>}

      <StyleSection nodeKey={key} css={node.css} parts={component === null ? [] : Object.entries(COMPONENTS[component].parts).map(([name, part]) => [name, part.label] as const)} partCss={node.parts} onCss={(css) => patch({ css })} onPart={(name, css) => { const parts = { ...node.parts }; if (css === undefined) delete parts[name]; else parts[name] = css; patch({ parts }) }} />

      {isRoot ? <Section title="화면">
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField label="화면 너비" icon="W" value={props.dimensions.width} min={240} max={7680} onChange={(width) => props.onDimensionsChange({ ...props.dimensions, width })} />
          <NumberField label="화면 높이" icon="H" value={props.dimensions.height} min={320} max={4320} onChange={(height) => props.onDimensionsChange({ ...props.dimensions, height })} />
        </div>
        <div className="flex gap-0.5">
          <ActionButton label="원문 열기" onClick={props.onOpenSource}><CodeIcon /></ActionButton>
          {props.onOpenLayoutFile === undefined ? null : <ActionButton label="배치 파일 열기" onClick={props.onOpenLayoutFile}><FileTextIcon /></ActionButton>}
          <ActionButton label="배치 초기화" danger onClick={() => { apply(defaultLayout(props.screen)); onSelect(null) }}><ResetIcon /></ActionButton>
        </div>
      </Section> : null}
    </div>
  </aside>
}

function ActionButton({ label, onClick, disabled = false, danger = false, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return <Tip label={label}>
    {/* 막힌 버튼에도 툴팁이 뜨도록 감싼다. 막힌 이유가 곧 안내다. */}
    <span className="inline-flex">
      <button type="button" aria-label={label} disabled={disabled} className={cn('flex size-7 items-center justify-center rounded-md border border-transparent text-text-muted hover:border-border hover:bg-surface-raised hover:text-text disabled:pointer-events-none disabled:opacity-35', danger && 'hover:text-diagnostic-error')} onClick={onClick}>{children}</button>
    </span>
  </Tip>
}

/** CSS 값 칸에 토큰을 고를 수 있게 한다. */
function TokenList({ id, tokens }: { id: string; tokens: string[] }) {
  return <datalist id={id}>{tokens.map((token) => <option key={token} value={`$${token}`} />)}</datalist>
}

const CONTENT_FIELDS: Partial<Record<DesignKind, { text: string; multiline?: boolean; value?: string }>> = {
  text: { text: '내용', multiline: true },
  button: { text: '이름' },
  image: { text: '설명' },
  badge: { text: '이름' },
  avatar: { text: '이름' },
  icon: { text: '설명' },
  stat: { text: '지표 이름', value: '값' },
  tabs: { text: '탭1, 탭2, 탭3' },
  progress: { text: '이름', value: '0~100' },
  search: { text: '안내 문구' },
  input: { text: '라벨', value: '칸 안 안내 문구' },
  checkbox: { text: '라벨' },
  switch: { text: '라벨' },
}

function ContentSection({ node, onChange }: { node: DesignNode; onChange: (patch: NodePatch) => void }) {
  const fields = CONTENT_FIELDS[node.design]
  if (fields === undefined) return null
  const input = 'w-full rounded border bg-surface px-2 py-1.5 text-text placeholder:text-text-subtle'
  return <Section title="내용">
    {fields.multiline === true
      ? <textarea aria-label={fields.text} placeholder={fields.text} rows={3} value={node.text ?? ''} className={cn(input, 'resize-y')} onChange={(event) => onChange({ text: event.target.value })} />
      : <input aria-label={fields.text} placeholder={fields.text} value={node.text ?? ''} className={input} onChange={(event) => onChange({ text: event.target.value })} />}
    {fields.value === undefined ? null : <input aria-label={fields.value} placeholder={fields.value} value={node.value ?? ''} className={input} onChange={(event) => onChange({ value: event.target.value })} />}
  </Section>
}

/** 축 값을 미리보기 타일로 보여 줄 때 쓰는 디자인 노드 종류. 프레임·목록은 따로 그린다. */
const PREVIEW_KIND: Partial<Record<ComponentName, DesignKind>> = { text: 'text', button: 'button', badge: 'badge', field: 'input', tabs: 'tabs', avatar: 'avatar' }
const LIST_ICON: Record<string, React.ReactNode> = { table: <TableIcon className="size-5" />, cards: <GridIcon className="size-5" />, list: <ListIcon className="size-5" /> }

/** 컴포넌트 축. 글 대신 그 값으로 그린 실제 모양을 고른다. 고르지 않은 축은 기본값이다. */
function ComponentSection({ name, node, system, onChange }: { name: ComponentName; node: LayoutNode; system: DesignSystem | undefined; onChange: (patch: NodePatch) => void }) {
  const spec = COMPONENTS[name]
  const axes = Object.entries(spec.axes) as [AxisKey, (typeof spec.axes)[string]][]
  if (axes.length === 0) return null
  const effective = effectiveLook(node)
  return <Section title={spec.label}>
    {axes.map(([axisName, axis]) => {
      const chosen = node[axisName]
      const shown = chosen !== undefined && Object.hasOwn(axis.options, chosen) ? chosen : effective[axisName] ?? (node.type === 'element' && node.kind === 'button' && axisName === 'variant' ? undefined : axis.default)
      return <div key={axisName} role="radiogroup" aria-label={`${spec.label} ${axis.label}`} className="space-y-1">
        <div className="flex items-center text-[10px] text-text-subtle">
          <span className="flex-1">{axis.label}</span>
          {chosen === undefined ? null : <Tip label="기본으로"><button type="button" aria-label={`${axis.label} 기본으로`} className="rounded p-0.5 hover:bg-surface-raised hover:text-text" onClick={() => onChange({ [axisName]: null })}><ResetIcon className="size-3" /></button></Tip>}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {Object.entries(axis.options).map(([value, option]) => <Tip key={value} label={option.label}>
            <button type="button" role="radio" aria-checked={shown === value} aria-label={option.label} className={cn('flex h-11 items-center justify-center overflow-hidden rounded-md border bg-canvas hover:border-text-subtle', shown === value ? 'border-text ring-1 ring-text' : 'border-border', shown === value && chosen === undefined && 'border-dashed ring-0')} onClick={() => onChange({ [axisName]: value })}>
              <AxisPreview name={name} node={node} axis={axisName} value={value} system={system} />
            </button>
          </Tip>)}
        </div>
      </div>
    })}
  </Section>
}

function AxisPreview({ name, node, axis, value, system }: { name: ComponentName; node: LayoutNode; axis: AxisKey; value: string; system: DesignSystem | undefined }) {
  const look = { ...effectiveLook(node), [axis]: value }
  if (name === 'list') return <span className="text-text-muted">{LIST_ICON[value] ?? value}</span>
  if (name === 'frame') {
    const root = componentStyles(system, 'frame', look).root
    return <span aria-hidden style={systemVariables(system)} className="flex items-center justify-center bg-transparent"><span style={{ ...root, display: 'block', width: 34, height: 22, ...(value === 'plain' ? { outline: '1px dashed var(--color-border-strong)' } : {}) }} /></span>
  }
  const kind = PREVIEW_KIND[name]
  if (kind === undefined) return <span>{value}</span>
  const base = createDesignNode(kind, 'preview')
  const sample: DesignNode = {
    ...base, variant: look.variant, size: look.size, tone: look.tone, style: { width: 'hug', height: 'hug' },
    ...(kind === 'input' ? { text: '', value: 'Aa', css: { width: 64 } } : kind === 'tabs' ? { text: 'A, B' } : { text: 'Aa' }),
  }
  return <DesignPreview node={sample} system={system} className="scale-[0.75]" />
}

/** 자주 쓰는 속성. 이름 대신 그 속성을 그린 작은 견본으로 보인다. CSS 편집기와 같은 `css` 를 고친다. */
const QUICK_PROPERTIES: { property: string; label: string; glyph: React.ReactNode; color?: boolean }[] = [
  { property: 'background', label: '배경', color: true, glyph: <span className="size-3.5 rounded-sm bg-text-subtle" /> },
  { property: 'color', label: '글자색', color: true, glyph: <span className="text-[13px] leading-none font-bold underline decoration-2">A</span> },
  { property: 'border', label: '테두리', glyph: <span className="size-3.5 rounded-sm border-2 border-current" /> },
  { property: 'borderRadius', label: '모서리', glyph: <span className="size-3.5 rounded-tl-lg border-t-2 border-l-2 border-current" /> },
  { property: 'boxShadow', label: '그림자', glyph: <span className="size-3 rounded-sm border border-current shadow-[2px_2px_0_currentColor]" /> },
  { property: 'fontSize', label: '글자 크기', glyph: <span className="text-[11px] leading-none">A<span className="text-[7px]">a</span></span> },
  { property: 'fontWeight', label: '글자 굵기', glyph: <span className="text-[13px] leading-none font-black">B</span> },
  { property: 'opacity', label: '투명도', glyph: <span className="size-3.5 rounded-sm border border-current bg-[linear-gradient(135deg,currentColor_50%,transparent_50%)]" /> },
]

function StyleSection({ nodeKey: key, css, parts, partCss, onCss, onPart }: {
  nodeKey: string
  css: Css | undefined
  parts: readonly (readonly [string, string])[]
  partCss: Record<string, Css> | undefined
  onCss: (css: Css | undefined) => void
  onPart: (part: string, css: Css | undefined) => void
}) {
  const setProperty = (property: string, value: string) => {
    const next = { ...css }
    if (value.trim() === '') delete next[property]
    else next[property] = value
    onCss(Object.keys(next).length === 0 ? undefined : next)
  }
  return <Section title="스타일">
    <div className="grid grid-cols-2 gap-1.5">
      {QUICK_PROPERTIES.map(({ property, label, glyph, color }) => <label key={property} className="flex min-w-0 items-center gap-1.5 rounded border bg-surface px-1.5 focus-within:border-text-subtle">
        <Tip label={label}><span aria-hidden className="flex size-4 shrink-0 items-center justify-center text-text-subtle">{glyph}</span></Tip>
        {color === true && css?.[property] !== undefined ? <span aria-hidden className="size-3 shrink-0 rounded-sm border" style={{ background: previewValue(css[property]) }} /> : null}
        <input aria-label={label} list="wf-token-values" value={css?.[property] ?? ''} placeholder="—" className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[11px] outline-none placeholder:text-text-subtle" onChange={(event) => setProperty(property, event.target.value)} />
      </label>)}
    </div>
    <CssEditor key={`${key}:root`} label="CSS" value={css} onChange={onCss} />
    {parts.length === 0 ? null : <details className="space-y-2">
      <summary className="flex cursor-default items-center gap-1 text-text-muted"><CodeIcon className="size-3.5" />파트 <span className="text-text-subtle">{parts.length}</span></summary>
      {parts.map(([part, label]) => <CssEditor key={`${key}:${part}`} label={`${label} · ${part}`} value={partCss?.[part]} onChange={(next) => onPart(part, next)} />)}
    </details>}
  </Section>
}

/** 미리보기 칸. 토큰은 편집기 밖에서 풀리지 않으므로 목업 변수 대신 빗금으로 보인다. */
function previewValue(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined
  const text = String(value)
  return text.includes('$') ? 'repeating-linear-gradient(45deg, transparent 0 3px, var(--color-border) 3px 4px)' : text
}

/**
 * `속성: 값;` 을 쓰는 CSS 칸. 치는 동안에는 글을 그대로 두고, 읽을 수 있는 줄만 저장한다. 읽지 못한
 * 줄은 칸 테두리와 줄 수로 알린다. 칸을 떠나면 저장된 값을 보인다.
 */
function CssEditor({ label, value, onChange }: { label: string; value: Css | undefined; onChange: (css: Css | undefined) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? cssToText(value)
  const { errors } = textToCss(text)
  return <label className="flex flex-col gap-1 text-[10px] text-text-subtle">
    <span className="flex items-center gap-1">{label}{errors.length === 0 ? null : <Tip label={`읽지 못한 줄: ${errors.join(' · ')}`}><span className="flex items-center gap-0.5 text-diagnostic-warning"><WarningIcon className="size-3" />{errors.length}</span></Tip>}</span>
    <textarea
      aria-label={label}
      aria-invalid={errors.length > 0}
      rows={Math.min(10, Math.max(2, text.split('\n').length + 1))}
      spellCheck={false}
      value={text}
      placeholder={'background: $muted;\nborder-radius: 12px;'}
      className="w-full resize-y rounded border bg-surface px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text aria-invalid:border-diagnostic-warning"
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        setDraft(event.target.value)
        const parsed = textToCss(event.target.value).css
        onChange(Object.keys(parsed).length === 0 ? undefined : parsed)
      }}
    />
  </label>
}

/* ---------- 디자인 시스템 ---------- */

/**
 * 문서의 디자인 시스템. 토큰을 바꾸면 그 문서의 모든 화면이 따라오고, 컴포넌트 스타일을 바꾸면 그
 * 컴포넌트를 쓰는 모든 노드가 따라온다. 노드의 CSS 는 여전히 이것들보다 이긴다.
 */
function SystemPanel({ system, onChange, onClose }: { system: DesignSystem | undefined; onChange: (system: DesignSystem | undefined) => void; onClose: () => void }) {
  const tokens = system?.tokens ?? {}
  const [component, setComponent] = useState<ComponentName>('button')
  const [newToken, setNewToken] = useState('')
  const commit = (next: DesignSystem) => {
    const cleaned: DesignSystem = {}
    if (next.tokens !== undefined && Object.keys(next.tokens).length > 0) cleaned.tokens = next.tokens
    if (next.components !== undefined && Object.keys(next.components).length > 0) cleaned.components = next.components
    onChange(Object.keys(cleaned).length === 0 ? undefined : cleaned)
  }
  const setToken = (name: string, value: string | undefined) => {
    const next = { ...tokens }
    if (value === undefined || value.trim() === '') delete next[name]
    else next[name] = value
    commit({ ...system, tokens: next })
  }
  const override = system?.components?.[component] ?? {}
  const setOverride = (next: ComponentOverride) => {
    const components = { ...system?.components }
    const cleaned: ComponentOverride = {}
    if (next.base !== undefined) cleaned.base = next.base
    if (next.parts !== undefined && Object.keys(next.parts).length > 0) cleaned.parts = next.parts
    if (next.variants !== undefined) {
      const variants = Object.fromEntries(Object.entries(next.variants).filter(([, options]) => Object.keys(options).length > 0))
      if (Object.keys(variants).length > 0) cleaned.variants = variants
    }
    if (Object.keys(cleaned).length === 0) delete components[component]
    else components[component] = cleaned
    commit({ ...system, components })
  }
  const spec = COMPONENTS[component]
  const custom = Object.keys(tokens).filter((name) => !Object.hasOwn(DEFAULT_TOKENS, name))
  const allTokens = Object.keys(resolvedTokens(system))
  const preview = PREVIEW_KIND[component]
  const validName = isTokenName(newToken.trim()) && !Object.hasOwn(tokens, newToken.trim()) && !Object.hasOwn(DEFAULT_TOKENS, newToken.trim())

  return <aside aria-label="디자인 시스템" className="flex w-80 shrink-0 flex-col border-l bg-surface text-xs">
    <TokenList id="wf-token-values" tokens={allTokens} />
    <div className="flex items-center gap-1 border-b px-3 py-2.5">
      <PaletteIcon className="text-text-muted" />
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">디자인 시스템</h2>
      <ActionButton label="전부 기본값으로" danger disabled={system === undefined} onClick={() => onChange(undefined)}><ResetIcon /></ActionButton>
      <ActionButton label="닫기" onClick={onClose}><XIcon /></ActionButton>
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto">
      {(Object.keys(TOKEN_GROUP_LABEL) as TokenGroup[]).map((group) => <Section key={group} title={TOKEN_GROUP_LABEL[group]}>
        {Object.entries(DEFAULT_TOKENS).filter(([, token]) => token.group === group).map(([name, token]) => <TokenRow key={name} name={name} label={token.label} group={group} value={tokens[name]} fallback={token.value} onChange={(value) => setToken(name, value)} />)}
      </Section>)}

      <Section title="직접 만든 토큰">
        {custom.map((name) => <TokenRow key={name} name={name} label={name} group={/^#|^rgb|^hsl|^oklch/.test(tokens[name] ?? '') ? 'color' : 'font'} value={tokens[name]} fallback="" onChange={(value) => setToken(name, value)} />)}
        <form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); if (!validName) return; setToken(newToken.trim(), '#000000'); setNewToken('') }}>
          <input aria-label="새 토큰 이름" value={newToken} placeholder="brand-blue" pattern="[a-z][a-z0-9-]*" className="min-w-0 flex-1 rounded border bg-surface px-1.5 py-1 font-mono text-[11px] invalid:border-diagnostic-warning" onChange={(event) => setNewToken(event.target.value)} />
          <ActionButton label="토큰 더하기 · 영문 소문자·숫자·하이픈" disabled={!validName} onClick={() => { setToken(newToken.trim(), '#000000'); setNewToken('') }}><PlusIcon /></ActionButton>
        </form>
      </Section>

      <Section title="컴포넌트 스타일">
        <div className="grid grid-cols-4 gap-1">
          {COMPONENT_NAMES.map((name) => {
            const kind = PREVIEW_KIND[name] ?? (Object.entries(DESIGN_COMPONENT_OF).find(([, value]) => value === name)?.[0] as DesignKind | undefined)
            return <Tip key={name} label={COMPONENTS[name].label}>
              <button type="button" aria-label={COMPONENTS[name].label} aria-pressed={component === name} className="relative flex h-10 items-center justify-center overflow-hidden rounded-md border bg-canvas aria-pressed:border-text aria-pressed:ring-1 aria-pressed:ring-text" onClick={() => setComponent(name)}>
                {kind !== undefined ? <DesignPreview node={pickerNode(kind)} system={system} className="w-[90%] scale-[0.6]" /> : name === 'list' ? <TableIcon className="text-text-muted" /> : name === 'frame' ? <FrameColumnIcon className="text-text-muted" /> : <span className="text-[9px] text-text-muted">{COMPONENTS[name].label}</span>}
                {system?.components?.[name] === undefined ? null : <span aria-label="고침" className="absolute top-1 right-1 size-1.5 rounded-full bg-text" />}
              </button>
            </Tip>
          })}
        </div>
        {preview === undefined ? null : <div className="flex h-14 items-center justify-center rounded-md border bg-canvas"><DesignPreview node={{ ...pickerNode(preview), text: preview === 'input' ? '라벨' : 'Aa' }} system={system} /></div>}
        <details className="space-y-1">
          <summary className="cursor-default text-text-muted">기본</summary>
          <pre className="overflow-x-auto rounded bg-surface-raised p-2 font-mono text-[10px] leading-relaxed">{cssToText(spec.base) || '—'}</pre>
        </details>
        <CssEditor key={`${component}:base`} label="base" value={override.base} onChange={(base) => setOverride({ ...override, base })} />
        {Object.entries(spec.axes).map(([axisName, axis]) => Object.entries(axis.options).map(([option, value]) => <CssEditor key={`${component}:${axisName}:${option}`} label={`${axis.label} ${value.label} · ${axisName}.${option}`} value={override.variants?.[axisName]?.[option]} onChange={(css) => {
          const options = { ...override.variants?.[axisName] }
          if (css === undefined) delete options[option]
          else options[option] = css
          setOverride({ ...override, variants: { ...override.variants, [axisName]: options } })
        }} />))}
        {Object.entries(spec.parts).map(([part, value]) => <CssEditor key={`${component}:part:${part}`} label={`${value.label} · ${part}`} value={override.parts?.[part]} onChange={(css) => {
          const parts = { ...override.parts }
          if (css === undefined) delete parts[part]
          else parts[part] = css
          setOverride({ ...override, parts })
        }} />)}
      </Section>
    </div>
  </aside>
}

/** 디자인 노드 종류 → 컴포넌트. 컴포넌트 고르기 타일의 견본을 고를 때 쓴다. */
const DESIGN_COMPONENT_OF: Partial<Record<DesignKind, ComponentName>> = { image: 'image', icon: 'icon', stat: 'stat', progress: 'progress', search: 'search', checkbox: 'checkbox', switch: 'switch', divider: 'divider', spacer: 'spacer', rectangle: 'rectangle' }

/** 토큰 한 줄. 색은 견본, 모서리·그림자·글꼴·크기는 그 값으로 그린 견본을 보인다. */
function TokenRow({ name, label, group, value, fallback, onChange }: { name: string; label: string; group: TokenGroup; value: string | undefined; fallback: string; onChange: (value: string | undefined) => void }) {
  const hex = value !== undefined && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null
  const shown = `var(--wf-${name})`
  const swatch = group === 'color' ? { background: shown }
    : group === 'radius' ? { borderTop: '2px solid currentColor', borderLeft: '2px solid currentColor', borderTopLeftRadius: `min(${shown}, 12px)` }
      : group === 'shadow' ? { background: 'var(--color-surface)', boxShadow: shown, border: '1px solid var(--color-border)' }
        : undefined
  return <div className="flex items-center gap-1.5" style={{ [`--wf-${name}`]: value ?? fallback } as React.CSSProperties}>
    <Tip side="left" label={<span>{label} <code className="font-mono opacity-70">${name}</code></span>}>
      <span className="relative flex size-6 shrink-0 items-center justify-center rounded border text-text-muted" style={group === 'color' ? swatch : undefined}>
        {group === 'color' ? <input aria-label={`${label} 색 고르기`} type="color" value={hex ?? '#888888'} className="absolute inset-0 size-full cursor-default opacity-0" onChange={(event) => onChange(event.target.value)} />
          : group === 'font' ? <span style={{ fontFamily: shown }} className="text-[12px]">Aa</span>
            : group === 'text' ? <span style={{ fontSize: `min(${shown}, 18px)` }} className="leading-none">A</span>
              : <span className="size-3.5" style={swatch} />}
      </span>
    </Tip>
    <span className="w-16 shrink-0 truncate text-[11px] text-text-muted">{label}</span>
    <input aria-label={`${label} 값`} value={value ?? ''} placeholder={fallback.startsWith('var(') ? '—' : fallback} className="min-w-0 flex-1 rounded border bg-surface px-1.5 py-1 font-mono text-[11px] placeholder:text-text-subtle" onChange={(event) => onChange(event.target.value)} />
    {value === undefined ? <span className="size-5 shrink-0" /> : <button type="button" aria-label={`${label} 기본값으로`} className="flex size-5 shrink-0 items-center justify-center rounded text-text-subtle hover:bg-surface-raised hover:text-text" onClick={() => onChange(undefined)}><ResetIcon className="size-3" /></button>}
  </div>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2 border-b px-3 py-3"><h3 className="text-[11px] font-semibold text-text-muted">{title}</h3>{children}</section>
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, React.ReactNode, string])[]; onChange: (value: T) => void }) {
  return <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-md border bg-surface-raised/40 p-0.5">
    {options.map(([id, content, name]) => <Tip key={id} label={name}><button type="button" role="radio" aria-checked={value === id} aria-label={name} className="flex h-6 flex-1 items-center justify-center rounded text-text-muted aria-checked:bg-surface aria-checked:text-text aria-checked:shadow-sm" onClick={() => onChange(id)}>{content}</button></Tip>)}
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

/** 크기 규칙. 맞춤·채우기·고정을 화살표 그림으로 고른다. */
function SizeField({ axis, value, onChange, measure }: { axis: 'width' | 'height'; value: Size; onChange: (value: Size) => void; measure: () => number }) {
  const mode = typeof value === 'number' ? 'fixed' : value
  const name = axis === 'width' ? '너비' : '높이'
  return <div className="flex items-center gap-1.5">
    <span aria-hidden className="w-3 shrink-0 text-center font-mono text-[10px] text-text-subtle">{axis === 'width' ? 'W' : 'H'}</span>
    <div className="min-w-0 flex-1"><Segmented label={`${name} 규칙`} value={mode} options={[
      ['hug', axis === 'width' ? <HugWidthIcon key="h" /> : <HugHeightIcon key="h" />, `${name} 내용에 맞춤`],
      ['fill', axis === 'width' ? <FillWidthIcon key="f" /> : <FillHeightIcon key="f" />, `${name} 채우기`],
      ['fixed', <RulerIcon key="x" />, `${name} 고정`],
    ]} onChange={(next) => onChange(next === 'fixed' ? measure() : next)} /></div>
    {typeof value === 'number' ? <input aria-label={`${name} px`} type="number" min={1} value={value} className="w-14 rounded border bg-surface px-1.5 py-1" onChange={(event) => { const number = event.target.valueAsNumber; if (Number.isFinite(number) && number >= 1) onChange(Math.min(8000, number)) }} /> : null}
  </div>
}

/** 숫자 칸. 이름 대신 앞의 기호로 알리고, 이름은 툴팁과 접근성 이름에 둔다. */
function NumberField({ label, icon, value, onChange, min = 0, max = 400, disabled = false }: { label: string; icon: React.ReactNode; value: number; onChange: (value: number) => void; min?: number; max?: number; disabled?: boolean }) {
  return <Tip label={label}><label className={cn('flex h-7 min-w-0 items-center gap-1 rounded border bg-surface px-1.5 focus-within:border-text-subtle', disabled && 'opacity-40')}>
    <span aria-hidden className="w-3 shrink-0 text-center text-[11px] text-text-subtle">{icon}</span>
    <input aria-label={label} type="number" min={min} max={max} value={value} disabled={disabled} className="min-w-0 flex-1 bg-transparent text-text outline-none" onChange={(event) => { const number = event.target.valueAsNumber; if (Number.isFinite(number)) onChange(Math.min(max, Math.max(min, number))) }} />
  </label></Tip>
}
