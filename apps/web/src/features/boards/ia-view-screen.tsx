'use client'

import { useMemo, useState } from 'react'

import { RequireSession } from '@/features/auth/require-session'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { BoardGate } from './board-gate'
import { IaBoard } from './ia-board'
import { buildIaTree, UNCATEGORIZED_ID, type IaNode } from './ia-tree'
import { SourcePanel } from './source-panel'
import { useBoardData } from './use-board-data'

/** 선언된 정보구조를 트리로 보는 화면. */
export function IaViewScreen({ projectId }: { projectId: string }) {
  return (
    <AppShell breadcrumb={<Crumb>화면 구조</Crumb>} fullBleed lockToViewport>
      <RequireSession>
        <IaView projectId={projectId} />
      </RequireSession>
    </AppShell>
  )
}

function IaView({ projectId }: { projectId: string }) {
  const data = useBoardData(projectId)
  const tree = useMemo(() => buildIaTree(data.board), [data.board])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected: IaNode | null =
    tree.nodes.find((node) => node.id === selectedId) ?? tree.nodes[0] ?? null

  return (
    <BoardGate
      projectId={projectId}
      data={data}
      isEmpty={tree.nodes.length === 0}
      emptyTitle="선언된 화면이 없습니다"
      emptyDescription="문서에 화면을 선언하고 머리말의 `정보구조:` 로 묶으면, 그 계층이 여기에 트리로 나타납니다."
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="border-b pb-4">
          <p className="text-xs font-medium tracking-[0.14em] text-text-subtle">
            INFORMATION ARCHITECTURE
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-text">화면 구조</h1>
          <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-text-muted">
            선언된 분류와 화면을 선언한 순서 그대로 그렸습니다. 정보구조에서 형제의 순서는 곧
            메뉴 순서입니다.
          </p>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-text-subtle">
            <div>
              <dt className="sr-only">분류</dt>
              <dd>
                <span className="font-mono text-text">{data.board.categories.length}</span> 분류
              </dd>
            </div>
            <div>
              <dt className="sr-only">화면</dt>
              <dd>
                <span className="font-mono text-text">{data.board.screens.length}</span> 화면
              </dd>
            </div>
            <div>
              <dt className="sr-only">RSPDL 버전</dt>
              <dd className="font-mono">rspdl {data.compilation.data?.rspdl_version}</dd>
            </div>
          </dl>
        </header>

        <div className="flex min-h-0 flex-1 flex-col pt-4 md:flex-row md:gap-4">
          <IaBoard tree={tree} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
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
  node: IaNode | null
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
        emptyMessage="노드를 고르면 그 선언의 원문을 봅니다."
      />
    )
  }

  /* 미분류 묶음은 IR 에 없다. 원문이 없다고 말하는 것이 지어낸 자리를 가리키는 것보다 낫다. */
  if (node.synthetic) {
    return (
      <SourcePanel
        projectId={projectId}
        documentId={null}
        documentTitle={null}
        path={null}
        span={null}
        title={node.name}
        subtitle={`${UNCATEGORIZED_ID}`}
        emptyMessage="어느 분류에도 담기지 않은 화면을 모은 자리입니다. 문서에 선언된 것이 아니므로 원문이 없습니다."
      />
    )
  }

  const path = node.category?.path ?? node.screen?.path ?? null
  const span = node.category?.span ?? node.screen?.span ?? null
  const document = path === null ? undefined : data.documentsByPath.get(path)

  return (
    <SourcePanel
      projectId={projectId}
      documentId={document?.id ?? null}
      documentTitle={document?.title ?? null}
      path={path}
      span={span}
      title={node.name}
      subtitle={node.category?.id ?? node.screen?.id ?? null}
      emptyMessage="원문을 찾지 못했습니다."
    />
  )
}
