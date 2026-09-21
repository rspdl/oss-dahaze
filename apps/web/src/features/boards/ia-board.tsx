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
import { Badge, cn } from '@dahaze/ui'

import type { IaNode, IaTree } from './ia-tree'

/**
 * 정보구조를 트리로 그린다.
 *
 * **여기에 목업이 없다.** 흐름 보드의 노드가 목업이고, 이 보드의 노드는 구조 상자다.
 * 구조를 읽는 눈과 화면을 뜯어보는 눈을 한 화면에서 섞지 않는 것이 보드를 둘로 나눈 이유다.
 */

interface IaNodeData extends Record<string, unknown> {
  node: IaNode
  selected: boolean
}

type IaFlowNode = Node<IaNodeData, 'ia'>

const IaNodeCard = memo(function IaNodeCard({ data }: NodeProps<IaFlowNode>) {
  const { node, selected } = data
  const isCategory = node.kind === 'category'

  return (
    <article
      className={cn(
        'w-64 overflow-hidden rounded-lg border bg-surface px-3.5 py-2.5 shadow-[0_12px_32px_-24px_rgba(24,31,39,0.34)] transition-[border-color] duration-200 ease-out-expo',
        selected ? 'border-accent ring-1 ring-accent/30' : 'border-border',
        isCategory ? 'bg-surface-raised/70' : 'bg-surface',
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-accent" />
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-text">
          {node.name}
        </p>
        <Badge variant="outline" className="shrink-0 text-[10px] text-text-muted">
          {isCategory ? '분류' : '화면'}
        </Badge>
      </div>
      {node.synthetic ? (
        <p className="mt-0.5 text-[11px] text-text-subtle">문서에 선언되지 않은 묶음</p>
      ) : (
        <p className="mt-0.5 truncate font-mono text-[11px] text-text-subtle">
          {node.category?.id ?? node.screen?.id}
        </p>
      )}
      {node.screen !== null && !node.screen.hasLayout ? (
        <p className="mt-1 text-[11px] text-text-subtle">레이아웃 없음</p>
      ) : null}
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-accent" />
    </article>
  )
})

const nodeTypes = { ia: IaNodeCard }

export function IaBoard({
  tree,
  selectedId,
  onSelect,
}: {
  tree: IaTree
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: IaFlowNode[] = tree.nodes.map((node) => ({
      id: node.id,
      type: 'ia',
      position: node.position,
      data: { node, selected: node.id === selectedId },
    }))
    const edges: Edge[] = tree.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-accent)' },
      style: { stroke: 'var(--color-accent)', strokeWidth: 1.5 },
    }))
    return { nodes, edges }
  }, [tree, selectedId])

  return (
    <section
      aria-label="정보구조 트리"
      className="relative min-h-[34rem] flex-1 overflow-hidden rounded-lg border bg-surface-raised/30"
    >
      <ReactFlow<IaFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        minZoom={0.2}
        maxZoom={1.6}
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
