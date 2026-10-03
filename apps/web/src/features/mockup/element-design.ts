import type { CSSProperties } from 'react'
import type { ElementDesign } from './prototype-contract'

/** Read the same presentation contract in the editor and prototype preview. */
export function parseElementDesigns(value: unknown): Record<string, ElementDesign> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([key, raw]) => {
    if (!isRecord(raw)) return []
    const design: ElementDesign = {}
    for (const field of ['x', 'y', 'width', 'height', 'gap'] as const) {
      const number = raw[field]
      if (typeof number === 'number' && Number.isFinite(number) && number >= (field === 'width' || field === 'height' ? 16 : 0)) design[field] = number
    }
    if (raw.layout === 'column' || raw.layout === 'row' || raw.layout === 'grid') design.layout = raw.layout
    return [[key, design]]
  }))
}

export function containerDesignStyle(design?: ElementDesign): CSSProperties {
  return {
    ...(design?.layout === undefined ? {} : {
      display: design.layout === 'grid' ? 'grid' : 'flex',
      flexDirection: design.layout === 'row' ? 'row' : 'column',
      flexWrap: design.layout === 'row' ? 'wrap' : undefined,
      gridTemplateColumns: design.layout === 'grid' ? 'repeat(2, minmax(0, 1fr))' : undefined,
    }),
    gap: design?.gap,
    ...(design?.height === undefined ? {} : { minHeight: '100%' }),
  }
}

/** Pointer distances are browser pixels; saved values are unscaled CSS pixels. */
export function gestureDesign(start: ElementDesign & { x: number; y: number; width: number; height: number }, dx: number, dy: number, scale: number, kind: 'move' | 'resize', snap = true): ElementDesign {
  const unit = snap ? 8 : 1
  const round = (value: number, min: number) => Math.max(min, Math.round(value / unit) * unit)
  const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1
  return kind === 'move'
    ? { x: round(start.x + dx / zoom, 0), y: round(start.y + dy / zoom, 0), width: start.width, height: start.height }
    : { width: round(start.width + dx / zoom, 16), height: round(start.height + dy / zoom, 16) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
