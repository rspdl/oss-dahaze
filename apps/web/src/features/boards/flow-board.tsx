'use client'

import { memo, useMemo } from 'react'
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

import { ScreenMockupFrame, type MockupViewport } from '@/features/mockup/screen-mockup'
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
}

type ScreenFlowNode = Node<FlowNodeData, 'screen'>

const ScreenNodeCard = memo(function ScreenNodeCard({ data }: NodeProps<ScreenFlowNode>) {
  const { node, viewport, selected } = data

  return (
    <div
      className={cn(
        'rounded-xl border-2 transition-[border-color] duration-200 ease-out-expo',
        selected ? 'border-accent' : 'border-transparent',
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2.5 !border-0 !bg-accent" />
      {node.mockup === null ? (
        <EmptyScreenBox name={node.screen.name} id={node.screen.id} viewport={viewport} />
      ) : (
        <ScreenMockupFrame screen={node.mockup} viewport={viewport} />
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
}: {
  name: string
  id: string
  viewport: MockupViewport
}) {
  return (
    <figure
      className="flex flex-col overflow-hidden rounded-lg border border-dashed border-border bg-canvas"
      style={{ width: viewport === 'mobile' ? 390 : 1024 }}
    >
      <figcaption className="border-b border-border bg-surface px-4 py-2">
        <span className="text-xs font-semibold text-text">{name}</span>
      </figcaption>
      <div className="flex flex-col items-center gap-1 px-4 py-14">
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
}: {
  graph: FlowGraph
  viewport: MockupViewport
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: ScreenFlowNode[] = graph.nodes.map((node) => ({
      id: node.id,
      type: 'screen',
      position: node.position,
      data: { node, viewport, selected: node.id === selectedId },
    }))
    const edges: Edge[] = graph.edges.map((edge) => ({
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
  }, [graph, viewport, selectedId])

  return (
    <section
      aria-label="화면 흐름"
      className="relative min-h-[34rem] flex-1 overflow-hidden rounded-lg border bg-surface-raised/30"
    >
      <ReactFlow<ScreenFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 0.9 }}
        minZoom={0.05}
        maxZoom={1.4}
        nodesConnectable={false}
        nodesDraggable={false}
        onNodeClick={(_, node) => onSelect(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="var(--color-border)" />
        <MiniMap
          pannable
          zoomable
          nodeColor="var(--color-accent)"
          className="!border !border-border !bg-surface"
        />
        <Controls
          showInteractive={false}
          className="!border-border !bg-surface [&>button]:!border-border [&>button]:!bg-surface"
        />
      </ReactFlow>
    </section>
  )
}
