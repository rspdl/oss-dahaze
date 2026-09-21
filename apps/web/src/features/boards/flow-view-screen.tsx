'use client'

import { useMemo, useState } from 'react'
import { cn } from '@dahaze/ui'

import { RequireSession } from '@/features/auth/require-session'
import type { MockupViewport } from '@/features/mockup/screen-mockup'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { screenSourceSpan } from './board-ir'
import { BoardGate } from './board-gate'
import { FlowBoard } from './flow-board'
import { buildFlowGraph, type FlowNode } from './flow-graph'
import { SourcePanel } from './source-panel'
import { useBoardData } from './use-board-data'

/** 선언된 화면과 그 사이 경로를 목업으로 보는 화면. */
export function FlowViewScreen({ projectId }: { projectId: string }) {
  return (
    <AppShell breadcrumb={<Crumb>화면 흐름</Crumb>} fullBleed lockToViewport>
      <RequireSession>
        <FlowView projectId={projectId} />
      </RequireSession>
    </AppShell>
  )
}

const VIEWPORTS: { id: MockupViewport; label: string }[] = [
  { id: 'desktop', label: '데스크톱' },
  { id: 'mobile', label: '모바일' },
]

function FlowView({ projectId }: { projectId: string }) {
  const data = useBoardData(projectId)
  /* 뷰포트는 아직 화면 안의 상태다. 프로젝트마다 고르는 설정으로 서버에 올리는 것은
     다음 슬라이스의 일이다 (RFC-0001 저장하는 것). */
  const [viewport, setViewport] = useState<MockupViewport>('desktop')
  const graph = useMemo(
    () => buildFlowGraph(data.board, data.mockups.screens, viewport),
    [data.board, data.mockups.screens, viewport],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected: FlowNode | null =
    graph.nodes.find((node) => node.id === selectedId) ?? graph.nodes[0] ?? null

  const withLayout = graph.nodes.filter((node) => node.mockup !== null).length

  return (
    <BoardGate
      projectId={projectId}
      data={data}
      isEmpty={graph.nodes.length === 0}
      emptyTitle="선언된 화면이 없습니다"
      emptyDescription="문서에 화면을 선언하면 이곳에 나타나고, 머리말의 `화면:` 으로 레이아웃을 선언하면 그 화면이 그려집니다."
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-[0.14em] text-text-subtle">SCREEN FLOW</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-text">화면 흐름</h1>
            <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-text-muted">
              선언된 레이아웃을 그대로 그리고, 선언된 경로를 화살표로 이었습니다. 레이아웃이
              없는 화면은 빈 상자로 둡니다.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-text-subtle">
              <div>
                <dt className="sr-only">화면</dt>
                <dd>
                  <span className="font-mono text-text">{graph.nodes.length}</span> 화면
                </dd>
              </div>
              <div>
                <dt className="sr-only">레이아웃</dt>
                <dd>
                  <span className="font-mono text-text">{withLayout}</span> 레이아웃
                </dd>
              </div>
              <div>
                <dt className="sr-only">경로</dt>
                <dd>
                  <span className="font-mono text-text">{graph.edges.length}</span> 경로
                </dd>
              </div>
            </dl>
            <div
              role="group"
              aria-label="목업 폭"
              className="flex shrink-0 gap-1 rounded-control border p-0.5"
            >
              {VIEWPORTS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={viewport === entry.id}
                  onClick={() => setViewport(entry.id)}
                  className={cn(
                    'rounded-control px-2.5 py-1 text-xs font-medium transition-colors duration-200 ease-out-expo',
                    viewport === entry.id
                      ? 'bg-accent-subtle text-text'
                      : 'text-text-muted hover:text-text',
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        {graph.danglingPaths.length === 0 ? null : (
          <p className="mt-3 rounded-control border border-diagnostic-warning/40 bg-diagnostic-warning/5 px-3 py-2 text-xs text-text-muted">
            끝점을 찾지 못한 경로 {graph.danglingPaths.length}건은 그리지 않았습니다. 문서 편집
            화면에서 컴파일러 진단을 확인하세요.
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col pt-4 md:flex-row md:gap-4">
          <FlowBoard
            graph={graph}
            viewport={viewport}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
          />
          <SelectedSource projectId={projectId} data={data} node={selected} />
        </div>
      </div>
    </BoardGate>
  )
}

function SelectedSource({
  projectId,
  data,
  node,
}: {
  projectId: string
  data: ReturnType<typeof useBoardData>
  node: FlowNode | null
}) {
  if (node === null) {
    return (
      <SourcePanel
        projectId={projectId}
        documentId={null}
        documentTitle={null}
        path={null}
        span={null}
        title="선택한 것이 없습니다"
        subtitle={null}
        emptyMessage="화면을 고르면 그 선언의 원문을 봅니다."
      />
    )
  }

  const document = data.documentsByPath.get(node.screen.path)

  return (
    <SourcePanel
      projectId={projectId}
      documentId={document?.id ?? null}
      documentTitle={document?.title ?? null}
      path={node.screen.path}
      span={screenSourceSpan(node.screen)}
      title={node.screen.name}
      subtitle={node.screen.id}
      emptyMessage="원문을 찾지 못했습니다."
    />
  )
}
