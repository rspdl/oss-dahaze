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
    const fitView = vi.fn(async () => true)

    fitSelectedFlowNode({ fitView }, 'b')
    fitSelectedFlowNode({ fitView }, null)

    expect(fitView).toHaveBeenCalledOnce()
    expect(fitView).toHaveBeenCalledWith({
      nodes: [{ id: 'b' }],
      padding: 0.18,
      maxZoom: 0.9,
      duration: 200,
    })
  })
})
