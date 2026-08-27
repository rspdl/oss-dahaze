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

import type { DataModelEntry, DataModelRelation } from './data-models'

interface ModelNodeData extends Record<string, unknown> {
  model: DataModelEntry
  selected: boolean
}

type ModelNode = Node<ModelNodeData, 'model'>

const ModelNodeCard = memo(function ModelNodeCard({ data }: NodeProps<ModelNode>) {
  const { model, selected } = data

  return (
    <article
      className={cn(
        'w-72 overflow-hidden rounded-lg border bg-surface shadow-[0_12px_32px_-24px_rgba(24,31,39,0.34)] transition-[border-color,transform] duration-200 ease-out-expo',
        selected ? 'border-accent ring-1 ring-accent/30' : 'border-border',
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-accent" />
      <header className="border-b bg-surface-raised/70 px-4 py-3">
        <p className="truncate text-sm font-semibold tracking-tight text-text">{model.name}</p>
        <p className="mt-0.5 truncate font-mono text-[11px] text-text-subtle">{model.id}</p>
      </header>
      <ul className="divide-y">
        {model.fields.slice(0, 7).map((field) => (
          <li key={field.id} className="flex items-center gap-2 px-4 py-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-text-muted">{field.name}</span>
            {field.required ? <span className="text-accent">필수</span> : null}
            <span className="shrink-0 font-mono text-text-subtle">{field.typeKind}</span>
          </li>
        ))}
        {model.fields.length > 7 ? (
          <li className="px-4 py-2 font-mono text-[11px] text-text-subtle">
            +{model.fields.length - 7} fields
          </li>
        ) : null}
      </ul>
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-accent" />
    </article>
  )
})

const nodeTypes = { model: ModelNodeCard }

function nodePosition(index: number) {
  const columns = 3
  return { x: (index % columns) * 360, y: Math.floor(index / columns) * 330 }
}

export function ErdDiagram({
  models,
  relations,
  selectedKey,
  onSelectModel,
}: {
  models: DataModelEntry[]
  relations: DataModelRelation[]
  selectedKey: string | null
  onSelectModel: (key: string) => void
}) {
  const { nodes, edges } = useMemo(() => {
    const visible = new Set(models.map((model) => model.key))
    const nodes: ModelNode[] = models.map((model, index) => ({
      id: model.key,
      type: 'model',
      position: nodePosition(index),
      data: { model, selected: model.key === selectedKey },
    }))
    const edges: Edge[] = relations
      .filter((relation) => visible.has(relation.sourceKey) && visible.has(relation.targetKey))
      .map((relation) => ({
        id: relation.id,
        source: relation.sourceKey,
        target: relation.targetKey,
        type: 'smoothstep',
        label:
          relation.constraints.length === 0
            ? relation.name
            : `${relation.name} · ${relation.constraints.join(' · ')}`,
        labelStyle: { fill: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600 },
        labelBgStyle: { fill: 'var(--color-surface)', fillOpacity: 0.92 },
        labelBgPadding: [5, 3],
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-accent)' },
        style: { stroke: 'var(--color-accent)', strokeWidth: 1.5 },
        animated: false,
        ariaLabel: `${relation.name}: ${relation.constraints.join(', ') || '관계'}`,
      }))
    return { nodes, edges }
  }, [models, relations, selectedKey])

  return (
    <section aria-label="엔터티 관계 다이어그램" className="relative min-h-[34rem] overflow-hidden rounded-lg border bg-surface-raised/30">
      <ReactFlow<ModelNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1.1 }}
        minZoom={0.25}
        maxZoom={1.6}
        nodesConnectable={false}
        onNodeClick={(_, node) => onSelectModel(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="var(--color-border)" />
        <MiniMap
          pannable
          zoomable
          nodeColor="var(--color-accent)"
          className="!border !border-border !bg-surface"
        />
        <Controls showInteractive={false} className="!border-border !bg-surface [&>button]:!border-border [&>button]:!bg-surface" />
      </ReactFlow>
      <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="bg-surface/90 font-mono text-[11px]">{models.length} entities</Badge>
        <Badge variant="outline" className="bg-surface/90 font-mono text-[11px]">{edges.length} relations</Badge>
      </div>
      {relations.length === 0 ? (
        <p className="pointer-events-none absolute bottom-4 left-4 max-w-sm bg-surface/90 px-3 py-2 text-xs leading-relaxed text-text-muted">
          선언된 모델은 보이지만, 연결할 관계가 없습니다. “A는 B를 역할로 가질 수 있다”처럼 관계를 선언하면 선으로 나타납니다.
        </p>
      ) : null}
    </section>
  )
}
