'use client'

import { useEffect, useMemo } from 'react'
import { useListTree, type TreeEntryResponse } from '@dahaze/api-client'
import {
  EmptyState,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  TooltipProvider,
} from '@dahaze/ui'

import { RequireSession } from '@/features/auth/require-session'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { FileTextIcon } from '@/shared/ui/icons'
import { AgentPanel } from './agent-panel'
import { CallView, CommitView } from './change-views'
import { ChangesPanel, HistoryPanel } from './changes-panel'
import { FileEditor } from './file-editor'
import { FileTree } from './file-tree'
import { useProjectEvents } from './use-project-events'
import { useWorkspaceStore } from './workspace-store'

/**
 * 작업공간: 파일 트리(왼쪽) · 에디터(가운데) · AI 대화(오른쪽).
 *
 * 대화가 중심이고 가운데는 사용자가 고른 것을 보여준다 — 파일, commit diff, 도구 호출 diff.
 * AI 가 파일을 바꿔도 가운데는 저절로 바뀌지 않는다 (docs/plans/agent-workspace.md "화면").
 *
 * 변경은 프로젝트 이벤트 스트림으로 들어온다. MCP 클라이언트가 바꾼 파일도 같은 길로 반영된다.
 */
export function WorkspaceScreen({ projectId }: { projectId: string }) {
  return (
    <AppShell breadcrumb={<Crumb>작업공간</Crumb>} fullBleed lockToViewport flush>
      <RequireSession>
        <TooltipProvider delayDuration={300}>
          <Workspace projectId={projectId} />
        </TooltipProvider>
      </RequireSession>
    </AppShell>
  )
}

function Workspace({ projectId }: { projectId: string }) {
  const enter = useWorkspaceStore((state) => state.enter)
  useEffect(() => enter(projectId), [enter, projectId])
  useProjectEvents(projectId)

  const tree = useListTree<TreeEntryResponse[]>(projectId)
  const lockedPaths = useMemo(
    () => new Set((tree.data ?? []).filter((entry) => entry.locked_by).map((entry) => entry.path)),
    [tree.data],
  )

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel defaultSize="20" minSize="14" maxSize="35">
        <nav aria-label="작업 트리" className="flex h-full min-h-0 flex-col bg-canvas-subtle">
          <FileTree projectId={projectId} />
          <ChangesPanel projectId={projectId} lockedPaths={lockedPaths} />
          <HistoryPanel projectId={projectId} />
        </nav>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="50" minSize="30">
        <main className="flex h-full min-h-0 flex-col bg-surface">
          <Center projectId={projectId} />
        </main>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="30" minSize="22" maxSize="45">
        <div className="flex h-full min-h-0 flex-col">
          <AgentPanel projectId={projectId} />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function Center({ projectId }: { projectId: string }) {
  const center = useWorkspaceStore((state) => state.center)
  switch (center.kind) {
    case 'file':
      return <FileEditor key={center.path} projectId={projectId} path={center.path} />
    case 'commit':
      return <CommitView commitId={center.commitId} />
    case 'call':
      return <CallView sessionId={center.sessionId} callId={center.callId} />
    case 'empty':
      return (
        <div className="flex flex-1 items-center justify-center p-8">
          <EmptyState
            icon={<FileTextIcon className="size-6" />}
            title="열린 파일이 없어요"
            description="왼쪽에서 파일을 고르거나, 대화의 도구 카드를 눌러 바뀐 내용을 보세요."
          />
        </div>
      )
  }
}
