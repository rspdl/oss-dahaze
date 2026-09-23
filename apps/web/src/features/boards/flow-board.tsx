'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  type ReactFlowInstance,
} from '@xyflow/react'
import { cn } from '@dahaze/ui'

import { DEFAULT_VIEWPORT_DIMENSIONS, ScreenMockupFrame, type MockupViewport, type ScreenMockupFrameProps } from '../mockup/screen-mockup'
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

/** 선택만 바뀌면 나머지 노드 객체를 그대로 보존해 ReactFlow의 node update 범위를 제한한다. */
export function applyFlowNodeSelection(
  nodes: ScreenFlowNode[],
  selectedId: string | null,
): ScreenFlowNode[] {
  return nodes.map((node) => {
    const selected = node.id === selectedId
    const detailed = node.data.detailed || selected
    if (node.data.selected === selected && node.data.detailed === detailed) return node
    return { ...node, data: { ...node.data, selected, detailed } }
  })
}

export function fitSelectedFlowNode(
  instance: Pick<ReactFlowInstance<ScreenFlowNode, Edge>, 'fitBounds' | 'getInternalNode'>,
  selectedId: string | null,
  minimumDimensions: { width: number; height: number },
): boolean {
  if (selectedId === null) return false
  const selectedNode = instance.getInternalNode(selectedId)
  const width = selectedNode?.measured.width
  const height = selectedNode?.measured.height
  if (selectedNode === undefined || width === undefined || height === undefined
    || width < minimumDimensions.width || height < minimumDimensions.height) return false

  void instance.fitBounds({
    x: selectedNode.internals.positionAbsolute.x,
    y: selectedNode.internals.positionAbsolute.y,
    width,
    height,
  }, {
    padding: 0.18,
    duration: 200,
  })
  return true
}

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
  const instanceRef = useRef<ReactFlowInstance<ScreenFlowNode, Edge> | null>(null)
  const fitFrameRef = useRef<number | null>(null)
  const experienceSelectedId = prototype.mode === 'experience' ? selectedId : null
  const { baseNodes, edges } = useMemo(() => {
    const visibleNodes = experienceSelectedId === null ? graph.nodes : graph.nodes.filter((node) => node.id === experienceSelectedId)
    const baseNodes: ScreenFlowNode[] = visibleNodes.map((node) => ({
      id: node.id,
      type: 'screen',
      position: prototype.mode === 'experience' ? { x: 0, y: 0 } : node.position,
      data: { node, viewport, selected: false, detailed: prototype.mode === 'experience' || zoom >= 0.35, prototype: prototypeForNode?.(node) ?? prototype },
    }))
    const visibleIds = new Set(baseNodes.map((node) => node.id))
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
    return { baseNodes, edges }
  }, [experienceSelectedId, graph, prototype, prototypeForNode, viewport, zoom])
  const nodes = useMemo(
    () => applyFlowNodeSelection(baseNodes, selectedId),
    [baseNodes, selectedId],
  )
  const selectedGraphNode = graph.nodes.find((node) => node.id === selectedId)
  const selectedPrototype = selectedGraphNode === undefined
    ? prototype
    : prototypeForNode?.(selectedGraphNode) ?? prototype
  const selectedDimensions = selectedPrototype.dimensions ?? DEFAULT_VIEWPORT_DIMENSIONS[viewport]
  const fitSelection = useCallback((instance: ReactFlowInstance<ScreenFlowNode, Edge>) => {
    if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current)
    if (selectedId === null || selectedGraphNode === undefined) return

    const position = prototype.mode === 'experience' ? { x: 0, y: 0 } : selectedGraphNode.position
    const minimumDimensions = { width: selectedDimensions.width, height: selectedDimensions.height }

    // 가상화된 먼 노드는 아직 내부 노드나 측정값이 없다. 알려진 레이아웃 사각형을 먼저
    // 맞춰 mount시킨 뒤, 상세 카드의 새 크기가 측정되었을 때만 실제 경계로 보정한다.
    // fitView는 측정되지 않은 단일 노드를 전체 그래프로 fallback하므로 이 경로에서 쓰지 않는다.
    void instance.fitBounds({
      x: position.x,
      y: position.y,
      width: selectedDimensions.width + 2,
      height: selectedDimensions.height + 48,
    }, { padding: 0.18, duration: 0 })

    let remainingFrames = 12
    const refineMeasuredBounds = () => {
      if (fitSelectedFlowNode(instance, selectedId, minimumDimensions) || remainingFrames === 0) {
        fitFrameRef.current = null
        return
      }
      remainingFrames -= 1
      fitFrameRef.current = requestAnimationFrame(refineMeasuredBounds)
    }
    fitFrameRef.current = requestAnimationFrame(refineMeasuredBounds)
  }, [prototype.mode, selectedDimensions.height, selectedDimensions.width, selectedGraphNode, selectedId])
  useEffect(() => {
    if (instanceRef.current !== null) fitSelection(instanceRef.current)
    return () => {
      if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current)
    }
  }, [fitSelection])

  return (
    <section
      aria-label="화면 흐름"
      className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-surface-raised/30"
    >
      <ReactFlow<ScreenFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 0.9 }}
        onInit={(instance) => { instanceRef.current = instance; fitSelection(instance) }}
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
