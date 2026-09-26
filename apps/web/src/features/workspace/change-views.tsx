'use client'

import { useMemo, type ReactNode } from 'react'
import {
  useGetCommit,
  useListAgentItems,
  type AgentItemResponse,
  type CommitChangeResponse,
  type CommitResponse,
} from '@dahaze/api-client'
import { Button, ErrorState, Skeleton } from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { diffLines, parseUnifiedDiff, summarizeDiff, toHunks } from '@/shared/diff-lines'
import { formatDateTime } from '@/shared/format'
import { XIcon } from '@/shared/ui/icons'
import { toAgentRows, toolTitle, type FileChange } from './agent-model'
import { DiffStat, DiffView } from './diff-view'
import { ChangeMark } from './file-tree'
import type { ChangeKind } from './tree-model'
import { useWorkspaceStore } from './workspace-store'

/** 가운데 영역에서 diff 를 볼 때의 머리글. 닫으면 가운데가 비고, 파일을 다시 고르면 된다. */
function ViewHeader({ title, meta }: { title: string; meta?: string }) {
  const closeCenter = useWorkspaceStore((state) => state.closeCenter)
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-body font-semibold text-text">{title}</h2>
      </div>
      {meta === undefined ? null : (
        <span className="shrink-0 text-caption text-text-subtle tabular-nums">{meta}</span>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="닫기" onClick={closeCenter}>
        <XIcon />
      </Button>
    </header>
  )
}

function FileSection({
  kind,
  title,
  openPath,
  added,
  removed,
  children,
}: {
  kind: ChangeKind
  title: string
  /** 머리글을 눌러 열 작업 트리 경로. 지운 파일이면 null. */
  openPath: string | null
  added: number
  removed: number
  children: ReactNode
}) {
  const openFile = useWorkspaceStore((state) => state.openFile)
  return (
    <section className="overflow-hidden rounded-panel border bg-surface">
      <header className="flex h-10 items-center gap-2 border-b bg-canvas-subtle px-3">
        <ChangeMark change={kind} />
        {openPath === null ? (
          <span className="min-w-0 flex-1 truncate font-mono text-body-sm text-text-muted">{title}</span>
        ) : (
          <button
            type="button"
            className="min-w-0 flex-1 truncate rounded-xs text-left font-mono text-body-sm text-text outline-none hover:underline focus-visible:focus-ring"
            onClick={() => openFile(openPath)}
          >
            {title}
          </button>
        )}
        <DiffStat added={added} removed={removed} />
      </header>
      {children}
    </section>
  )
}

function changeTitle(oldPath: string | null, newPath: string | null): string {
  if (oldPath !== null && newPath !== null && oldPath !== newPath) return `${oldPath} → ${newPath}`
  return newPath ?? oldPath ?? ''
}

export function CommitView({ commitId }: { commitId: string }) {
  const commit = useGetCommit<CommitResponse>(commitId)

  if (commit.isPending) return <CenterSkeleton />
  if (commit.isError) {
    return (
      <div className="p-6">
        <ErrorState title="commit을 불러오지 못했어요" description={errorMessage(commit.error)} />
      </div>
    )
  }

  const { data } = commit
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        title={data.message}
        meta={`#${data.seq} · ${formatDateTime(data.created_at)}`}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {data.changes.map((change) => (
          <CommitChange key={`${change.file_id}-${change.kind}`} change={change} />
        ))}
      </div>
    </div>
  )
}

function CommitChange({ change }: { change: CommitChangeResponse }) {
  const hunks = useMemo(() => parseUnifiedDiff(change.diff), [change.diff])
  const stats = useMemo(() => summarizeDiff(hunks.flatMap((hunk) => hunk.lines)), [hunks])
  const title = changeTitle(change.old_path, change.new_path)
  return (
    <FileSection
      kind={change.kind}
      title={title}
      openPath={change.new_path}
      added={stats.added}
      removed={stats.removed}
    >
      <DiffView hunks={hunks} label={`${title} 변경`} />
    </FileSection>
  )
}

/** 채팅의 도구 카드를 누르면 열리는 그 호출의 diff. 호출 전후 원문은 대화 기록에 있다. */
export function CallView({ sessionId, callId }: { sessionId: string; callId: string }) {
  const items = useListAgentItems<AgentItemResponse[]>(sessionId)
  const row = useMemo(() => {
    const rows = toAgentRows(items.data ?? [])
    return rows.find((candidate) => candidate.kind === 'tool' && candidate.callId === callId)
  }, [items.data, callId])

  if (items.isPending) return <CenterSkeleton />
  if (items.isError) {
    return (
      <div className="p-6">
        <ErrorState title="도구 호출을 불러오지 못했어요" description={errorMessage(items.error)} />
      </div>
    )
  }
  if (row === undefined || row.kind !== 'tool') {
    return (
      <div className="p-6">
        <ErrorState title="도구 호출을 찾지 못했어요" description="대화가 지워졌을 수 있어요." />
      </div>
    )
  }

  const changes = row.result?.changes ?? []
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader title={toolTitle(row.name, row.arguments)} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {row.result === null ? (
          <p className="text-body-sm text-text-muted">도구가 아직 실행 중이에요.</p>
        ) : changes.length === 0 ? (
          <p className="text-body-sm text-text-muted">이 호출은 파일을 바꾸지 않았어요.</p>
        ) : (
          changes.map((change, index) => <CallChange key={index} change={change} />)
        )}
      </div>
    </div>
  )
}

function CallChange({ change }: { change: FileChange }) {
  const lines = useMemo(
    () => diffLines(change.textBefore ?? '', change.textAfter ?? ''),
    [change.textBefore, change.textAfter],
  )
  const stats = summarizeDiff(lines)
  const kind: ChangeKind =
    change.pathBefore === null
      ? 'add'
      : change.pathAfter === null
        ? 'delete'
        : change.pathBefore !== change.pathAfter
          ? 'move'
          : 'modify'
  const title = changeTitle(change.pathBefore, change.pathAfter)
  return (
    <FileSection
      kind={kind}
      title={title}
      openPath={change.pathAfter}
      added={stats.added}
      removed={stats.removed}
    >
      <DiffView hunks={toHunks(lines, 3)} label={`${title} 변경`} />
    </FileSection>
  )
}

function CenterSkeleton() {
  return (
    <div className="space-y-3 p-6">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
