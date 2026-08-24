'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import {
  useListDocuments,
  type DocumentSummaryResponse,
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
import { useSidebarStore } from '@/shared/ui/sidebar-store'
import {
  FileIcon,
  PanelLeftIcon,
  PenIcon,
  ShieldIcon,
  XIcon,
} from '@/shared/ui/icons'
import { ProjectSwitcher } from './project-switcher'
import {
  PROJECT_VIEWS,
  activeRoute,
  documentHref,
  viewHref,
  type ProjectViewId,
} from './views'

/**
 * 왼쪽 내비게이션.
 *
 * 두 층으로 나뉜다. 위에서 **어느 프로젝트인지**를 고르고, 아래에서 **그 프로젝트를 어떻게
 * 볼지**를 고른다. 두 가지를 한 트리에 섞어 두면 뷰가 늘어날 때마다 프로젝트 목록과 뷰
 * 목록이 같은 자리를 다투고, 결국 둘 다 읽기 어려워진다.
 *
 * 도메인(프로젝트·뷰·문서)을 알기 때문에 `packages/ui` 가 아니라 여기 산다 (UI 패키지 스킬).
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
            href="/projects"
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

        {session.isSignedIn ? (
          <>
            {/*
              전환기는 스크롤 영역 **밖**에 둔다. 문서가 많아 아래가 길어져도 "지금 어느
              프로젝트인지" 는 늘 보여야 한다 — 그게 아래 모든 것의 전제이기 때문이다.
            */}
            <div
              className={cn(
                'shrink-0 border-b py-2',
                railed ? 'md:flex md:justify-center md:px-1.5' : 'px-2',
              )}
            >
              <ProjectSwitcher
                activeProjectId={active.projectId}
                activeView={active.view}
                railed={railed}
              />
            </div>

            <nav
              aria-label="프로젝트 메뉴"
              className={cn(
                'flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-3',
                railed ? 'md:items-center md:px-1.5' : 'px-2',
              )}
            >
              {active.projectId === null ? (
                <p
                  className={cn(
                    'px-2 py-1 text-xs leading-relaxed text-text-subtle',
                    railed && 'md:hidden',
                  )}
                >
                  프로젝트를 고르면 메뉴가 나옵니다.
                </p>
              ) : (
                <ProjectViewNav
                  projectId={active.projectId}
                  activeView={active.view}
                  activeDocumentId={active.documentId}
                  railed={railed}
                />
              )}
            </nav>
          </>
        ) : (
          <nav
            className={cn(
              'flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-3',
              railed ? 'md:items-center md:px-1.5' : 'px-2',
            )}
          >
            {session.isPending ? (
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
        )}

        <div
          className={cn(
            'flex shrink-0 flex-col gap-2 border-t py-3',
            railed ? 'md:items-center md:px-1.5' : 'px-3',
          )}
        >
          <AccountMenu compact={railed} />
        </div>
      </aside>
    </TooltipProvider>
  )
}

/** 뷰마다의 아이콘. 뜻은 옆 글자가 나르고, 기둥이 좁을 때만 혼자 선다. */
const VIEW_ICONS: Record<ProjectViewId, ReactNode> = {
  documents: <PenIcon className="size-4 shrink-0" />,
  policies: <ShieldIcon className="size-4 shrink-0" />,
}

function ProjectViewNav({
  projectId,
  activeView,
  activeDocumentId,
  railed,
}: {
  projectId: string
  activeView: ProjectViewId | null
  activeDocumentId: string | null
  railed: boolean
}) {
  return (
    <>
      {PROJECT_VIEWS.map((view) => (
        <div key={view.id}>
          <NavRow
            href={viewHref(projectId, view.id)}
            railed={railed}
            isActive={view.id === activeView}
            tooltip={view.label}
            icon={VIEW_ICONS[view.id]}
          >
            {view.label}
          </NavRow>

          {/*
            문서 목록은 문서 편집 뷰 **안의** 것이므로 그 메뉴 아래에 들여 쓴다. 다른 뷰를
            보는 동안에는 접는다 — 정책 표를 보는 사람에게 문서 목록은 지금 할 일이 아니다.
            기둥 모드에서는 자리가 없어 아예 접는다.
          */}
          {view.id === 'documents' && activeView === 'documents' && !railed ? (
            <DocumentNav
              projectId={projectId}
              activeDocumentId={activeDocumentId}
            />
          ) : null}
        </div>
      ))}
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
            href={documentHref(projectId, document.id)}
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
