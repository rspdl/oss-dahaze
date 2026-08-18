'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Button, ErrorState, Skeleton } from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { AppShell } from '@/shared/ui/app-shell'
import { SignInButtons } from './sign-in-buttons'
import { useSession } from './use-session'

/**
 * 첫 화면.
 *
 * 로그인해 있으면 프로젝트 목록으로 보낸다. 로그아웃 상태면 이 제품이 무엇인지 먼저 말한다 —
 * RSPDL 을 모르는 사람에게 로그인 버튼만 보여주면 무엇에 로그인하는지 알 수 없다.
 */
export function LandingScreen() {
  const session = useSession()
  const router = useRouter()

  /*
   * 로그인 상태 확인은 클라이언트에서만 가능하다 (쿠키가 API 도메인에 있다). 그래서 서버
   * 리다이렉트가 아니라 세션이 확인된 뒤의 이동이다. `replace` 인 이유는 뒤로 가기로 이
   * 화면에 돌아오면 다시 튕겨 나가는 고리가 생기기 때문이다.
   */
  useEffect(() => {
    if (session.isSignedIn) router.replace('/projects')
  }, [session.isSignedIn, router])

  return (
    <AppShell>
      <section className="mx-auto max-w-2xl py-10">
        <h1 className="text-3xl font-semibold tracking-tight">
          기획을 구현 전에 검증합니다
        </h1>
        <p className="mt-4 text-text-muted">
          dahaze 는 RSPDL 로 제품 의도를 쓰고, 코드를 쓰기 전에 데이터 lifecycle 과 정책의
          정합성 문제를 찾아내는 워크스페이스입니다. 판단은 전부 RSPDL 컴파일러가 합니다 —
          dahaze 는 그 결과를 저장하고 보여줄 뿐 다시 해석하지 않습니다.
        </p>

        <ul className="mt-8 space-y-3 text-sm text-text-muted">
          <li>
            <strong className="text-text">한국어로 쓴다.</strong> RSPDL 은 한국어 우선
            선언형 언어입니다. 기획자가 읽는 문장이 그대로 검증 대상입니다.
          </li>
          <li>
            <strong className="text-text">고칠 곳을 짚어 준다.</strong> 컴파일 진단이 몇 행
            몇 열인지까지 편집기에 그대로 표시됩니다.
          </li>
          <li>
            <strong className="text-text">LLM 초안도 같은 문을 지난다.</strong> 자동으로
            만든 초안도 컴파일 결과와 함께 도착하고, 저장은 사람이 직접 합니다.
          </li>
        </ul>

        <div className="mt-10">
          <SignInState />
        </div>
      </section>
    </AppShell>
  )
}

function SignInState() {
  const session = useSession()

  if (session.isPending) return <Skeleton className="h-9 w-44" />

  if (session.error !== null) {
    return (
      <ErrorState
        title="서버에 연결하지 못했습니다"
        description={errorMessage(session.error)}
      />
    )
  }

  if (session.isSignedIn) {
    return (
      <Button asChild>
        <Link href="/projects">프로젝트로 이동</Link>
      </Button>
    )
  }

  return <SignInButtons redirectTo="/projects" />
}
