'use client'

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useListTree, type TreeEntryResponse } from '@dahaze/api-client'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import {
  ChevronRightIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  LockIcon,
  MoreIcon,
} from '@/shared/ui/icons'
import { DeleteDialog, NameDialog } from './entry-dialogs'
import {
  CHANGE_LABEL,
  buildTree,
  describeHolder,
  flattenVisible,
  parentPath,
  type ChangeKind,
  type TreeNode,
} from './tree-model'
import { useTreeActions } from './use-tree-actions'
import { useWorkspaceStore } from './workspace-store'

type Dialog =
  | { kind: 'new-file'; parent: string }
  | { kind: 'new-folder'; parent: string }
  | { kind: 'rename'; node: TreeNode }
  | null

/**
 * 작업 트리. 폴더를 펼치고 파일을 골라 가운데 에디터에 연다.
 *
 * 파일마다 commit 안 된 변경(글자 A·M·R·D)과 AI 잠금(자물쇠)을 표시한다. 둘 다 색만으로
 * 구분하지 않는다 — 글자와 아이콘, 스크린 리더용 이름이 함께 있다.
 *
 * 키보드: 위·아래로 이동, 오른쪽·왼쪽으로 폴더를 펼치고 접는다, Enter 로 연다
 * (WAI-ARIA tree 패턴).
 */
export function FileTree({ projectId }: { projectId: string }) {
  const tree = useListTree<TreeEntryResponse[]>(projectId)
  const center = useWorkspaceStore((state) => state.center)
  const expandedMap = useWorkspaceStore((state) => state.expanded)
  const drafts = useWorkspaceStore((state) => state.drafts)
  const openFile = useWorkspaceStore((state) => state.openFile)
  const toggleFolder = useWorkspaceStore((state) => state.toggleFolder)
  const actions = useTreeActions(projectId)

  const [dialog, setDialog] = useState<Dialog>(null)
  const [deleting, setDeleting] = useState<{ path: string; kind: 'file' | 'folder' } | null>(null)
  const [focused, setFocused] = useState<string | null>(null)

  const nodes = useMemo(() => buildTree(tree.data ?? []), [tree.data])
  const expanded = useMemo(() => new Set(Object.keys(expandedMap)), [expandedMap])
  const rows = useMemo(() => flattenVisible(nodes, expanded), [nodes, expanded])
  const activePath = center.kind === 'file' ? center.path : null
  const focusPath = focused ?? activePath ?? rows[0]?.node.path ?? null

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = rows.findIndex((row) => row.node.path === focusPath)
    if (index === -1) return
    const row = rows[index]!
    const move = (next: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, next))]
      if (target === undefined) return
      setFocused(target.node.path)
      document.getElementById(treeItemId(target.node.path))?.focus()
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(index + 1)
        return
      case 'ArrowUp':
        event.preventDefault()
        move(index - 1)
        return
      case 'ArrowRight':
        if (row.node.kind === 'folder' && !expanded.has(row.node.path)) {
          event.preventDefault()
          toggleFolder(row.node.path)
        }
        return
      case 'ArrowLeft':
        event.preventDefault()
        if (row.node.kind === 'folder' && expanded.has(row.node.path)) toggleFolder(row.node.path)
        else {
          const parent = rows.findIndex((candidate) => candidate.node.path === parentPath(row.node.path))
          if (parent !== -1) move(parent)
        }
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (row.node.kind === 'folder') toggleFolder(row.node.path)
        else openFile(row.node.path)
        return
    }
  }

  /** 새 항목을 만들 폴더. 폴더에 초점이 있으면 그 안, 파일이면 그 파일의 폴더. */
  const targetFolder = () => {
    const row = rows.find((candidate) => candidate.node.path === focusPath)
    if (row === undefined) return '/'
    return row.node.kind === 'folder' ? row.node.path : parentPath(row.node.path)
  }

  return (
    <section aria-labelledby="workspace-files-heading" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-4">
        <h2 id="workspace-files-heading" className="text-label-sm text-text-muted">
          파일
        </h2>
        <div className="ml-auto flex items-center">
          <IconAction label="새 파일" onClick={() => setDialog({ kind: 'new-file', parent: targetFolder() })}>
            <FilePlusIcon />
          </IconAction>
          <IconAction label="새 폴더" onClick={() => setDialog({ kind: 'new-folder', parent: targetFolder() })}>
            <FolderPlusIcon />
          </IconAction>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {tree.isPending ? (
          <div className="space-y-2 px-2 pt-1">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : tree.isError ? (
          <ErrorState
            title="파일 목록을 불러오지 못했어요"
            description={errorMessage(tree.error)}
            action={
              <Button variant="secondary" size="sm" onClick={() => void tree.refetch()}>
                다시 불러오기
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <div className="px-2 pt-2 text-body-sm text-text-muted">
            <p>아직 파일이 없어요.</p>
            <p className="mt-1">새 파일을 만들거나 오른쪽 AI 대화로 시작해 보세요.</p>
            <Button
              variant="weak"
              size="sm"
              className="mt-3"
              onClick={() => setDialog({ kind: 'new-file', parent: '/' })}
            >
              <FilePlusIcon />
              새 파일 만들기
            </Button>
          </div>
        ) : (
          <div role="tree" aria-labelledby="workspace-files-heading" onKeyDown={onKeyDown}>
            {rows.map(({ node, depth }) => (
              <TreeRow
                key={node.path}
                node={node}
                depth={depth}
                expanded={expanded.has(node.path)}
                active={node.path === activePath}
                focusable={node.path === focusPath}
                dirty={node.path in drafts}
                onFocus={() => setFocused(node.path)}
                onActivate={() => (node.kind === 'folder' ? toggleFolder(node.path) : openFile(node.path))}
                onNewFile={() => setDialog({ kind: 'new-file', parent: node.path })}
                onNewFolder={() => setDialog({ kind: 'new-folder', parent: node.path })}
                onRename={() => setDialog({ kind: 'rename', node })}
                onDelete={() => setDeleting({ path: node.path, kind: node.kind })}
              />
            ))}
          </div>
        )}
      </div>

      <NameDialog
        open={dialog?.kind === 'new-file'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="새 파일 이름을 무엇으로 할까요?"
        description={dialog?.kind === 'new-file' ? `${dialog.parent} 안에 만들어요.` : undefined}
        label="파일 이름"
        placeholder="주문"
        suffix=".rspdl"
        submitLabel="만들기"
        onSubmit={(name) =>
          dialog?.kind === 'new-file' ? actions.createFile(dialog.parent, name) : Promise.resolve(false)
        }
      />
      <NameDialog
        open={dialog?.kind === 'new-folder'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="새 폴더 이름을 무엇으로 할까요?"
        description={dialog?.kind === 'new-folder' ? `${dialog.parent} 안에 만들어요.` : undefined}
        label="폴더 이름"
        submitLabel="만들기"
        onSubmit={(name) =>
          dialog?.kind === 'new-folder' ? actions.createFolder(dialog.parent, name) : Promise.resolve(false)
        }
      />
      <NameDialog
        open={dialog?.kind === 'rename'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="이름을 무엇으로 바꿀까요?"
        label="새 이름"
        initialValue={dialog?.kind === 'rename' ? dialog.node.name : ''}
        submitLabel="바꾸기"
        onSubmit={(name) =>
          dialog?.kind === 'rename'
            ? actions.rename(dialog.node.path, parentPath(dialog.node.path), name)
            : Promise.resolve(false)
        }
      />
      <DeleteDialog
        target={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        onDelete={actions.remove}
      />
    </section>
  )
}

function treeItemId(path: string): string {
  return `workspace-tree-${encodeURIComponent(path)}`
}

function TreeRow({
  node,
  depth,
  expanded,
  active,
  focusable,
  dirty,
  onFocus,
  onActivate,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: {
  node: TreeNode
  depth: number
  expanded: boolean
  active: boolean
  focusable: boolean
  dirty: boolean
  onFocus: () => void
  onActivate: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const isFolder = node.kind === 'folder'
  const locked = node.lockedBy !== null
  const deleted = node.change === 'delete'

  return (
    <div
      id={treeItemId(node.path)}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isFolder ? expanded : undefined}
      aria-selected={active}
      tabIndex={focusable ? 0 : -1}
      onFocus={onFocus}
      onClick={onActivate}
      className={cn(
        'group flex h-8 cursor-pointer items-center gap-1.5 rounded-sm pr-1 text-body-sm outline-none select-none',
        'hover:bg-state-hover focus-visible:focus-ring',
        active ? 'bg-selected font-semibold text-text' : 'text-text',
      )}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      {isFolder ? (
        <ChevronRightIcon
          className={cn(
            'size-3.5 text-text-subtle transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
      )}
      {isFolder ? (
        expanded ? (
          <FolderOpenIcon className="text-text-subtle" />
        ) : (
          <FolderIcon className="text-text-subtle" />
        )
      ) : (
        <FileIcon className="text-text-subtle" />
      )}
      <span className={cn('min-w-0 flex-1 truncate', deleted && 'text-text-subtle line-through')}>
        {node.name}
      </span>

      {dirty ? (
        <span className="relative size-1.5 shrink-0 rounded-full bg-text-muted" title="저장하지 않은 입력">
          <span className="sr-only">저장하지 않은 입력 있음</span>
        </span>
      ) : null}
      {locked ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="relative inline-flex text-diagnostic-warning">
              <LockIcon className="size-3.5" />
              <span className="sr-only">{describeHolder(node.lockedBy!)}이(가) 쓰는 중</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{describeHolder(node.lockedBy!)}이(가) 쓰는 중이에요</TooltipContent>
        </Tooltip>
      ) : null}
      {node.change === null ? null : <ChangeMark change={node.change} />}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            aria-label={`${node.name} 메뉴`}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
          {isFolder ? (
            <>
              <DropdownMenuItem onSelect={onNewFile}>새 파일</DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewFolder}>새 폴더</DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onSelect={onRename} disabled={deleted}>
            이름 바꾸기
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete} disabled={deleted}>
            지우기
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

const CHANGE_TONE: Record<ChangeKind, string> = {
  add: 'text-success',
  modify: 'text-diagnostic-info',
  move: 'text-diagnostic-info',
  delete: 'text-diagnostic-error',
}

export function ChangeMark({ change }: { change: ChangeKind }) {
  const { letter, label } = CHANGE_LABEL[change]
  return (
    <span className={cn('relative w-4 shrink-0 text-center font-mono text-caption font-semibold', CHANGE_TONE[change])}>
      <span aria-hidden>{letter}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

