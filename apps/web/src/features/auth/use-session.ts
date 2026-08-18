'use client'

import {
  getGetCurrentUserQueryKey,
  useGetCurrentUser,
  useLogout,
  type CurrentUserResponse,
} from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'

import { isUnauthorized } from '@/shared/api/errors'

/**
 * 지금 누가 로그인해 있는지.
 *
 * **401 은 오류가 아니라 답이다.** 로그아웃 상태에서 `/api/auth/me` 는 401 을 돌려주는데,
 * 이것을 실패로 다루면 첫 방문자에게 빨간 오류 화면이 뜬다. 그래서 401 만 따로 떼어
 * `isSignedOut` 으로 바꾸고, 나머지 실패만 오류로 남긴다.
 *
 * 세션은 서버 상태다. zustand 로 복사하지 않는다 (ADR-0006) — 로그아웃 뒤에도 스토어에 남은
 * 사용자 정보가 화면에 보이는 종류의 버그가 정확히 그렇게 생긴다.
 */
export interface Session {
  user: CurrentUserResponse | undefined
  isPending: boolean
  isSignedIn: boolean
  isSignedOut: boolean
  /** 401 이 아닌 진짜 실패. 서버가 죽었거나 네트워크가 끊긴 경우. */
  error: unknown
}

export function useSession(): Session {
  const query = useGetCurrentUser<CurrentUserResponse>({
      })

  const signedOut = isUnauthorized(query.error)

  return {
    user: query.data,
    isPending: query.isPending,
    isSignedIn: query.data !== undefined,
    isSignedOut: signedOut,
    error: signedOut ? null : (query.error ?? null),
  }
}

/**
 * 로그아웃.
 *
 * 성공하면 캐시를 통째로 비운다. 세션 쿠키가 사라진 뒤에도 이전 사용자의 프로젝트 목록이
 * 캐시에 남아 있으면, 다음 사용자가 로그인하기 전까지 그것이 화면에 보인다.
 */
export function useSignOut() {
  const queryClient = useQueryClient()

  return useLogout({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        })
        queryClient.clear()
      },
    },
  })
}
