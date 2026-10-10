import { describe, expect, it, vi } from 'vitest'

import { applyFlowNodeSelection, flowBoardEdges, mergeFlowNodes } from './flow-board'
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
      selected: false,
      related: true,
      zoom: 1,
      onSelect: vi.fn(),
      prototype: {},
    },
  })) as FlowNodes
}

describe('FlowBoard selection lifecycle', () => {
  it('merges parallel paths and shows only the selected screen\'s connections', () => {
    const graph: FlowGraph = { nodes: [], danglingPaths: [], edges: [
      { id: 'success', source: 'checkout', target: 'done', label: '완료', path: {} as never },
      { id: 'again', source: 'checkout', target: 'done', label: '다시 완료', path: {} as never },
      { id: 'failure', source: 'checkout', target: 'retry', label: '재시도', path: {} as never },
      { id: 'back', source: 'cart', target: 'checkout', label: '결제', path: {} as never },
      { id: 'unrelated', source: 'settings', target: 'home', label: '저장', path: {} as never },
    ] }
    const overview = flowBoardEdges(graph, null)
    expect(overview).toHaveLength(4)
    expect(overview.every((edge) => edge.sourceHandle === 'out' && edge.targetHandle === 'in')).toBe(true)
    expect(overview.every((edge) => edge.hidden === false && edge.label === undefined)).toBe(true)

    const focused = flowBoardEdges(graph, 'checkout')
    expect(focused.filter((edge) => !edge.hidden).map((edge) => edge.label)).toEqual(['완료 · 다시 완료', '재시도', '결제'])
    expect(focused.find((edge) => edge.source === 'settings')?.hidden).toBe(true)
  })
  it('routes a path back to an earlier column under the cards', () => {
    const node = (id: string, x: number) => ({ id, position: { x, y: 0 }, screen: { name: id } }) as FlowGraph['nodes'][number]
    const graph: FlowGraph = { nodes: [node('menu', 0), node('order', 500)], danglingPaths: [], edges: [
      { id: 'forward', source: 'menu', target: 'order', label: '주문하기', path: {} as never },
      { id: 'back', source: 'order', target: 'menu', label: '메뉴로', path: {} as never },
    ] }
    const [forward, back] = flowBoardEdges(graph, 'order')
    expect(forward).toMatchObject({ sourceHandle: 'out', targetHandle: 'in', label: '주문하기' })
    expect(back).toMatchObject({ sourceHandle: 'back-out', targetHandle: 'back-in', type: 'smoothstep', label: '메뉴로' })
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

  it('keeps React Flow measurements and the dragged position when the board recomputes nodes', () => {
    const [a, b] = nodes()
    const current = [{ ...a!, measured: { width: 360, height: 288 }, position: { x: 40, y: 50 }, dragging: true }, { ...b!, measured: { width: 360, height: 288 } }]
    const next = nodes().map((node) => ({ ...node, position: { x: 999, y: 999 } }))
    const merged = mergeFlowNodes(current, next)
    expect(merged[0]).toMatchObject({ measured: { width: 360, height: 288 }, position: { x: 40, y: 50 }, dragging: true })
    expect(merged[1]).toMatchObject({ measured: { width: 360, height: 288 }, position: { x: 999, y: 999 } })
    expect(merged[2]?.measured).toBeUndefined()
  })
})
