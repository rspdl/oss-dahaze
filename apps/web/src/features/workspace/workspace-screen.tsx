'use client'

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useListTree, type TreeEntryResponse } from '@dahaze/api-client'
import {
  EmptyState,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TooltipProvider,
} from '@dahaze/ui'

import { RequireSession } from '@/features/auth/require-session'
import { WireframeView } from '@/features/wireframe/wireframe-view'
import {
  DEFAULT_PROJECT_VIEW,
  PROJECT_VIEWS,
  activeRoute,
  viewHref,
  type ProjectViewId,
} from '@/features/navigation/views'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { FileTextIcon, FlowIcon, HierarchyIcon } from '@/shared/ui/icons'
import { useSidebarStore } from '@/shared/ui/sidebar-store'
import { AgentPanel } from './agent-panel'
import { CallView, CommitView } from './change-views'
import { ChangesPanel, HistoryPanel } from './changes-panel'
import { FileEditor } from './file-editor'
import { FileTree } from './file-tree'
import type { IaLocation } from './ia-outline'
import { IaView } from './ia-view'
import { useProjectEvents } from './use-project-events'
import { useWorkspaceStore } from './workspace-store'

/**
 * 작업공간: 파일 트리(앱 왼쪽 기둥) · 메인 뷰(가운데) · AI 대화(오른쪽).
 *
 * 파일 트리는 화면 안의 패널이 아니라 앱 기둥에 들어간다(`AppShell` 의 `sidebar`). 가운데 위쪽의
 * 선택 바가 같은 작업 트리를 어떤 뷰로 볼지 고른다 — "문서"는 사용자가 고른 파일·commit diff·
 * 도구 호출 diff 를, "IA"는 컴파일 결과의 정보구조와 화면 흐름을, "와이어프레임"은 화면 목업과
 * 그 사이 경로를 보여준다. 뷰는 주소에 있다.
 *
 * AI 가 파일을 바꿔도 가운데는 저절로 바뀌지 않는다 (docs/plans/agent-workspace.md "화면").
 * 변경은 프로젝트 이벤트 스트림으로 들어온다. MCP 클라이언트가 바꾼 파일도 같은 길로 반영된다.
 */
export function WorkspaceScreen({ projectId }: { projectId: string }) {
  const pathname = usePathname()
  const view = activeRoute(pathname).view ?? DEFAULT_PROJECT_VIEW
  const label = PROJECT_VIEWS.find((entry) => entry.id === view)?.label

  /* 기둥의 트리와 가운데가 같은 저장소를 읽으므로, 둘 중 어느 것이 먼저 그려지든 프로젝트가 맞아야 한다. */
  const enter = useWorkspaceStore((state) => state.enter)
  useEffect(() => enter(projectId), [enter, projectId])

  return (
    <AppShell
      breadcrumb={<Crumb>{label}</Crumb>}
      fullBleed
      lockToViewport
      flush
      sidebar={<WorkspaceSidebar projectId={projectId} />}
    >
      <RequireSession>
        <TooltipProvider delayDuration={300}>
          <Workspace projectId={projectId} view={view} />
        </TooltipProvider>
      </RequireSession>
    </AppShell>
  )
}

/**
 * 앱 기둥에 들어가는 문서 트리와 변경·이력. 기둥이 로그인한 경우에만 그린다.
 *
 * 좁은 화면에서는 기둥이 서랍이다. 파일을 고르면 경로는 그대로라 서랍이 스스로 닫히지 않으므로,
 * 가운데에 보이는 것이 바뀌면 여기서 닫는다.
 */
function WorkspaceSidebar({ projectId }: { projectId: string }) {
  const tree = useListTree<TreeEntryResponse[]>(projectId)
  const lockedPaths = useMemo(
    () => new Set((tree.data ?? []).filter((entry) => entry.locked_by).map((entry) => entry.path)),
    [tree.data],
  )

  const center = useWorkspaceStore((state) => state.center)
  const setMobileOpen = useSidebarStore((state) => state.setMobileOpen)
  useEffect(() => setMobileOpen(false), [center, setMobileOpen])

  return (
    <nav aria-label="작업 트리" className="flex min-h-0 flex-1 flex-col">
      <FileTree projectId={projectId} />
      <ChangesPanel projectId={projectId} lockedPaths={lockedPaths} />
      <HistoryPanel projectId={projectId} />
    </nav>
  )
}

const VIEW_ICONS: Record<ProjectViewId, ReactNode> = {
  documents: <FileTextIcon />,
  ia: <HierarchyIcon />,
  wireframe: <FlowIcon />,
}

function Workspace({ projectId, view }: { projectId: string; view: ProjectViewId }) {
  useProjectEvents(projectId)
  const router = useRouter()
  const openFile = useWorkspaceStore((state) => state.openFile)
  const center = useWorkspaceStore((state) => state.center)

  /*
    가운데에 보일 것을 고르면(파일·commit·도구 카드·IA 항목) "문서" 뷰로 옮긴다. 다른 뷰에 있는
    채로 고르면 누른 결과가 보이지 않는다. 처음 그릴 때는 옮기지 않는다 — 주소로 연 뷰를 지킨다.
  */
  const shownCenter = useRef(center)
  useEffect(() => {
    if (shownCenter.current === center) return
    shownCenter.current = center
    if (view !== 'documents') router.push(viewHref(projectId, 'documents'))
  }, [center, view, projectId, router])

  const openInDocuments = (location: IaLocation) => openFile(location.path, location.line)

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel defaultSize="65" minSize="35">
        {/*
          뷰 전환은 주소를 바꾼다. 방향키로 탭을 옮길 때마다 기록이 쌓이지 않도록 Enter·Space 로
          고를 때만 이동한다(`activationMode="manual"`).
        */}
        <Tabs
          value={view}
          onValueChange={(next) => {
            const target = PROJECT_VIEWS.find((entry) => entry.id === next)
            if (target !== undefined) router.push(viewHref(projectId, target.id))
          }}
          activationMode="manual"
          className="flex h-full min-h-0 flex-col gap-0 bg-surface"
        >
          <div className="flex h-11 shrink-0 items-center border-b px-3">
            <TabsList variant="line" aria-label="보기">
              {PROJECT_VIEWS.map((entry) => (
                <TabsTrigger key={entry.id} value={entry.id} title={entry.description}>
                  {VIEW_ICONS[entry.id]}
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="documents" className="flex min-h-0 flex-col">
            <Center projectId={projectId} />
          </TabsContent>
          <TabsContent value="ia" className="flex min-h-0 flex-col">
            <IaView projectId={projectId} onOpen={openInDocuments} />
          </TabsContent>
          <TabsContent value="wireframe" className="flex min-h-0 flex-col">
            <WireframeView projectId={projectId} onOpen={(location) => openFile(location.path, location.line)} />
          </TabsContent>
        </Tabs>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="35" minSize="22" maxSize="50">
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
      return (
        <FileEditor
          key={`${center.path}:${center.line ?? ''}`}
          projectId={projectId}
          path={center.path}
          line={center.line}
        />
      )
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
