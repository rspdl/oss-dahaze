'use client'

import * as React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow,
  type Edge, type Node, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react'
import { cn } from '@dahaze/ui'

import { DEFAULT_VIEWPORT_DIMENSIONS, ScreenMockupFrame, type MockupViewport, type ScreenMockupFrameProps } from '../mockup/screen-mockup'
import type { FlowEdge, FlowGraph, FlowNode } from './flow-graph'

export const FLOW_CARD_WIDTH = 360
export const FLOW_CARD_HEIGHT = 338
export const FLOW_CONNECTION_HEIGHT = 44
const PREVIEW_HEIGHT = 260

interface FlowNodeData extends Record<string, unknown> {
  node: FlowNode
  viewport: MockupViewport
  selected: boolean
  related: boolean
  zoom: number
  prototype: Omit<ScreenMockupFrameProps, 'screen' | 'viewport'>
  connections: (FlowEdge & { targetName: string })[]
  onSelect: (id: string) => void
  onFollow: (id: string) => void
}

type ScreenFlowNode = Node<FlowNodeData, 'screen'>

const ScreenNodeCard = memo(function ScreenNodeCard({ data }: NodeProps<ScreenFlowNode>) {
  const { node, viewport, selected, related, prototype, connections, onSelect, onFollow, zoom } = data
  const dimensions = prototype.dimensions ?? DEFAULT_VIEWPORT_DIMENSIONS[viewport]
  const experience = prototype.mode === 'experience'
  const overview = zoom < 0.65
  const readableFontSize = overview ? Math.min(32, 12 / zoom) : 12
  const scale = Math.min((FLOW_CARD_WIDTH - 24) / (dimensions.width + 2), (PREVIEW_HEIGHT - 20) / (dimensions.height + 32))
  const frame = node.mockup === null
    ? <div className="flex items-center justify-center rounded border border-dashed bg-surface text-sm text-text-subtle" style={dimensions}>선언된 레이아웃이 없습니다</div>
    : <ScreenMockupFrame screen={node.mockup} viewport={viewport} {...prototype} />
  if (experience) return frame

  return <article aria-label={`화면: ${node.screen.name}`} className={cn('rounded-xl border-2 bg-surface shadow-sm transition-[border-color,opacity]', selected ? 'border-accent shadow-lg' : related ? 'border-border-strong' : 'border-border opacity-40')} style={{ width: FLOW_CARD_WIDTH }}>
    <header className="screen-drag-handle flex h-11 cursor-grab items-center gap-2 rounded-t-xl border-b bg-surface px-3 active:cursor-grabbing">
      <Handle id="in" type="target" position={Position.Left} style={{ top: 22 }} className="!size-2.5 !border-2 !border-surface !bg-accent" />
      <span aria-hidden className="text-text-subtle">▤</span>
      <button type="button" style={{ fontSize: readableFontSize }} className="nodrag min-w-0 flex-1 truncate text-left font-semibold" onClick={(event) => { event.stopPropagation(); onSelect(node.id) }}>{node.screen.name}</button>
      {overview ? null : <span className="text-[10px] text-text-subtle">{dimensions.width} × {dimensions.height}</span>}
    </header>
    <div className="relative overflow-hidden bg-canvas" style={{ height: PREVIEW_HEIGHT }}>
      <div className="absolute top-2.5" style={{ left: (FLOW_CARD_WIDTH - (dimensions.width + 2) * scale) / 2, width: dimensions.width + 2, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{frame}</div>
    </div>
    <div aria-label={`${node.screen.name}에서 이동`} className="rounded-b-xl border-t bg-surface">
      {connections.length === 0 ? <p className="flex h-8 items-center px-3 text-[10px] text-text-subtle">연결된 다음 화면 없음</p> : connections.map((edge) => <div key={edge.id} className="relative border-b last:border-b-0" style={{ height: FLOW_CONNECTION_HEIGHT }}>
        <button type="button" className="nodrag nopan flex h-full w-full items-center gap-3 px-3 text-left hover:bg-accent-subtle" title={`${edge.label} → ${edge.targetName}`} onClick={(event) => { event.stopPropagation(); onFollow(edge.target) }}>
          <span className="min-w-0 flex-1"><span style={{ fontSize: readableFontSize }} className="block truncate font-medium">{edge.label}</span>{overview ? null : <span className="block truncate text-[10px] text-text-subtle">→ {edge.targetName}</span>}</span>
          <span aria-hidden className="text-accent">↗</span>
        </button>
        <Handle id={edge.id} type="source" position={Position.Right} className="!size-2.5 !border-2 !border-surface !bg-accent" />
      </div>)}
    </div>
  </article>
})

const nodeTypes = { screen: ScreenNodeCard }

export function applyFlowNodeSelection(nodes: ScreenFlowNode[], selectedId: string | null): ScreenFlowNode[] {
  return nodes.map((node) => {
    const selected = node.id === selectedId
    return node.data.selected === selected ? node : { ...node, data: { ...node.data, selected } }
  })
}

/** Each declared transition leaves its own visible row, including parallel outcomes. */
export function flowBoardEdges(graph: FlowGraph, selectedId: string | null): Edge[] {
  return graph.edges.map((edge) => {
    const active = selectedId === null || edge.source === selectedId || edge.target === selectedId
    return {
      id: edge.id, source: edge.source, target: edge.target,
      sourceHandle: edge.id, targetHandle: 'in', type: 'smoothstep',
      animated: selectedId !== null && edge.source === selectedId,
      label: selectedId !== null && active ? edge.label : undefined,
      labelStyle: { fill: 'var(--color-text)', fontSize: 11, fontWeight: 500 },
      labelBgStyle: { fill: 'var(--color-surface)', fillOpacity: 0.98 },
      labelBgPadding: [8, 5] as [number, number],
      markerEnd: { type: MarkerType.ArrowClosed, color: active ? 'var(--color-accent)' : 'var(--color-border-strong)' },
      style: { stroke: active ? 'var(--color-accent)' : 'var(--color-border-strong)', strokeWidth: active ? 2 : 1, opacity: active ? 1 : 0.3 },
      zIndex: active ? 1 : 0,
      ariaLabel: `${graph.nodes.find((node) => node.id === edge.source)?.screen.name ?? edge.source} → ${graph.nodes.find((node) => node.id === edge.target)?.screen.name ?? edge.target}: ${edge.label}`,
    }
  })
}

export function FlowBoard({ graph, viewport, selectedId, onSelect, prototype = {}, prototypeForNode, editable = false, onPositionChange }: {
  graph: FlowGraph
  viewport: MockupViewport
  selectedId: string | null
  onSelect: (id: string | null) => void
  prototype?: Omit<ScreenMockupFrameProps, 'screen' | 'viewport'>
  prototypeForNode?: (node: FlowNode) => Omit<ScreenMockupFrameProps, 'screen' | 'viewport'>
  editable?: boolean
  onPositionChange?: (screenKey: string, position: { x: number; y: number }) => void
}) {
  const instanceRef = useRef<ReactFlowInstance<ScreenFlowNode, Edge> | null>(null)
  const [zoom, setZoom] = useState(1)
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({})
  const experience = prototype.mode === 'experience'
  const experienceId = experience ? selectedId ?? graph.nodes[0]?.id ?? null : null
  const focusNode = useCallback((id: string) => {
    const node = graph.nodes.find((entry) => entry.id === id)
    if (node === undefined) return
    onSelect(id)
    const height = FLOW_CARD_HEIGHT + graph.edges.filter((edge) => edge.source === id).length * FLOW_CONNECTION_HEIGHT
    void instanceRef.current?.fitBounds({ ...node.position, width: FLOW_CARD_WIDTH, height }, { padding: 0.3, duration: 300 })
  }, [graph, onSelect])
  const { nodes, edges } = useMemo(() => {
    const neighbors = new Set([selectedId, ...graph.edges.filter((edge) => edge.source === selectedId || edge.target === selectedId).flatMap((edge) => [edge.source, edge.target])])
    const visible = experience ? graph.nodes.filter((node) => node.id === experienceId) : graph.nodes
    const baseNodes: ScreenFlowNode[] = visible.map((node) => {
      const config = prototypeForNode?.(node) ?? prototype
      const dimensions = config.dimensions ?? DEFAULT_VIEWPORT_DIMENSIONS[viewport]
      const connections = graph.edges.filter((edge) => edge.source === node.id).map((edge) => ({ ...edge, targetName: graph.nodes.find((entry) => entry.id === edge.target)?.screen.name ?? edge.target }))
      return {
        id: node.id, type: 'screen', dragHandle: '.screen-drag-handle',
        position: experience ? { x: 0, y: 0 } : dragPositions[node.id] ?? node.position,
        initialWidth: experience ? dimensions.width + 2 : FLOW_CARD_WIDTH,
        initialHeight: experience ? dimensions.height + 48 : FLOW_CARD_HEIGHT + connections.length * FLOW_CONNECTION_HEIGHT,
        ariaLabel: node.screen.name,
        data: { node, viewport, selected: false, related: selectedId === null || neighbors.has(node.id), zoom, prototype: config, connections, onSelect, onFollow: focusNode },
      }
    })
    return { nodes: applyFlowNodeSelection(baseNodes, selectedId), edges: experience ? [] : flowBoardEdges(graph, selectedId) }
  }, [graph, viewport, experience, experienceId, selectedId, prototype, prototypeForNode, dragPositions, onSelect, focusNode, zoom])

  const nodeSetKey = graph.nodes.map((node) => node.id).join('|')
  const dimensions = prototype.dimensions ?? DEFAULT_VIEWPORT_DIMENSIONS[viewport]
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
      nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      onInit={(instance) => { instanceRef.current = instance }}
      onMove={(_, state) => setZoom(state.zoom)}
      minZoom={0.08} maxZoom={4} nodesConnectable={false} nodesDraggable={editable}
      onNodeDrag={(_, node) => setDragPositions((current) => ({ ...current, [node.id]: node.position }))}
      onNodeDragStop={(_, node) => { onPositionChange?.(node.id, node.position); setDragPositions((current) => { const next = { ...current }; delete next[node.id]; return next }) }}
      onNodeClick={(_, node) => { if (!experience) onSelect(node.id) }}
      onNodeDoubleClick={(_, node) => { if (!experience) focusNode(node.id) }}
      onPaneClick={() => { if (!experience) onSelect(null) }}
      onEdgeClick={(_, edge) => onSelect(edge.source)}
      zoomOnDoubleClick={false} onlyRenderVisibleElements
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} color="var(--color-border-strong)" />
      {!experience ? <MiniMap pannable zoomable nodeColor={(node) => node.id === selectedId ? 'var(--color-accent)' : 'var(--color-border-strong)'} className="!border !border-border !bg-surface" /> : null}
      <Controls showInteractive={false} className="!border-border !bg-surface [&>button]:!border-border [&>button]:!bg-surface" />
    </ReactFlow>
    {!experience ? <div className="absolute top-3 left-3 flex items-center gap-3 rounded-lg border bg-surface/95 px-3 py-2 text-xs shadow-sm"><button type="button" className="font-medium text-accent" onClick={() => { onSelect(null); void instanceRef.current?.fitView({ padding: 0.15, maxZoom: 1, duration: 300 }) }}>전체 흐름</button>{selectedId === null ? <span className="text-text-subtle">화면 선택 · 더블클릭으로 확대</span> : <button type="button" onClick={() => focusNode(selectedId)}>선택 화면 확대</button>}</div> : null}
  </section>
}
