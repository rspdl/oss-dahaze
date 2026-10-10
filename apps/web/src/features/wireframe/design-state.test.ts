import { describe, expect, it } from 'vitest'

import type { LayoutNode } from '@/features/mockup/layout-tree'
import { acknowledgeDesign, createDesignEditorState, editDesign, reconcileServerDesign, redoDesign, restoreDesignDraft, serializeDesignDraft, undoDesign } from './design-state'

const tree: LayoutNode = { type: 'group', id: 'root', style: { width: 'fill', height: 'fill' }, layout: { direction: 'row', gap: 8, paddingX: 0, paddingY: 0, main: 'start', cross: 'center' }, children: [] }

describe('design editor state', () => {
  it('retains a newer edit when an older save is acknowledged', () => {
    const initial = createDesignEditorState('p', { layouts: {}, positions: {} })
    const first = editDesign(initial, (design) => ({ ...design, positions: { a: { x: 1, y: 2 } } }))
    const second = editDesign({ ...first, status: 'saving' }, (design) => ({ ...design, positions: { a: { x: 3, y: 4 } } }))
    const acknowledged = acknowledgeDesign(second, first.generation, first.working, 's2')
    expect(acknowledged.status).toBe('pending')
    expect(acknowledged.working.positions.a).toEqual({ x: 3, y: 4 })
  })

  it('undoes an override to a truly absent key after that override was saved', () => {
    const initial = createDesignEditorState('p', { layouts: {}, positions: {} })
    const changed = editDesign(initial, (design) => ({ ...design, layouts: { title: tree } }))
    const saved = acknowledgeDesign(changed, changed.generation, changed.working, 's2')
    const undone = undoDesign(saved)
    expect(undone.working.layouts).toEqual({})
    expect(redoDesign(undone).working.layouts).toEqual({ title: tree })
    expect(editDesign(undone, (design) => design).future).toEqual([])
  })

  it('does not restore a draft saved in the old coordinate format', () => {
    const old = JSON.stringify({ scope: 'p', base: { elements: {}, positions: {} }, working: { elements: { a: { x: 1 } }, positions: {} }, history: [], serverStamp: '', generation: 2, acknowledgedGeneration: 1 })
    expect(restoreDesignDraft(old, 'p')).toBeNull()
  })

  it('takes a server change when nothing is pending', () => {
    const initial = createDesignEditorState('p', { layouts: {}, positions: {} }, 's1')
    const next = reconcileServerDesign(initial, { layouts: {}, positions: { remote: { x: 4, y: 5 } } }, 's2')
    expect(next.accepted).toBe(true)
    expect(next.state.working.positions.remote).toEqual({ x: 4, y: 5 })
  })

  it('accepts an unrelated server change but conflicts when the saved base moved', () => {
    const initial = createDesignEditorState('p', { layouts: {}, positions: {} }, 's1')
    const dirty = editDesign(initial, (design) => ({ ...design, positions: { local: { x: 1, y: 2 } } }))
    const unrelated = reconcileServerDesign(dirty, { layouts: {}, positions: {} }, 's2')
    expect(unrelated.accepted).toBe(true)
    expect(unrelated.state.working.positions.local).toEqual({ x: 1, y: 2 })
    const conflicting = reconcileServerDesign(unrelated.state, { layouts: {}, positions: { remote: { x: 4, y: 5 } } }, 's3')
    expect(conflicting.accepted).toBe(false)
    expect(conflicting.state.status).toBe('conflict')
    expect(conflicting.state.working.positions.local).toEqual({ x: 1, y: 2 })
  })

  it('treats the same design with a different key order as unchanged', () => {
    const initial = createDesignEditorState('p', { layouts: {}, positions: { a: { x: 1, y: 2 } } }, 's1')
    const dirty = editDesign(initial, (design) => ({ ...design, positions: { ...design.positions, b: { x: 0, y: 0 } } }))
    const reordered = reconcileServerDesign(dirty, { layouts: {}, positions: { a: { y: 2, x: 1 } } }, 's2')
    expect(reordered.accepted).toBe(true)
  })

  it('restores an unacknowledged edit after immediate navigation', () => {
    const edited = editDesign(createDesignEditorState('p', { layouts: {}, positions: {} }, 's4'), (design) => ({ ...design, positions: { checkout: { x: 30, y: 40 } } }))
    const restored = restoreDesignDraft(serializeDesignDraft(edited), 'p')
    expect(restored?.status).toBe('pending')
    expect(restored?.working.positions.checkout).toEqual({ x: 30, y: 40 })
    expect(restoreDesignDraft(serializeDesignDraft(edited), 'other')).toBeNull()
  })
})
