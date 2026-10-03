'use client'

import * as React from 'react'
import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@dahaze/ui'
import { gestureDesign } from './element-design'
import type { DesignChange, ElementDesign, ElementSelection } from './prototype-contract'

interface Gesture {
  pointerId: number
  clientX: number
  clientY: number
  scale: number
  kind: 'move' | 'resize'
  start: ElementDesign & { x: number; y: number; width: number; height: number }
}

export function DesignElement({ selection, design, selected, editable, onSelect, onChange, children }: {
  selection: ElementSelection
  design?: ElementDesign
  selected: boolean
  editable: boolean
  onSelect?: (selection: ElementSelection) => void
  onChange?: (change: DesignChange) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [preview, setPreview] = useState<ElementDesign | null>(null)
  const shown = { ...design, ...preview }
  const free = shown.x !== undefined || shown.y !== undefined
  const canEdit = editable && onChange !== undefined
  const label = selection.name ?? selection.text ?? selection.fieldId ?? selection.modelId ?? selection.elementKind
  const begin = (event: PointerEvent<HTMLButtonElement>, kind: Gesture['kind']) => {
    if (event.button !== 0 || !canEdit || ref.current === null) return
    event.preventDefault()
    event.stopPropagation()
    const element = ref.current
    const rect = element.getBoundingClientRect()
    const parent = element.offsetParent as HTMLElement | null
    if (parent === null) return
    const parentRect = parent.getBoundingClientRect()
    const scale = parent.offsetWidth > 0 ? parentRect.width / parent.offsetWidth : 1
    gesture.current = {
      pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scale, kind,
      start: {
        x: design?.x ?? (rect.left - parentRect.left) / scale + parent.scrollLeft - parent.clientLeft,
        y: design?.y ?? (rect.top - parentRect.top) / scale + parent.scrollTop - parent.clientTop,
        width: element.offsetWidth, height: element.offsetHeight,
      },
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const patchFor = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current
    if (current === null || current.pointerId !== event.pointerId) return null
    return gestureDesign(current.start, event.clientX - current.clientX, event.clientY - current.clientY, current.scale, current.kind, !event.altKey)
  }
  const cancel = () => { gesture.current = null; setPreview(null) }
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    const patch = patchFor(event)
    const current = gesture.current
    cancel()
    if (patch !== null && current !== null && (event.clientX !== current.clientX || event.clientY !== current.clientY)) onChange?.({ binding: selection, patch })
  }
  const handles = {
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => { const patch = patchFor(event); if (patch !== null) setPreview(patch) },
    onPointerUp: finish,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
  }
  return <div
    ref={ref}
    data-element-path={selection.elementPath}
    data-design-position={free ? 'free' : 'flow'}
    tabIndex={editable && onSelect !== undefined ? 0 : undefined}
    aria-label={editable && onSelect !== undefined ? `기획 요소: ${label}` : undefined}
    className={cn('relative min-w-0', editable && onSelect !== undefined && 'nodrag', selected && 'ring-2 ring-accent')}
    style={{ position: free ? 'absolute' : 'relative', left: free ? shown.x ?? 0 : undefined, top: free ? shown.y ?? 0 : undefined, width: shown.width ?? (selection.elementKind === 'button' ? 'fit-content' : undefined), height: shown.height, flexShrink: shown.width !== undefined || shown.height !== undefined ? 0 : undefined, zIndex: selected ? 10 : undefined }}
    onClick={(event) => { if (!editable || onSelect === undefined) return; event.stopPropagation(); onSelect(selection) }}
    onKeyDown={(event) => {
      if (!editable || event.target !== event.currentTarget) return
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect?.(selection); return }
      if (!selected || !canEdit || !free) return
      const step = event.shiftKey ? 8 : 1
      const deltas: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      const delta = deltas[event.key]
      if (delta === undefined) return
      event.preventDefault(); event.stopPropagation()
      onChange?.({ binding: selection, patch: { x: Math.max(0, (shown.x ?? 0) + delta[0]), y: Math.max(0, (shown.y ?? 0) + delta[1]) } })
    }}
  >
    {children}
    {selected && canEdit ? <>
      <button type="button" aria-label="요소 드래그 이동" title="드래그로 이동 · 8px 맞춤 · Alt: 1px" className="nodrag nopan absolute top-0 right-0 z-20 cursor-move touch-none rounded border bg-surface px-2 py-1 text-[10px] shadow" onPointerDown={(event) => begin(event, 'move')} {...handles}>이동</button>
      <button type="button" aria-label="요소 드래그 크기 조절" title="드래그로 크기 조절" className="nodrag nopan absolute right-0 bottom-0 z-20 size-3 cursor-se-resize touch-none border border-accent bg-surface" onPointerDown={(event) => begin(event, 'resize')} {...handles} />
    </> : null}
  </div>
}
