import { describe, expect, it, vi } from 'vitest'

import { applyFlowNodeSelection, flowBoardEdges } from './flow-board'
import type { FlowGraph } from './flow-graph'

type FlowNodes = Parameters<typeof applyFlowNodeSelection>[0]

function nodes(): FlowNodes {
  return ['a', 'b', 'c'].map((id, index) => ({
    id,
    type: 'screen',
    position: { x: index * 100, y: 0 },
    data: {
      node: {
        id,
        screen: { id, key: id, name: id, path: 'test.rspdl', span: null, categoryId: null, categorySpan: null, categoryOrder: null, hasLayout: false, layoutSpan: null },
        mockup: null,
        position: { x: index * 100, y: 0 },
      },
      viewport: 'desktop',
      selected: false,
      related: true,
      zoom: 1,
      connections: [],
      onSelect: vi.fn(),
      onFollow: vi.fn(),
      prototype: {},
    },
  })) as FlowNodes
}

describe('FlowBoard selection lifecycle', () => {
  it('keeps parallel outcomes on distinct source ports and highlights the selected neighborhood', () => {
    const graph: FlowGraph = { nodes: [], danglingPaths: [], edges: [
      { id: 'success', source: 'checkout', target: 'done', label: '완료', path: {} as never },
      { id: 'failure', source: 'checkout', target: 'retry', label: '재시도', path: {} as never },
      { id: 'unrelated', source: 'settings', target: 'home', label: '저장', path: {} as never },
    ] }
    const edges = flowBoardEdges(graph, 'checkout')
    expect(edges.map((edge) => edge.sourceHandle)).toEqual(['success', 'failure', 'unrelated'])
    expect(edges.every((edge) => edge.targetHandle === 'in')).toBe(true)
    expect(edges[0]?.animated).toBe(true)
    expect(edges[2]?.style?.opacity).toBeLessThan(edges[0]?.style?.opacity as number)
    expect(flowBoardEdges(graph, null).every((edge) => edge.style?.opacity === 1)).toBe(true)
  })
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

})
