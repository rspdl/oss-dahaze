import { describe, expect, it } from 'vitest'

import { acknowledgeDesign, createDesignEditorState, designMetadataPatch, editDesign, reconcileServerDesign, restoreDesignDraft, serializeDesignDraft, undoDesign } from './design-state'

describe('design editor state', () => {
  it('retains a newer edit when an older save is acknowledged', () => {
    const initial = createDesignEditorState('mobile', { elements: {}, positions: {} })
    const first = editDesign(initial, (scope) => ({ ...scope, positions: { a: { x: 1, y: 2 } } }))
    const second = editDesign({ ...first, status: 'saving' }, (scope) => ({ ...scope, positions: { a: { x: 3, y: 4 } } }))
    const acknowledged = acknowledgeDesign(second, first.generation, first.working, 2)
    expect(acknowledged.status).toBe('pending')
    expect(acknowledged.working.positions.a).toEqual({ x: 3, y: 4 })
  })

  it('undoes an override to a truly absent key after that override was saved', () => {
    const initial = createDesignEditorState('mobile', { elements: {}, positions: {} })
    const changed = editDesign(initial, (scope) => ({ ...scope, elements: { title: { width: 200 } } }))
    const saved = acknowledgeDesign(changed, changed.generation, changed.working, 2)
    const undone = undoDesign(saved)
    expect(undone.working.elements).toEqual({})
  })

  it('accepts unrelated metadata changes but conflicts on a changed local scope', () => {
    const initial = createDesignEditorState('mobile', { elements: {}, positions: {} }, 1)
    const dirty = editDesign(initial, (scope) => ({ ...scope, positions: { local: { x: 1, y: 2 } } }))
    const unrelated = reconcileServerDesign(dirty, 'mobile', { elements: {}, positions: {} }, 2)
    expect(unrelated.accepted).toBe(true)
    expect(unrelated.state.working.positions.local).toEqual({ x: 1, y: 2 })
    const conflicting = reconcileServerDesign(unrelated.state, 'mobile', { elements: {}, positions: { remote: { x: 4, y: 5 } } }, 3)
    expect(conflicting.accepted).toBe(false)
    expect(conflicting.state.status).toBe('conflict')
    expect(conflicting.state.working.positions.local).toEqual({ x: 1, y: 2 })
  })

  it('changes one environment without reverting another environment metadata', () => {
    const patched = designMetadataPatch({ environments: { desktop: { note: 'keep', positions: { old: { x: 1, y: 1 } } }, mobile: { note: 'scope-note' } }, extra: true }, 'mobile', { elements: {}, positions: { screen: { x: 2, y: 3 } } })
    expect(patched).toEqual({ environments: { desktop: { note: 'keep', positions: { old: { x: 1, y: 1 } } }, mobile: { note: 'scope-note', elements: {}, positions: { screen: { x: 2, y: 3 } } } }, extra: true })
  })

  it('restores an unacknowledged edit after immediate navigation', () => {
    const edited = editDesign(createDesignEditorState('desktop', { elements: {}, positions: {} }, 4), (scope) => ({ ...scope, positions: { checkout: { x: 30, y: 40 } } }))
    const restored = restoreDesignDraft(serializeDesignDraft(edited), 'desktop')
    expect(restored?.status).toBe('pending')
    expect(restored?.working.positions.checkout).toEqual({ x: 30, y: 40 })
  })
})
