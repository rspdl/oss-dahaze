'use client'

import { useState, type FormEvent } from 'react'
import {
  useListCommits,
  useListTreeChanges,
  type CommitResponse,
  type TreeFileResponse,
} from '@dahaze/api-client'
import { Button, Checkbox, Skeleton, Textarea, cn } from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/format'
import { ChevronRightIcon, CommitIcon, SpinnerIcon } from '@/shared/ui/icons'
import { ChangeMark } from './file-tree'
import { basename, changeDisplayPath, type ChangeKind } from './tree-model'
import { useTreeActions } from './use-tree-actions'
import { useWorkspaceStore } from './workspace-store'

/**
 * commit 안 된 변경 목록과 commit 입력. 파일을 골라 메시지와 함께 commit 한다.
 *
 * 기본은 전부 포함이다. 대부분의 commit 은 "지금까지 바꾼 것 전부" 이고, 뺄 것만 고르는 편이
 * 넣을 것을 하나씩 고르는 것보다 누르는 횟수가 적다.
 *
 * 잠긴 파일은 고를 수 없다. 서버가 다른 세션이 잠근 파일이 든 commit 을 거부한다.
 */
export function ChangesPanel({
  projectId,
  lockedPaths,
}: {
  projectId: string
  lockedPaths: ReadonlySet<string>
}) {
  const changes = useListTreeChanges<TreeFileResponse[]>(projectId)
  const excluded = useWorkspaceStore((state) => state.excluded)
  const toggleExcluded = useWorkspaceStore((state) => state.toggleExcluded)
  const openFile = useWorkspaceStore((state) => state.openFile)
  const actions = useTreeActions(projectId)
  const [message, setMessage] = useState('')

  const files = changes.data ?? []
  const selectable = files.filter((file) => !lockedPaths.has(file.path))
  const selected = selectable.filter((file) => !excluded[changeDisplayPath(file)])
  const trimmed = message.trim()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (selected.length === 0 || trimmed === '') return
    const ok = await actions.commit(selected.map(changeDisplayPath), trimmed)
    if (ok) setMessage('')
  }

  if (changes.isPending) {
    return (
      <div className="border-t px-4 py-3">
        <Skeleton className="h-5 w-24" />
      </div>
    )
  }
  if (changes.isError) {
    return (
      <p className="border-t px-4 py-3 text-caption text-diagnostic-error">
        변경 목록을 불러오지 못했어요. {errorMessage(changes.error)}
      </p>
    )
  }
  if (files.length === 0) return null

  return (
    <section aria-labelledby="workspace-changes-heading" className="flex max-h-[45%] shrink-0 flex-col border-t">
      <header className="flex h-11 shrink-0 items-center gap-2 px-4">
        <h2 id="workspace-changes-heading" className="text-label-sm text-text-muted">
          변경
        </h2>
        <span className="rounded-full bg-surface-raised px-2 text-caption font-semibold text-text-muted tabular-nums">
          {files.length.toLocaleString('ko-KR')}
        </span>
      </header>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2">
        {files.map((file) => {
          const path = changeDisplayPath(file)
          const locked = lockedPaths.has(file.path)
          const checked = !locked && !excluded[path]
          const inputId = `workspace-change-${encodeURIComponent(path)}`
          return (
            <li key={file.id} className="group flex h-8 items-center gap-2 rounded-sm pr-1 pl-2 hover:bg-state-hover">
              <Checkbox
                id={inputId}
                checked={checked}
                disabled={locked}
                aria-label={`${path} commit에 넣기`}
                onCheckedChange={() => toggleExcluded(path)}
              />
              <button
                type="button"
                className={cn(
                  'min-w-0 flex-1 truncate rounded-xs text-left text-body-sm outline-none focus-visible:focus-ring',
                  file.change === 'delete' && 'text-text-subtle line-through',
                )}
                title={path}
                disabled={file.change === 'delete'}
                onClick={() => openFile(file.path)}
              >
                {basename(path)}
              </button>
              {locked ? <span className="text-caption text-diagnostic-warning">잠김</span> : null}
              {file.change === null ? null : <ChangeMark change={file.change as ChangeKind} />}
            </li>
          )
        })}
      </ul>

      <form onSubmit={submit} className="grid shrink-0 gap-2 px-4 pt-2 pb-4">
        <label htmlFor="workspace-commit-message" className="sr-only">
          commit 메시지
        </label>
        <Textarea
          id="workspace-commit-message"
          rows={2}
          value={message}
          placeholder="무엇을 왜 바꿨는지 적어 주세요"
          className="min-h-0 resize-none text-body-sm"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit(event)
          }}
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={selected.length === 0 || trimmed === '' || actions.committing}
        >
          {actions.committing ? <SpinnerIcon /> : <CommitIcon />}
          {selected.length.toLocaleString('ko-KR')}개 파일 commit하기
        </Button>
      </form>
    </section>
  )
}

/**
 * commit 이력. 누르면 가운데에 그 commit 의 diff 가 열린다. 기본은 접혀 있다 — 파일 트리가
 * 좁은 열을 먼저 써야 한다.
 */
export function HistoryPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const commits = useListCommits<CommitResponse[]>(projectId, { query: { enabled: open } })
  const center = useWorkspaceStore((state) => state.center)
  const openCommit = useWorkspaceStore((state) => state.openCommit)

  return (
    <section aria-labelledby="workspace-history-heading" className="flex max-h-[35%] shrink-0 flex-col border-t">
      <h2 id="workspace-history-heading">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex h-11 w-full items-center gap-1.5 px-4 text-label-sm text-text-muted outline-none hover:text-text focus-visible:focus-ring"
        >
          <ChevronRightIcon className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')} />
          이력
        </button>
      </h2>

      {open ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {commits.isPending ? (
            <Skeleton className="mx-2 h-10" />
          ) : commits.isError ? (
            <p className="px-2 text-caption text-diagnostic-error">
              이력을 불러오지 못했어요. {errorMessage(commits.error)}
            </p>
          ) : commits.data.length === 0 ? (
            <p className="px-2 text-caption text-text-muted">아직 commit이 없어요.</p>
          ) : (
            <ul>
              {[...commits.data]
                .sort((a, b) => b.seq - a.seq)
                .map((commit) => {
                  const active = center.kind === 'commit' && center.commitId === commit.id
                  return (
                    <li key={commit.id}>
                      <button
                        type="button"
                        aria-current={active || undefined}
                        onClick={() => openCommit(commit.id)}
                        className={cn(
                          'grid w-full gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-state-hover focus-visible:focus-ring',
                          active && 'bg-selected',
                        )}
                      >
                        <span className="truncate text-body-sm text-text">{commit.message}</span>
                        <span className="text-caption text-text-subtle tabular-nums">
                          #{commit.seq} · {formatDateTime(commit.created_at)} · 파일{' '}
                          {commit.changes.length.toLocaleString('ko-KR')}개
                        </span>
                      </button>
                    </li>
                  )
                })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}
