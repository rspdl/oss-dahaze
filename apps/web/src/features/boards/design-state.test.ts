import { describe, expect, it } from 'vitest'

import type { LayoutNode } from '@/features/mockup/layout-tree'
import { acknowledgeDesign, createDesignEditorState, designMetadataPatch, editDesign, reconcileServerDesign, redoDesign, restoreDesignDraft, serializeDesignDraft, undoDesign } from './design-state'

const tree: LayoutNode = { type: 'group', id: 'root', style: { width: 'fill', height: 'fill', fill: 'none', border: false, radius: 0 }, layout: { direction: 'row', gap: 8, paddingX: 0, paddingY: 0, main: 'start', cross: 'center' }, children: [] }

describe('design editor state', () => {
  it('retains a newer edit when an older save is acknowledged', () => {
    const initial = createDesignEditorState('mobile', { layouts: {}, positions: {} })
    const first = editDesign(initial, (scope) => ({ ...scope, positions: { a: { x: 1, y: 2 } } }))
    const second = editDesign({ ...first, status: 'saving' }, (scope) => ({ ...scope, positions: { a: { x: 3, y: 4 } } }))
    const acknowledged = acknowledgeDesign(second, first.generation, first.working, 2)
    expect(acknowledged.status).toBe('pending')
    expect(acknowledged.working.positions.a).toEqual({ x: 3, y: 4 })
  })

  it('undoes an override to a truly absent key after that override was saved', () => {
    const initial = createDesignEditorState('mobile', { layouts: {}, positions: {} })
    const changed = editDesign(initial, (scope) => ({ ...scope, layouts: { title: tree } }))
    const saved = acknowledgeDesign(changed, changed.generation, changed.working, 2)
    const undone = undoDesign(saved)
    expect(undone.working.layouts).toEqual({})
    expect(redoDesign(undone).working.layouts).toEqual({ title: tree })
    expect(editDesign(undone, (scope) => scope).future).toEqual([])
  })

  it('does not restore a draft saved in the old coordinate format', () => {
    const old = JSON.stringify({ scope: 'desktop', base: { elements: {}, positions: {} }, working: { elements: { a: { x: 1 } }, positions: {} }, history: [], generation: 2, acknowledgedGeneration: 1 })
    expect(restoreDesignDraft(old, 'desktop')).toBeNull()
  })

  it('accepts unrelated metadata changes but conflicts on a changed local scope', () => {
    const initial = createDesignEditorState('mobile', { layouts: {}, positions: {} }, 1)
    const dirty = editDesign(initial, (scope) => ({ ...scope, positions: { local: { x: 1, y: 2 } } }))
    const unrelated = reconcileServerDesign(dirty, 'mobile', { layouts: {}, positions: {} }, 2)
    expect(unrelated.accepted).toBe(true)
    expect(unrelated.state.working.positions.local).toEqual({ x: 1, y: 2 })
    const conflicting = reconcileServerDesign(unrelated.state, 'mobile', { layouts: {}, positions: { remote: { x: 4, y: 5 } } }, 3)
    expect(conflicting.accepted).toBe(false)
    expect(conflicting.state.status).toBe('conflict')
    expect(conflicting.state.working.positions.local).toEqual({ x: 1, y: 2 })
  })

  it('changes one environment without reverting another environment metadata', () => {
    const patched = designMetadataPatch({ environments: { desktop: { note: 'keep', positions: { old: { x: 1, y: 1 } } }, mobile: { note: 'scope-note' } }, extra: true }, 'mobile', { layouts: {}, positions: { screen: { x: 2, y: 3 } } })
    expect(patched).toEqual({ environments: { desktop: { note: 'keep', positions: { old: { x: 1, y: 1 } } }, mobile: { note: 'scope-note', layouts: {}, positions: { screen: { x: 2, y: 3 } } } }, extra: true })
  })

  it('restores an unacknowledged edit after immediate navigation', () => {
    const edited = editDesign(createDesignEditorState('desktop', { layouts: {}, positions: {} }, 4), (scope) => ({ ...scope, positions: { checkout: { x: 30, y: 40 } } }))
    const restored = restoreDesignDraft(serializeDesignDraft(edited), 'desktop')
    expect(restored?.status).toBe('pending')
    expect(restored?.working.positions.checkout).toEqual({ x: 30, y: 40 })
  })
})
