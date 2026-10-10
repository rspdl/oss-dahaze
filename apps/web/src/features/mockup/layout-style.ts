import type { CSSProperties } from 'react'
import type { Align, Arrangement, ContainerLayout, Fill, NodeStyle } from './layout-tree'

const JUSTIFY: Record<Arrangement, CSSProperties['justifyContent']> = { start: 'flex-start', center: 'center', end: 'flex-end', 'space-between': 'space-between' }
const ALIGN: Record<Align, CSSProperties['alignItems']> = { start: 'flex-start', center: 'center', end: 'flex-end' }
const SELF: Record<Align | 'start' | 'center' | 'end' | 'space-between', CSSProperties['alignSelf']> = { start: 'start', center: 'center', end: 'end', 'space-between': 'start' }

export const FILL_BACKGROUND: Record<Fill, string | undefined> = {
  none: undefined,
  surface: 'var(--color-surface)',
  raised: 'var(--color-surface-raised)',
  gray: 'var(--color-border)',
  strong: 'var(--color-border-strong)',
}

/** Column·Row 는 flex, Box 는 모든 자식이 같은 칸에 겹치는 grid 로 그린다. */
export function containerStyle(layout: ContainerLayout): CSSProperties {
  const padding = `${layout.paddingY}px ${layout.paddingX}px`
  if (layout.direction === 'box') return { display: 'grid', gridTemplate: '1fr / 1fr', padding }
  return {
    display: 'flex',
    flexDirection: layout.direction,
    gap: layout.main === 'space-between' ? undefined : layout.gap,
    justifyContent: JUSTIFY[layout.main],
    alignItems: ALIGN[layout.cross],
    padding,
  }
}

/** 부모의 방향에 따라 크기 규칙을 flex 속성으로 옮긴다. Figma 의 Hug · Fill · Fixed 와 같다. */
export function childStyle(style: NodeStyle, parent: ContainerLayout | null): CSSProperties {
  const result: CSSProperties = {
    position: 'relative',
    minWidth: 0,
    minHeight: 0,
    background: FILL_BACKGROUND[style.fill],
    border: style.border ? '1px solid var(--color-border)' : undefined,
    // 테두리를 두른 상자는 카드로 본다. 테마마다 카드 그림자가 다르다.
    boxShadow: style.border ? 'var(--wf-card-shadow, none)' : undefined,
    borderRadius: style.radius > 0 ? style.radius : undefined,
  }
  if (typeof style.width === 'number') Object.assign(result, { width: style.width, flexShrink: 0 })
  if (typeof style.height === 'number') Object.assign(result, { height: style.height, flexShrink: 0 })
  if (parent === null) {
    if (style.width === 'fill') result.width = '100%'
    if (style.height === 'fill') result.flex = '1 1 auto'
    return result
  }
  if (parent.direction === 'box') {
    result.gridArea = '1 / 1'
    result.justifySelf = style.width === 'fill' ? 'stretch' : SELF[parent.cross]
    result.alignSelf = style.height === 'fill' ? 'stretch' : SELF[parent.main]
    return result
  }
  const mainSize = parent.direction === 'row' ? style.width : style.height
  const crossSize = parent.direction === 'row' ? style.height : style.width
  if (mainSize === 'fill') result.flex = '1 1 0'
  else if (mainSize === 'hug') result.flex = '0 0 auto'
  if (crossSize === 'fill') result.alignSelf = 'stretch'
  return result
}
