'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import {
  useListDocuments,
  useListProjects,
  type DocumentSummaryResponse,
  type ProjectResponse,
} from '@dahaze/api-client'
import {
  Button,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@dahaze/ui'

import { AccountMenu } from '@/features/auth/account-menu'
import { useSession } from '@/features/auth/use-session'
import { RuntimeVersionBadge } from '@/features/analysis/runtime-version-badge'
import { CreateProjectDialog } from '@/features/projects/create-project-dialog'
import { useSidebarStore } from '@/shared/ui/sidebar-store'
import {
  FileIcon,
  FolderIcon,
  PanelLeftIcon,
  PlusIcon,
  XIcon,
} from '@/shared/ui/icons'

/**
 * 왼쪽 내비게이션.
 *
 * 이 제품에서 사람이 오가는 축은 프로젝트 → 문서 하나뿐이다. 그 축을 헤더의 breadcrumb 로만
 * 표현하면 옆 문서로 건너가려 할 때마다 목록 화면을 거쳐야 한다. 그래서 축 자체를 화면
 * 왼쪽에 늘 펴 둔다 — **지금 있는 곳** 과 **갈 수 있는 곳** 이 한눈에 같이 보인다.
 *
 * 도메인(프로젝트·문서)을 알기 때문에 `packages/ui` 가 아니라 여기 산다 (UI 패키지 스킬).
 */
export function AppSidebar() {
  const pathname = usePathname()
  const session = useSession()
  const collapsed = useSidebarStore((state) => state.collapsed)
  const mobileOpen = useSidebarStore((state) => state.mobileOpen)
  const setMobileOpen = useSidebarStore((state) => state.setMobileOpen)
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed)

  const active = activeRoute(pathname)

  /* 어디론가 이동했다면 서랍은 할 일을 마쳤다. 열린 채로 두면 도착한 화면을 가린다. */
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname, setMobileOpen])

  /* 서랍은 화면을 덮으므로 Esc 로 나갈 길이 있어야 한다. */
  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen, setMobileOpen])

  const railed = collapsed

  return (
    <TooltipProvider delayDuration={150}>
      {/*
        서랍 뒤에 까는 막. `hidden` 으로 껐다 켜지 않고 투명도만 바꾸는 이유는, 사라지는
        동안에도 막이 있어야 손가락이 뒤 내용을 건드리지 않기 때문이다.
      */}
      <div
        aria-hidden
        onClick={() => setMobileOpen(false)}
        className={cn(
          'fixed inset-0 z-30 bg-overlay transition-opacity duration-300 ease-out-expo md:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        aria-label="주요 이동"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-sidebar flex-col border-r bg-surface',
          /*
            닫힌 서랍은 화면 밖으로 밀어내는 것만으로는 부족하다. 안 보일 뿐 여전히 탭
            키로 닿기 때문에, 키보드 사용자는 보이지 않는 링크 열 개를 지나야 본문에
            도착한다. `invisible` 이 그 링크들을 순서에서 뺀다 — 전환 속성에 함께 넣었으므로
            열 때는 즉시 보이고, 닫을 때는 다 밀려난 뒤에 사라진다.
          */
          'transition-[transform,visibility] duration-300 ease-out-expo',
          mobileOpen
            ? 'visible translate-x-0'
            : 'invisible -translate-x-full md:visible',
          /*
            넓은 화면에서는 서랍이 아니라 기둥이다. `sticky` 라서 본문이 아무리 길어도
            내비게이션은 제자리에 남는다.

            접고 펼 때 폭을 애니메이션하지 않는다. 폭은 레이아웃 값이라 매 프레임 오른쪽
            본문 전체가 다시 계산된다 — 편집기가 열려 있으면 그 대가가 눈에 보인다.
            서랍이 밀려 들어오는 좁은 화면에서만 움직이고, 여기서는 즉시 바뀐다.
          */
          'md:sticky md:top-0 md:h-dvh md:translate-x-0',
          railed ? 'md:w-sidebar-rail' : 'md:w-sidebar',
        )}
      >
        <div
          className={cn(
            'flex h-14 shrink-0 items-center gap-1 border-b',
            railed ? 'md:justify-center md:px-0' : 'px-3',
          )}
        >
          <Link
            href="/"
            className={cn(
              'rounded-control px-1 text-sm font-semibold tracking-tight',
              railed && 'md:hidden',
            )}
          >
            dahaze
          </Link>

          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto hidden md:inline-flex"
            aria-label={railed ? '내비게이션 펼치기' : '내비게이션 접기'}
            aria-expanded={!railed}
            onClick={toggleCollapsed}
          >
            <PanelLeftIcon />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto md:hidden"
            aria-label="내비게이션 닫기"
            onClick={() => setMobileOpen(false)}
          >
            <XIcon />
          </Button>
        </div>

        <nav
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-3',
            railed ? 'md:items-center md:px-1.5' : 'px-2',
          )}
        >
          {session.isSignedIn ? (
            <SignedInNav
              railed={railed}
              activeProjectId={active.projectId}
              activeDocumentId={active.documentId}
            />
          ) : session.isPending ? (
            <NavSkeleton railed={railed} />
          ) : (
            <p
              className={cn(
                'px-2 py-1 text-xs leading-relaxed text-text-subtle',
                railed && 'md:hidden',
              )}
            >
              로그인하면 프로젝트가 여기 나옵니다.
            </p>
          )}
        </nav>

        <div
          className={cn(
            'flex shrink-0 flex-col gap-2 border-t py-3',
            railed ? 'md:items-center md:px-1.5' : 'px-3',
          )}
        >
          <div className={cn(railed && 'md:hidden')}>
            <RuntimeVersionBadge />
          </div>
          <AccountMenu compact={railed} />
        </div>
      </aside>
    </TooltipProvider>
  )
}

/** 경로에서 지금 열려 있는 프로젝트·문서를 읽는다. 라우터가 이미 아는 사실이다. */
function activeRoute(pathname: string): {
  projectId: string | null
  documentId: string | null
} {
  const match = /^\/projects\/([^/]+)(?:\/documents\/([^/]+))?/.exec(pathname)
  if (match === null) return { projectId: null, documentId: null }
  return { projectId: match[1] ?? null, documentId: match[2] ?? null }
}

function SignedInNav({
  railed,
  activeProjectId,
  activeDocumentId,
}: {
  railed: boolean
  activeProjectId: string | null
  activeDocumentId: string | null
}) {
  const projects = useListProjects<ProjectResponse[]>(undefined, {
    query: { staleTime: 30_000 },
  })

  return (
    <>
      <CreateProjectDialog
        trigger={
          <button
            type="button"
            className={cn(
              'flex items-center rounded-control text-sm text-text-muted transition-colors duration-200 ease-out-expo hover:bg-surface-raised hover:text-text active:translate-y-px',
              railed ? 'md:size-9 md:justify-center md:px-0' : 'gap-2 px-2 py-1.5',
            )}
          >
            <PlusIcon className="size-4 shrink-0" />
            <span className={cn(railed && 'md:hidden')}>새 프로젝트</span>
          </button>
        }
      />

      <SectionLabel railed={railed}>프로젝트</SectionLabel>

      {projects.isPending ? (
        <NavSkeleton railed={railed} />
      ) : projects.error !== null ? (
        <p
          className={cn(
            'px-2 py-1 text-xs leading-relaxed text-diagnostic-error',
            railed && 'md:hidden',
          )}
        >
          목록을 불러오지 못했습니다.
        </p>
      ) : (projects.data?.length ?? 0) === 0 ? (
        <p
          className={cn(
            'px-2 py-1 text-xs leading-relaxed text-text-subtle',
            railed && 'md:hidden',
          )}
        >
          아직 프로젝트가 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {projects.data?.map((project) => (
            <li key={project.id}>
              <ProjectNavItem
                project={project}
                railed={railed}
                isActive={project.id === activeProjectId}
                activeDocumentId={activeDocumentId}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ProjectNavItem({
  project,
  railed,
  isActive,
  activeDocumentId,
}: {
  project: ProjectResponse
  railed: boolean
  isActive: boolean
  activeDocumentId: string | null
}) {
  return (
    <>
      <NavRow
        href={`/projects/${project.id}`}
        railed={railed}
        isActive={isActive}
        tooltip={project.name}
        icon={
          railed ? (
            /*
              좁은 기둥에서는 프로젝트마다 아이콘이 같아 구분이 되지 않는다. 이름의 첫 글자를
              쓰면 폴더 아이콘 열 개보다 훨씬 빨리 찾는다.
            */
            <span
              aria-hidden
              className="grid size-5 place-items-center rounded-indicator bg-surface-raised text-[0.625rem] font-semibold text-text-muted"
            >
              {[...project.name][0] ?? '·'}
            </span>
          ) : (
            <FolderIcon className="size-4 shrink-0" />
          )
        }
      >
        {project.name}
      </NavRow>

      {/*
        열려 있는 프로젝트의 문서만 펼친다. 전부 펼치면 목록이 길어져서 내비게이션이
        아니라 또 하나의 목록 화면이 된다. 기둥 모드에서는 자리가 없어 아예 접는다.
      */}
      {isActive && !railed ? (
        <DocumentNav projectId={project.id} activeDocumentId={activeDocumentId} />
      ) : null}
    </>
  )
}

function DocumentNav({
  projectId,
  activeDocumentId,
}: {
  projectId: string
  activeDocumentId: string | null
}) {
  const documents = useListDocuments<DocumentSummaryResponse[]>(projectId, {
    query: { staleTime: 30_000 },
  })

  if (documents.isPending) {
    return (
      <div className="ml-4 flex flex-col gap-1 border-l py-1 pl-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-20" />
      </div>
    )
  }

  if (documents.error !== null || (documents.data?.length ?? 0) === 0) return null

  return (
    <ul className="ml-4 flex flex-col gap-0.5 border-l py-0.5 pl-1.5">
      {documents.data?.map((document, index) => (
        <li
          key={document.id}
          className="animate-rise"
          /* 한꺼번에 나타나면 목록이 몇 개인지 눈에 들어오지 않는다. 순서대로 흘려보낸다. */
          style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
        >
          <NavRow
            href={`/projects/${projectId}/documents/${document.id}`}
            railed={false}
            isActive={document.id === activeDocumentId}
            icon={<FileIcon className="size-3.5 shrink-0" />}
          >
            {document.title}
          </NavRow>
        </li>
      ))}
    </ul>
  )
}

/**
 * 내비게이션 한 줄.
 *
 * 지금 위치를 색으로만 말하지 않는다. `aria-current` 로도 말해야 스크린 리더 사용자가 어디에
 * 있는지 알고, 왼쪽 세로 막대가 색각 이상 사용자에게 같은 사실을 전한다.
 */
function NavRow({
  href,
  icon,
  children,
  isActive,
  railed,
  tooltip,
}: {
  href: string
  icon: ReactNode
  children: ReactNode
  isActive: boolean
  railed: boolean
  tooltip?: string
}) {
  const row = (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group relative flex items-center rounded-control text-sm transition-colors duration-200 ease-out-expo',
        railed ? 'md:size-9 md:justify-center md:px-0' : 'gap-2 px-2 py-1.5',
        isActive
          ? 'bg-accent-subtle font-medium text-text'
          : 'text-text-muted hover:bg-surface-raised hover:text-text',
      )}
    >
      {isActive ? (
        <span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 -left-0.5 w-0.5 rounded-full bg-accent"
        />
      ) : null}
      {icon}
      <span className={cn('truncate', railed && 'md:hidden')}>{children}</span>
    </Link>
  )

  if (tooltip === undefined || !railed) return row

  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function SectionLabel({
  children,
  railed,
}: {
  children: ReactNode
  railed: boolean
}) {
  return (
    <p
      className={cn(
        'mt-3 mb-1 px-2 text-[0.6875rem] font-medium tracking-wide text-text-subtle uppercase',
        railed && 'md:hidden',
      )}
    >
      {children}
    </p>
  )
}

/** 목록이 오기 전의 자리. 실제 줄과 같은 높이라 도착할 때 화면이 튀지 않는다. */
function NavSkeleton({ railed }: { railed: boolean }) {
  return (
    <div
      className={cn('flex flex-col gap-1', railed ? 'md:items-center' : 'px-2')}
      aria-hidden
    >
      {[0, 1, 2].map((index) => (
        <Skeleton
          key={index}
          className={cn('h-7', railed ? 'w-7 md:w-7' : 'w-full')}
        />
      ))}
    </div>
  )
}
