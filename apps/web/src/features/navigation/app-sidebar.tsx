'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
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
import { FolderIcon, PanelLeftIcon, XIcon } from '@/shared/ui/icons'
import { ProjectSwitcher } from './project-switcher'
import { activeRoute } from './views'

/**
 * 왼쪽 내비게이션.
 *
 * 두 층으로 나뉜다. 위에서 **어느 프로젝트인지**를 고르고, 아래에는 화면이 넘긴 `content` 를
 * 둔다. 프로젝트 안에서는 작업공간이 문서 파일 트리를 넘긴다. 뷰 선택은 메인 영역 위쪽에 있다
 * (`features/navigation/views.ts`).
 *
 * 트리를 여기서 import 하지 않고 슬롯으로 받는다. 내비게이션이 workspace feature 를 알면
 * workspace → shared/ui/app-shell → navigation → workspace 로 import 가 한 바퀴 돈다.
 *
 * 도메인(프로젝트)을 알기 때문에 `packages/ui` 가 아니라 여기 산다 (UI 패키지 스킬).
 */
export function AppSidebar({ content }: { content?: ReactNode }) {
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
              전환기는 스크롤 영역 **밖**에 둔다. 메뉴가 길어져도 "지금 어느
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

            {active.projectId !== null && content !== undefined ? (
              <>
                {/*
                  접힌 기둥(3.5rem)에는 파일 이름이 들어가지 않는다. 트리를 숨기고 펼치는 버튼만
                  둔다. 좁은 화면의 서랍은 늘 펼친 폭이라 `md:` 에서만 숨긴다.
                */}
                <div className={cn('flex min-h-0 flex-1 flex-col', railed && 'md:hidden')}>
                  {content}
                </div>
                {railed ? (
                  <div className="hidden flex-1 justify-center py-3 md:flex">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="파일 트리 펼치기"
                          onClick={toggleCollapsed}
                        >
                          <FolderIcon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">파일 트리 펼치기</TooltipContent>
                    </Tooltip>
                  </div>
                ) : null}
              </>
            ) : (
              <p
                className={cn(
                  'flex-1 px-4 py-4 text-xs leading-relaxed text-text-subtle',
                  railed && 'md:hidden',
                )}
              >
                프로젝트를 고르면 문서 트리가 나옵니다.
              </p>
            )}
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
