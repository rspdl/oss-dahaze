import { describe, expect, it, vi } from 'vitest'

import { applyFlowNodeSelection, fitSelectedFlowNode } from './flow-board'

type FlowNodes = Parameters<typeof applyFlowNodeSelection>[0]

function nodes(): FlowNodes {
  return ['a', 'b', 'c'].map((id, index) => ({
    id,
    type: 'screen',
    position: { x: index * 100, y: 0 },
    data: {
      node: {
        id,
        screen: { id, key: id, name: id, path: 'test.rspdl', span: null },
        mockup: null,
        position: { x: index * 100, y: 0 },
      },
      viewport: 'desktop',
      selected: false,
      detailed: false,
      prototype: {},
    },
  })) as FlowNodes
}

describe('FlowBoard selection lifecycle', () => {
  it('selection changes only replace the selected node object', () => {
    const base = nodes()
    const selectedA = applyFlowNodeSelection(base, 'a')
    const selectedB = applyFlowNodeSelection(base, 'b')

    expect(selectedA[0]).not.toBe(base[0])
    expect(selectedA[1]).toBe(base[1])
    expect(selectedA[2]).toBe(base[2])
    expect(selectedB[0]).toBe(base[0])
    expect(selectedB[1]).not.toBe(base[1])
    expect(selectedB[2]).toBe(base[2])
    expect(selectedB.map((node) => node.position)).toEqual(base.map((node) => node.position))
  })

  it('fits the selected node through the existing flow instance', () => {
    const fitBounds = vi.fn(async () => true)
    const getInternalNode = vi.fn(() => ({
      measured: { width: 1444, height: 950 },
      internals: { positionAbsolute: { x: 3200, y: 1800 } },
    }))

    expect(fitSelectedFlowNode({ fitBounds, getInternalNode } as never, 'b', { width: 1440, height: 900 })).toBe(true)
    expect(fitSelectedFlowNode({ fitBounds, getInternalNode } as never, null, { width: 1440, height: 900 })).toBe(false)

    expect(fitBounds).toHaveBeenCalledOnce()
    expect(fitBounds).toHaveBeenCalledWith({
      x: 3200,
      y: 1800,
      width: 1444,
      height: 950,
    }, {
      padding: 0.18,
      duration: 200,
    })
  })

  it('does not fit a selected node until its detailed dimensions are measured', () => {
    const fitBounds = vi.fn(async () => true)
    const getInternalNode = vi.fn(() => ({
      measured: { width: 288, height: 112 },
      internals: { positionAbsolute: { x: 3200, y: 1800 } },
    }))

    expect(fitSelectedFlowNode({ fitBounds, getInternalNode } as never, 'b', { width: 1440, height: 900 })).toBe(false)
    expect(fitBounds).not.toHaveBeenCalled()
  })
})
