'use client'

import { memo, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { cn } from '@dahaze/ui'

import { DEFAULT_VIEWPORT_DIMENSIONS, ScreenMockupFrame, type MockupViewport, type ScreenMockupFrameProps } from '@/features/mockup/screen-mockup'
import type { FlowGraph, FlowNode } from './flow-graph'

/**
 * 화면 흐름을 그린다. **노드가 목업 그 자체다.**
 *
 * 레이아웃을 선언하지 않은 화면은 빈 상자로 선다. 조작 선언에서 모양을 유추하지 않는다 —
 * 유추한 화면은 기획자가 쓰지 않은 것을 쓴 것처럼 보이게 한다. 대신 다음 슬라이스가
 * 레이아웃 초안을 **문서에 넣을 텍스트**로 제안한다 (RFC-0001).
 *
 * 이 슬라이스에서 보드는 거울이다. 아무것도 쓰지 않는다.
 */

interface FlowNodeData extends Record<string, unknown> {
  node: FlowNode
  viewport: MockupViewport
  selected: boolean
  prototype: Omit<ScreenMockupFrameProps, 'screen' | 'viewport'>
  detailed: boolean
}

type ScreenFlowNode = Node<FlowNodeData, 'screen'>

const ScreenNodeCard = memo(function ScreenNodeCard({ data }: NodeProps<ScreenFlowNode>) {
  const { node, viewport, selected, prototype, detailed } = data

  return (
    <div
      className={cn(
        'rounded-xl border-2 transition-[border-color] duration-200 ease-out-expo',
        selected ? 'border-accent' : 'border-transparent',
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2.5 !border-0 !bg-accent" />
      {!detailed ? <div className="flex h-28 w-72 flex-col justify-center rounded-lg border bg-surface px-4"><p className="truncate text-sm font-semibold text-text">{node.screen.name}</p><p className="mt-1 truncate font-mono text-[11px] text-text-subtle">{node.screen.id}</p><p className="mt-2 text-[11px] text-text-muted">{node.mockup === null ? '레이아웃 없음' : `요소 ${node.mockup.elements.length}개`}</p></div> : node.mockup === null ? (
        <EmptyScreenBox name={node.screen.name} id={node.screen.id} viewport={viewport} dimensions={prototype.dimensions} />
      ) : (
        <ScreenMockupFrame screen={node.mockup} viewport={viewport} {...prototype} />
      )}
      <Handle type="source" position={Position.Right} className="!size-2.5 !border-0 !bg-accent" />
    </div>
  )
})

/** 레이아웃을 선언하지 않은 화면. 이름만 있고 안은 비어 있다. */
function EmptyScreenBox({
  name,
  id,
  viewport,
  dimensions,
}: {
  name: string
  id: string
  viewport: MockupViewport
  dimensions?: { width: number; height: number }
}) {
  const viewportDimensions = dimensions ?? DEFAULT_VIEWPORT_DIMENSIONS[viewport]
  return (
    <figure
      className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-dashed border-border bg-canvas"
      style={{ width: viewportDimensions.width + 2 }}
    >
      <figcaption className="border-b border-border bg-surface px-4 py-2">
        <span className="text-xs font-semibold text-text">{name}</span>
      </figcaption>
      <div data-mockup-viewport className="flex shrink-0 flex-col items-center justify-center gap-1 overflow-hidden px-4 py-14" style={viewportDimensions}>
        <p className="text-sm text-text-muted">레이아웃이 선언되지 않았습니다</p>
        <p className="font-mono text-[11px] text-text-subtle">{id}</p>
      </div>
    </figure>
  )
}

const nodeTypes = { screen: ScreenNodeCard }

export function FlowBoard({
  graph,
  viewport,
  selectedId,
  onSelect,
  prototype = {},
  prototypeForNode,
  editable = false,
  onPositionChange,
}: {
  graph: FlowGraph
  viewport: MockupViewport
  selectedId: string | null
  onSelect: (id: string) => void
  prototype?: Omit<ScreenMockupFrameProps, 'screen' | 'viewport'>
  prototypeForNode?: (node: FlowNode) => Omit<ScreenMockupFrameProps, 'screen' | 'viewport'>
  editable?: boolean
  onPositionChange?: (screenKey: string, position: { x: number; y: number }) => void
}) {
  const [zoom, setZoom] = useState(1)
  const { nodes, edges } = useMemo(() => {
    const visibleNodes = prototype.mode === 'experience' && selectedId !== null ? graph.nodes.filter((node) => node.id === selectedId) : graph.nodes
    const nodes: ScreenFlowNode[] = visibleNodes.map((node) => ({
      id: node.id,
      type: 'screen',
      position: prototype.mode === 'experience' ? { x: 0, y: 0 } : node.position,
      data: { node, viewport, selected: node.id === selectedId, detailed: prototype.mode === 'experience' || node.id === selectedId || zoom >= 0.35, prototype: prototypeForNode?.(node) ?? prototype },
    }))
    const visibleIds = new Set(nodes.map((node) => node.id))
    const edges: Edge[] = graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      label: edge.label,
      labelStyle: { fill: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600 },
      labelBgStyle: { fill: 'var(--color-surface)', fillOpacity: 0.92 },
      labelBgPadding: [5, 3] as [number, number],
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-accent)' },
      style: { stroke: 'var(--color-accent)', strokeWidth: 1.5 },
      ariaLabel: `${edge.path.sourceElementId}에서 출발: ${edge.label}`,
    }))
    return { nodes, edges }
  }, [graph, viewport, selectedId, prototype, prototypeForNode, zoom])

  return (
    <section
      aria-label="화면 흐름"
      className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-surface-raised/30"
    >
      <ReactFlow<ScreenFlowNode, Edge>
        key={`${prototype.mode ?? 'edit'}:${selectedId ?? 'all'}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 0.9 }}
        onInit={(instance) => { const selectedNode = nodes.find((node) => node.id === selectedId); if (selectedNode) void instance.fitView({ nodes: [selectedNode], padding: 0.18, maxZoom: 0.9, duration: 200 }) }}
        minZoom={0.05}
        maxZoom={1.4}
        nodesConnectable={false}
        nodesDraggable={editable}
        onNodeDragStop={(_, node) => onPositionChange?.(node.id, node.position)}
        onMove={(_, viewportState) => setZoom(viewportState.zoom)}
        onlyRenderVisibleElements
        onNodeClick={(_, node) => { if (prototype.mode !== 'experience') onSelect(node.id) }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="var(--color-border)" />
        {prototype.mode === 'experience' ? null : <MiniMap
          pannable
          zoomable
          nodeColor="var(--color-accent)"
          className="!border !border-border !bg-surface"
        />}
        <Controls
          showInteractive={false}
          className="!border-border !bg-surface [&>button]:!border-border [&>button]:!bg-surface"
        />
      </ReactFlow>
    </section>
  )
}
