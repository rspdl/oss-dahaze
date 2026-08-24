'use client'

import { useRouter } from 'next/navigation'
import {
  useListProjects,
  type ProjectResponse,
} from '@dahaze/api-client'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  cn,
} from '@dahaze/ui'

import { CreateProjectDialog } from '@/features/projects/create-project-dialog'
import {
  CheckIcon,
  ChevronsUpDownIcon,
  FolderIcon,
  PlusIcon,
} from '@/shared/ui/icons'
import { DEFAULT_PROJECT_VIEW, viewHref, type ProjectViewId } from './views'

/**
 * 내비게이션 맨 위의 프로젝트 전환기.
 *
 * 프로젝트를 목록의 **항목**이 아니라 지금 작업 중인 **범위**로 다룬다. 아래 메뉴들이 전부
 * 이 프로젝트 안의 것이므로, 무엇이 선택돼 있는지가 그 메뉴들보다 위에 있어야 읽는 순서가
 * 맞는다 — 먼저 어디에 있는지, 그다음 거기서 무엇을 하는지.
 *
 * 프로젝트 목록을 기둥에 펼쳐 두지 않는 이유: 뷰가 늘어날수록 기둥에서 두 종류의 목록이
 * 자리를 다투게 된다. 전환은 가끔이고 뷰 이동은 자주이므로, 가끔 쓰는 쪽을 접는다.
 */
export function ProjectSwitcher({
  activeProjectId,
  activeView,
  railed,
}: {
  activeProjectId: string | null
  /** 지금 보고 있는 뷰. 프로젝트를 바꿔도 이 뷰를 유지한다. */
  activeView: ProjectViewId | null
  railed: boolean
}) {
  const router = useRouter()
  const projects = useListProjects<ProjectResponse[]>(undefined, {
    query: { staleTime: 30_000 },
  })

  if (projects.isPending) {
    return <Skeleton className={cn('h-9', railed ? 'w-9' : 'w-full')} />
  }

  const list = projects.data ?? []
  const active = list.find((project) => project.id === activeProjectId) ?? null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="프로젝트 전환"
          className={cn(
            'flex items-center rounded-control border text-sm transition-colors duration-200 ease-out-expo hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-accent/50 focus-visible:outline-none',
            railed
              ? 'md:size-9 md:justify-center md:px-0'
              : 'w-full gap-2 px-2 py-1.5',
          )}
        >
          {active === null ? (
            <FolderIcon className="size-4 shrink-0 text-text-subtle" />
          ) : (
            /*
              기둥이 좁을 때는 폴더 아이콘 열 개가 서로 구분되지 않는다. 이름의 첫 글자가
              훨씬 빨리 읽힌다 — 넓을 때도 같은 표식을 써서 접었다 펴도 같은 것을 본다.
            */
            <span
              aria-hidden
              className="grid size-5 shrink-0 place-items-center rounded-indicator bg-accent-subtle text-[0.625rem] font-semibold text-text"
            >
              {[...active.name][0] ?? '·'}
            </span>
          )}

          <span
            className={cn(
              'min-w-0 flex-1 truncate text-left',
              railed && 'md:hidden',
              active === null && 'text-text-muted',
            )}
          >
            {active?.name ?? '프로젝트 선택'}
          </span>

          <ChevronsUpDownIcon
            className={cn(
              'size-3.5 shrink-0 text-text-subtle',
              railed && 'md:hidden',
            )}
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-text-subtle">프로젝트</DropdownMenuLabel>

        {list.length === 0 ? (
          <p className="px-2 py-1.5 text-xs leading-relaxed text-text-subtle">
            아직 프로젝트가 없습니다.
          </p>
        ) : (
          list.map((project) => (
            <DropdownMenuItem
              key={project.id}
              /*
                전환하면 **지금 보던 뷰를 유지한다.** 정책 검토를 보다가 프로젝트를 바꿨는데
                문서 목록으로 떨어지면, 두 프로젝트의 정책을 번갈아 보려는 사람이 매번 같은
                두 번의 클릭을 더 해야 한다.
              */
              onSelect={() =>
                router.push(
                  viewHref(project.id, activeView ?? DEFAULT_PROJECT_VIEW),
                )
              }
              className="gap-2"
            >
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {project.id === activeProjectId ? (
                <CheckIcon className="size-4 shrink-0 text-accent" />
              ) : null}
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />

        {/*
          다이얼로그를 여는 항목은 `DropdownMenuItem` 으로 감쌀 수 없다. 메뉴가 닫히면서
          트리거가 사라져 다이얼로그도 함께 죽는다. 메뉴 안의 평범한 버튼으로 둔다.
        */}
        <CreateProjectDialog
          trigger={
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 font-normal"
            >
              <PlusIcon className="size-4 shrink-0" />
              새 프로젝트
            </Button>
          }
        />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 font-normal"
          onClick={() => router.push('/projects')}
        >
          <FolderIcon className="size-4 shrink-0" />
          모든 프로젝트
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
