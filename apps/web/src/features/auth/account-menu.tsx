'use client'

import { useRouter } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  cn,
  toast,
} from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { useSession, useSignOut } from './use-session'

/**
 * 계정 영역. 내비게이션 맨 아래에 산다.
 *
 * 로그아웃 상태에서는 아무 것도 그리지 않는다. 로그인 버튼은 첫 화면이 맥락과 함께 보여주는
 * 편이 낫고, 여기에도 두면 "지금 로그아웃 상태" 라는 사실이 두 곳에서 말해진다.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const session = useSession()
  const signOut = useSignOut()
  const router = useRouter()

  if (session.isPending) {
    return <Skeleton className={cn('h-9', compact ? 'w-9' : 'w-full')} />
  }
  if (session.user === undefined) return null

  const { display_name: displayName, email } = session.user
  const initial = [...displayName][0] ?? '·'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex items-center rounded-control text-sm transition-colors duration-200 ease-out-expo hover:bg-surface-raised active:translate-y-px',
          compact ? 'size-9 justify-center' : 'w-full gap-2 px-2 py-1.5 text-left',
        )}
      >
        {/*
          아바타 자리에 사람 모양 아이콘을 쓰지 않는다. 계정이 여럿일 때 전부 같은 실루엣이라
          누가 누구인지 구분되지 않는다. 이름의 첫 글자는 언제나 그 사람의 것이다.
        */}
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-subtle text-xs font-semibold text-text"
        >
          {initial}
        </span>
        <span className={cn('truncate', compact && 'sr-only')}>{displayName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium text-text">{displayName}</span>
          {email === null ? null : (
            <span className="block truncate text-xs text-text-muted">{email}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signOut.isPending}
          onSelect={() => {
            signOut.mutate(undefined, {
              onSuccess: () => {
                router.push('/')
              },
              onError: (error) => {
                toast.error('로그아웃하지 못했습니다', {
                  description: errorMessage(error),
                })
              },
            })
          }}
        >
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
