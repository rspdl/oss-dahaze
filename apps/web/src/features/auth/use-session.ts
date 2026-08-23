'use client'

import {
  getGetCurrentUserQueryKey,
  useGetCurrentUser,
  useLogout,
  usePasswordLogin,
  useRegister,
  type CurrentUserResponse,
} from '@dahaze/api-client'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

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

/**
 * 아이디·비밀번호 로그인.
 *
 * OAuth 와 달리 페이지를 떠나지 않는다. 응답에 세션 쿠키가 실려 오므로, 성공하면 세션
 * 질의만 무효화하면 화면이 알아서 로그인 상태로 넘어간다.
 *
 * **환경을 보지 않는다.** 이 문은 개발이든 프로덕션이든 똑같이 열려 있다 — 환경에 따라
 * 켜지고 꺼지는 로그인이 있으면 로컬에서 보는 화면과 배포된 화면이 갈린다.
 */
export function usePasswordSignIn() {
  const queryClient = useQueryClient()

  return usePasswordLogin({
    mutation: { onSuccess: () => invalidateSession(queryClient) },
  })
}

/**
 * 회원가입.
 *
 * 가입하면 그대로 로그인된 상태가 된다 (서버가 같은 응답에 세션 쿠키를 싣는다). 방금 정한
 * 비밀번호를 로그인 탭에서 한 번 더 치게 하는 것은 확인이 아니라 마찰이다.
 */
export function useRegisterAccount() {
  const queryClient = useQueryClient()

  return useRegister({
    mutation: { onSuccess: () => invalidateSession(queryClient) },
  })
}

async function invalidateSession(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() })
}
