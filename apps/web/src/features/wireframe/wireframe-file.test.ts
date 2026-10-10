import { describe, expect, it } from 'vitest'

import type { LayoutNode } from '@/features/mockup/layout-tree'
import { documentPathFor, parseWireframes, wireframePathFor, wireframeWrites } from './wireframe-file'

const tree: LayoutNode = { type: 'group', id: 'root', style: { width: 'fill', height: 'fill', fill: 'none', border: false, radius: 0 }, layout: { direction: 'column', gap: 8, paddingX: 16, paddingY: 16, main: 'start', cross: 'start' }, children: [] }

describe('wireframe file paths', () => {
  it('sits next to its document', () => {
    expect(wireframePathFor('/주문/결제.rspdl')).toBe('/주문/결제.wireframe.json')
    expect(documentPathFor('/주문/결제.wireframe.json')).toBe('/주문/결제.rspdl')
  })
})

describe('parseWireframes', () => {
  it('keys screens by document path and id', () => {
    const parsed = parseWireframes([
      { path: '/a.wireframe.json', text: JSON.stringify({ version: 1, screens: { 'm.list': { position: { x: 1, y: 2 }, layout: tree } } }) },
    ])
    expect(parsed.invalid).toEqual([])
    expect(parsed.design.positions).toEqual({ '/a.rspdl:m.list': { x: 1, y: 2 } })
    expect(parsed.design.layouts['/a.rspdl:m.list']).toEqual(tree)
  })

  it('reports a file it cannot read instead of treating it as empty', () => {
    const parsed = parseWireframes([{ path: '/a.wireframe.json', text: '{ broken' }])
    expect(parsed.invalid.map((entry) => entry.path)).toEqual(['/a.wireframe.json'])
  })
})

describe('wireframeWrites', () => {
  it('writes only the documents whose screens changed', () => {
    const writes = wireframeWrites(
      [],
      { layouts: {}, positions: { '/a.rspdl:s1': { x: 0, y: 0 } } },
      { layouts: {}, positions: { '/a.rspdl:s1': { x: 0, y: 0 }, '/b.rspdl:s2': { x: 10.4, y: 20.6 } } },
    )
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ path: '/b.wireframe.json', exists: false })
    expect(JSON.parse(writes[0]!.text)).toEqual({ version: 1, screens: { s2: { position: { x: 10, y: 21 } } } })
  })

  it('keeps screens and keys it does not know about', () => {
    const existing = { version: 1, note: 'keep', screens: { hidden: { position: { x: 5, y: 5 } }, s1: { position: { x: 0, y: 0 }, memo: 'keep' } } }
    const writes = wireframeWrites(
      [{ path: '/a.wireframe.json', text: JSON.stringify(existing) }],
      { layouts: {}, positions: { '/a.rspdl:s1': { x: 0, y: 0 } } },
      { layouts: { '/a.rspdl:s1': tree }, positions: { '/a.rspdl:s1': { x: 1, y: 1 } } },
    )
    expect(writes[0]?.exists).toBe(true)
    expect(JSON.parse(writes[0]!.text)).toEqual({ version: 1, note: 'keep', screens: { hidden: { position: { x: 5, y: 5 } }, s1: { memo: 'keep', position: { x: 1, y: 1 }, layout: tree } } })
  })

  it('refuses to overwrite a file it could not read', () => {
    expect(() => wireframeWrites(
      [{ path: '/a.wireframe.json', text: 'not json' }],
      { layouts: {}, positions: {} },
      { layouts: {}, positions: { '/a.rspdl:s1': { x: 1, y: 1 } } },
    )).toThrow()
  })
})
