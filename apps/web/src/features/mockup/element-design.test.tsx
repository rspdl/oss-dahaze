import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { gestureDesign, parseElementDesigns } from './element-design'
import { designBindingKey } from './prototype-contract'
import type { ScreenMockup } from './screen-layouts'
import { ScreenMockupFrame } from './screen-mockup'
import { wireframeLayers } from './wireframe-inspector'
import { createDesignEditorState, designMetadataPatch, editDesign, restoreDesignDraft, serializeDesignDraft, undoDesign } from '../boards/design-state'

const screen: ScreenMockup = {
  key: 'checkout.rspdl:checkout', screenId: 'checkout', screenName: '결제', path: 'checkout.rspdl', kind: 'page',
  elements: [{ kind: 'section', id: 'content', children: [
    { kind: 'button', id: 'pay', name: '결제하기', actionId: 'payment' },
    { kind: 'placeholder', id: null, text: '상품 이미지 영역' },
  ] }],
}

describe('wireframe presentation', () => {
  it('converts zoomed pointer motion into grid-snapped CSS coordinates and clamps minimum size', () => {
    const start = { x: 32, y: 48, width: 160, height: 64 }
    expect(gestureDesign(start, 8, 12, 0.5, 'move')).toEqual({ x: 48, y: 72, width: 160, height: 64 })
    expect(gestureDesign(start, 3, 0, 2, 'move', false).x).toBe(34)
    expect(gestureDesign(start, -500, -500, 1, 'resize')).toEqual({ width: 16, height: 16 })
    expect(gestureDesign(start, -500, -500, 1, 'move').x).toBe(0)
  })

  it('loads old dimensions and rejects malformed presentation values', () => {
    expect(parseElementDesigns({ old: { width: 200, height: 100 }, broken: { x: -1, y: Infinity, width: '200', height: -50, layout: 'script', gap: NaN }, valid: { x: 0, y: 80, layout: 'grid', gap: 16 }, null: null })).toEqual({ old: { width: 200, height: 100 }, broken: {}, valid: { x: 0, y: 80, layout: 'grid', gap: 16 } })
  })

  it('retains exact compiler paths and semantic selection metadata for nested layers', () => {
    const layers = wireframeLayers(screen, 'rev1')
    expect(layers.map((layer) => layer.selection.elementPath)).toEqual(['elements.0', 'elements.0.children.0', 'elements.0.children.1'])
    expect(layers[1]?.selection).toMatchObject({ screenKey: screen.key, elementId: 'pay', actionId: 'payment', sourceHash: 'rev1' })
    expect(layers[2]?.depth).toBe(1)
  })

  it('replays persisted presentation in experience and read-only frames without changing the compiler tree', () => {
    const before = JSON.stringify(screen)
    const designs = parseElementDesigns({
      [designBindingKey({ screenKey: screen.key, elementId: 'content' })]: { height: 500, layout: 'grid', gap: 24 },
      [designBindingKey({ screenKey: screen.key, elementId: 'pay' })]: { x: 80, y: 120, width: 240, height: 48 },
    })
    for (const mode of ['edit', 'experience'] as const) {
      const html = renderToStaticMarkup(<ScreenMockupFrame screen={screen} mode={mode} designByElementPath={designs} selectedElementPath="elements.0.children.0" selectedElementScreenKey={screen.key} onElementSelect={() => {}} />)
      expect(html).toContain('position:absolute;left:80px;top:120px;width:240px;height:48px')
      expect(html).toContain('grid-template-columns:repeat(2, minmax(0, 1fr))')
      expect(html).toContain('결제하기')
      expect(html).not.toContain('요소 드래그 이동')
      expect(html).not.toContain('요소 드래그 크기 조절')
    }
    expect(JSON.stringify(screen)).toBe(before)
  })

  it('does not apply path-bound placement to a new source revision', () => {
    const key = designBindingKey({ screenKey: screen.key, sourceHash: 'rev1', elementPath: 'elements.0.children.1' })
    const html = renderToStaticMarkup(<ScreenMockupFrame screen={screen} sourceHash="rev2" designByElementPath={{ [key]: { x: 800, y: 900 } }} />)
    expect(html).not.toContain('left:800px')
  })

  it('round-trips moves through drafts and environment metadata and undoes them independently of source', () => {
    const initial = createDesignEditorState('mobile', { elements: {}, positions: {} })
    const key = designBindingKey({ screenKey: screen.key, elementId: 'pay' })
    const edited = editDesign(initial, (scope) => ({ ...scope, elements: { [key]: { x: 16, y: 24, width: 200, height: 48 } } }))
    const restored = restoreDesignDraft(serializeDesignDraft(edited), 'mobile')!
    const persisted = designMetadataPatch({ environments: { desktop: { elements: { untouched: { width: 400 } } } } }, 'mobile', restored.working)
    expect(persisted).toMatchObject({ environments: { desktop: { elements: { untouched: { width: 400 } } }, mobile: { elements: { [key]: { x: 16, y: 24, width: 200, height: 48 } } } } })
    expect(undoDesign(restored).working.elements).toEqual({})
  })
})
