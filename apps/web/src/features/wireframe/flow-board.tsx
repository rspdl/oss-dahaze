'use client'

import * as React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyNodeChanges, Background, Controls, Handle, MarkerType, Position, ReactFlow,
  type Edge, type Node, type NodeChange, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react'
import { cn } from '@dahaze/ui'

import { DEFAULT_MOCKUP_DIMENSIONS, ScreenMockupFrame, type ScreenMockupFrameProps } from '../mockup/screen-mockup'
import type { FlowGraph, FlowNode } from './flow-graph'

export const FLOW_CARD_WIDTH = 360
export const FLOW_CARD_HEIGHT = 288
const PREVIEW_HEIGHT = 260

interface FlowNodeData extends Record<string, unknown> {
  node: FlowNode
  selected: boolean
  related: boolean
  prototype: Omit<ScreenMockupFrameProps, 'screen'>
  onSelect: (id: string) => void
}

type ScreenFlowNode = Node<FlowNodeData, 'screen'>

const ScreenNodeCard = memo(function ScreenNodeCard({ data }: NodeProps<ScreenFlowNode>) {
  const { node, selected, related, prototype, onSelect } = data
  const dimensions = prototype.dimensions ?? DEFAULT_MOCKUP_DIMENSIONS
  const experience = prototype.mode === 'experience'
  const scale = Math.min((FLOW_CARD_WIDTH - 24) / (dimensions.width + 2), (PREVIEW_HEIGHT - 20) / (dimensions.height + 2))
  const frame = node.mockup === null
    ? <div className="flex items-center justify-center rounded border border-dashed bg-surface text-sm text-text-subtle" style={dimensions}>선언된 레이아웃이 없습니다</div>
    : <ScreenMockupFrame screen={node.mockup} {...prototype} showCaption={experience} />
  if (experience) return frame

  return <article aria-label={`화면: ${node.screen.name}`} className={cn('screen-drag-handle cursor-grab active:cursor-grabbing', !related && !selected && 'opacity-40')} style={{ width: FLOW_CARD_WIDTH }}>
    <Handle id="in" type="target" position={Position.Left} style={{ top: 2 + PREVIEW_HEIGHT / 2 }} className="!size-1 !border-0 !bg-transparent" />
    <div className={cn('relative overflow-hidden rounded-xl border-2 bg-canvas shadow-sm transition-[border-color]', selected ? 'border-text shadow-lg' : related ? 'border-border-strong' : 'border-border')} style={{ height: PREVIEW_HEIGHT + 4 }}>
      <div className="absolute top-2.5" style={{ left: (FLOW_CARD_WIDTH - 4 - (dimensions.width + 2) * scale) / 2, width: dimensions.width + 2, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{frame}</div>
    </div>
    <div className="flex h-6 items-center px-1">
      <button type="button" className="nodrag max-w-full truncate text-left text-[11px] font-normal text-text-subtle" onClick={(event) => { event.stopPropagation(); onSelect(node.id) }}>{node.screen.name}</button>
    </div>
    <Handle id="out" type="source" position={Position.Right} style={{ top: 2 + PREVIEW_HEIGHT / 2 }} className="!size-1 !border-0 !bg-transparent" />
    {/* 되돌아가는 경로는 카드 아래로 돈다. 같은 줄의 앞으로 가는 선과 겹치지 않게 한다. */}
    <Handle id="back-out" type="source" position={Position.Bottom} style={{ left: '62%' }} className="!size-1 !border-0 !bg-transparent" />
    <Handle id="back-in" type="target" position={Position.Bottom} style={{ left: '38%' }} className="!size-1 !border-0 !bg-transparent" />
  </article>
})

const nodeTypes = { screen: ScreenNodeCard }

/** 보드가 새로 계산한 노드에 React Flow 가 잰 크기와 끄는 중인 위치를 옮긴다. */
export function mergeFlowNodes(current: ScreenFlowNode[], next: ScreenFlowNode[]): ScreenFlowNode[] {
  const previous = new Map(current.map((node) => [node.id, node]))
  return next.map((node) => {
    const kept = previous.get(node.id)
    if (kept === undefined) return node
    return { ...node, measured: kept.measured, ...(kept.dragging === true ? { position: kept.position, dragging: true } : {}) }
  })
}

export function applyFlowNodeSelection(nodes: ScreenFlowNode[], selectedId: string | null): ScreenFlowNode[] {
  return nodes.map((node) => {
    const selected = node.id === selectedId
    return node.data.selected === selected ? node : { ...node, data: { ...node.data, selected } }
  })
}

/**
 * 같은 두 화면 사이의 경로는 선 하나로 합친다. 아무것도 고르지 않으면 모든 연결을 옅은 선으로,
 * 화면을 고르면 그 화면에 닿는 연결만 이름과 함께 그리고 나머지는 숨긴다.
 *
 * 왼쪽(또는 같은 열)의 화면으로 돌아가는 경로는 카드 아래 손잡이로 이어 아래로 돌게 한다.
 * 오른쪽 → 왼쪽 손잡이로 그리면 앞으로 가는 선과 같은 직선에 겹쳐 이름이 엉뚱한 선에 붙는다.
 */
export function flowBoardEdges(graph: FlowGraph, selectedId: string | null): Edge[] {
  const positionOf = new Map(graph.nodes.map((node) => [node.id, node.position]))
  const isBack = (source: string, target: string) => {
    const from = positionOf.get(source)
    const to = positionOf.get(target)
    return from !== undefined && to !== undefined && to.x <= from.x
  }
  const merged = new Map<string, { source: string; target: string; labels: string[] }>()
  for (const edge of graph.edges) {
    const key = `${edge.source}->${edge.target}`
    const entry = merged.get(key) ?? { source: edge.source, target: edge.target, labels: [] }
    if (!entry.labels.includes(edge.label)) entry.labels.push(edge.label)
    merged.set(key, entry)
  }
  const nameOf = (id: string) => graph.nodes.find((node) => node.id === id)?.screen.name ?? id
  return [...merged.entries()].map(([id, { source, target, labels }]) => {
    const outgoing = selectedId !== null && source === selectedId
    const incoming = selectedId !== null && target === selectedId
    const color = outgoing ? 'var(--color-text)' : incoming ? 'var(--color-text-subtle)' : 'var(--color-border-strong)'
    const back = isBack(source, target)
    return {
      id, source, target,
      ...(back
        ? { sourceHandle: 'back-out', targetHandle: 'back-in', type: 'smoothstep', pathOptions: { offset: 36, borderRadius: 18 } }
        : { sourceHandle: 'out', targetHandle: 'in', type: 'default' }),
      hidden: selectedId !== null && !outgoing && !incoming,
      label: outgoing || incoming ? labels.join(' · ') : undefined,
      labelStyle: { fill: 'var(--color-text)', fontSize: 11, fontWeight: 500 },
      labelBgStyle: { fill: 'var(--color-surface)', fillOpacity: 0.98 },
      labelBgPadding: [6, 4] as [number, number],
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth: outgoing || incoming ? 1.5 : 1 },
      ariaLabel: `${nameOf(source)} → ${nameOf(target)}: ${labels.join(', ')}`,
    }
  })
}

export function FlowBoard({ graph, selectedId, onSelect, prototype = {}, prototypeForNode, editable = false, onPositionChange, onOpen }: {
  graph: FlowGraph
  selectedId: string | null
  onSelect: (id: string | null) => void
  prototype?: Omit<ScreenMockupFrameProps, 'screen'>
  prototypeForNode?: (node: FlowNode) => Omit<ScreenMockupFrameProps, 'screen'>
  editable?: boolean
  onPositionChange?: (screenKey: string, position: { x: number; y: number }) => void
  /** 화면 카드를 더블클릭했을 때. 없으면 그 화면으로 확대한다. */
  onOpen?: (screenKey: string) => void
}) {
  const instanceRef = useRef<ReactFlowInstance<ScreenFlowNode, Edge> | null>(null)
  const selectNode = onSelect
  const experience = prototype.mode === 'experience'
  const experienceId = experience ? selectedId ?? graph.nodes[0]?.id ?? null : null
  const focusNode = useCallback((id: string) => {
    const node = graph.nodes.find((entry) => entry.id === id)
    if (node === undefined) return
    selectNode(id)
    const height = FLOW_CARD_HEIGHT
    void instanceRef.current?.fitBounds({ ...node.position, width: FLOW_CARD_WIDTH, height }, { padding: 0.3, duration: 300 })
  }, [graph, selectNode])
  const { nodes, edges } = useMemo(() => {
    const neighbors = new Set([selectedId, ...graph.edges.filter((edge) => edge.source === selectedId || edge.target === selectedId).flatMap((edge) => [edge.source, edge.target])])
    const visible = experience ? graph.nodes.filter((node) => node.id === experienceId) : graph.nodes
    const baseNodes: ScreenFlowNode[] = visible.map((node) => {
      const config = prototypeForNode?.(node) ?? prototype
      const dimensions = config.dimensions ?? DEFAULT_MOCKUP_DIMENSIONS
      return {
        id: node.id, type: 'screen', dragHandle: '.screen-drag-handle',
        position: experience ? { x: 0, y: 0 } : node.position,
        initialWidth: experience ? dimensions.width + 2 : FLOW_CARD_WIDTH,
        initialHeight: experience ? dimensions.height + 48 : FLOW_CARD_HEIGHT,
        ariaLabel: node.screen.name,
        data: { node, selected: false, related: selectedId === null || neighbors.has(node.id), prototype: config, onSelect: selectNode },
      }
    })
    return { nodes: applyFlowNodeSelection(baseNodes, selectedId), edges: experience ? [] : flowBoardEdges(graph, selectedId) }
  }, [graph, experience, experienceId, selectedId, prototype, prototypeForNode, selectNode])

  /*
   * React Flow 는 노드 크기를 재고 끄는 위치를 onNodesChange 로 돌려준다. 그 변경을 받지 않으면
   * 노드가 끝내 "초기화되지 않은" 상태로 남고, 노드가 다시 만들어질 때마다 측정과 갱신을 되풀이한다.
   * 그래서 보드가 계산한 노드를 기준으로 하되, 측정값과 끄는 중인 위치는 React Flow 가 준 것을 지킨다.
   */
  const [flowNodes, setFlowNodes] = useState<ScreenFlowNode[]>(nodes)
  const [syncedNodes, setSyncedNodes] = useState(nodes)
  if (syncedNodes !== nodes) {
    setSyncedNodes(nodes)
    setFlowNodes(mergeFlowNodes(flowNodes, nodes))
  }
  const onNodesChange = useCallback((changes: NodeChange<ScreenFlowNode>[]) => setFlowNodes((current) => applyNodeChanges(changes, current)), [])

  const nodeSetKey = graph.nodes.map((node) => node.id).join('|')
  const dimensions = prototype.dimensions ?? DEFAULT_MOCKUP_DIMENSIONS
  // Only a new environment or a prototype navigation reframes the board. Selecting,
  // editing and saving must leave the user's camera alone.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (experience) void instanceRef.current?.fitBounds({ x: 0, y: 0, width: dimensions.width + 2, height: dimensions.height + 48 }, { padding: 0.15, duration: 200 })
      else void instanceRef.current?.fitView({ padding: 0.15, maxZoom: 1, duration: 200 })
    })
    return () => cancelAnimationFrame(frame)
  }, [experience, experienceId, nodeSetKey, dimensions.width, dimensions.height])

  return <section aria-label="화면 흐름 보드" className="relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-canvas">
    <ReactFlow<ScreenFlowNode, Edge>
      nodes={flowNodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
      fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      onInit={(instance) => { instanceRef.current = instance }}
      minZoom={0.08} maxZoom={4} nodesConnectable={false} nodesDraggable={editable}
      onNodeDragStop={(_, node) => onPositionChange?.(node.id, node.position)}
      onNodeClick={(_, node) => { if (!experience) selectNode(node.id) }}
      onNodeDoubleClick={(_, node) => { if (experience) return; if (onOpen !== undefined && node.data.node.mockup !== null) onOpen(node.id); else focusNode(node.id) }}
      onPaneClick={() => { if (!experience) selectNode(null) }}
      onEdgeClick={(_, edge) => selectNode(edge.source)}
      onEdgeDoubleClick={(_, edge) => focusNode(edge.target)}
      zoomOnDoubleClick={false} onlyRenderVisibleElements
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} color="var(--color-border-strong)" />
      <Controls showInteractive={false} className="!border-border !bg-surface [&>button]:!border-border [&>button]:!bg-surface" />
    </ReactFlow>
  </section>
}
