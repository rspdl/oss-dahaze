'use client'

import { useRouter } from 'next/navigation'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  toast,
} from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { useSession, useSignOut } from './use-session'

/**
 * 헤더 오른쪽의 계정 영역.
 *
 * 로그아웃 상태에서는 아무 것도 그리지 않는다. 로그인 버튼은 첫 화면이 맥락과 함께 보여주는
 * 편이 낫고, 헤더에까지 두면 "지금 로그아웃 상태" 라는 사실이 두 곳에서 말해진다.
 */
export function AccountMenu() {
  const session = useSession()
  const signOut = useSignOut()
  const router = useRouter()

  if (session.isPending) return <Skeleton className="h-8 w-24" />
  if (session.user === undefined) return null

  const { display_name: displayName, email } = session.user

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          {displayName}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
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
