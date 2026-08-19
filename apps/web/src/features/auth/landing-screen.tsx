'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Button, ErrorState, Skeleton } from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { RuntimeVersionBadge } from '@/features/analysis/runtime-version-badge'
import { SignInButtons } from './sign-in-buttons'
import { useSession } from './use-session'

/**
 * 첫 화면.
 *
 * 로그인해 있으면 프로젝트 목록으로 보낸다. 로그아웃 상태면 이 제품이 무엇인지 먼저 말한다 —
 * RSPDL 을 모르는 사람에게 로그인 버튼만 보여주면 무엇에 로그인하는지 알 수 없다.
 *
 * 여기만 `AppShell` 을 쓰지 않는다. 왼쪽 기둥은 프로젝트를 오가는 도구인데 로그인 전에는
 * 오갈 프로젝트가 없다. 빈 기둥을 세워 두면 제품이 비어 보인다.
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
    <div className="min-h-dvh">
      <header className="flex h-14 items-center gap-3 px-6 md:px-10">
        <span className="text-sm font-semibold tracking-tight">dahaze</span>
        <div className="ml-auto">
          <RuntimeVersionBadge />
        </div>
      </header>

      {/*
        가운데 정렬하지 않는다. 글은 왼쪽에서 시작하고 예시는 오른쪽에 놓는다 — 읽는 순서와
        화면의 순서가 같아야 눈이 되돌아오지 않는다. 좁은 화면에서는 한 칸으로 접힌다.
      */}
      <main className="grid grid-cols-1 items-start gap-10 px-6 pt-6 pb-20 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-16 md:px-10 md:pt-16">
        <section className="max-w-[52ch]">
          <p className="animate-rise text-sm font-medium text-accent">
            RSPDL 저작·검증 워크스페이스
          </p>
          <h1
            className="animate-rise mt-3 text-4xl leading-none font-semibold tracking-tighter text-balance md:text-5xl"
            style={{ animationDelay: '60ms' }}
          >
            기획을 구현 전에 검증합니다
          </h1>
          <p
            className="animate-rise mt-5 leading-relaxed text-text-muted"
            style={{ animationDelay: '120ms' }}
          >
            dahaze 는 RSPDL 로 제품 의도를 쓰고, 코드를 쓰기 전에 데이터 lifecycle 과 정책의
            정합성 문제를 찾아내는 워크스페이스입니다. 판단은 전부 RSPDL 컴파일러가 합니다 —
            dahaze 는 그 결과를 저장하고 보여줄 뿐 다시 해석하지 않습니다.
          </p>

          <dl className="mt-10 divide-y border-y">
            {POINTS.map((point, index) => (
              <div
                key={point.term}
                className="animate-rise grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-6"
                style={{ animationDelay: `${180 + index * 70}ms` }}
              >
                <dt className="text-sm font-medium text-text">{point.term}</dt>
                <dd className="text-sm leading-relaxed text-text-muted">
                  {point.detail}
                </dd>
              </div>
            ))}
          </dl>

          <div className="animate-rise mt-10" style={{ animationDelay: '400ms' }}>
            <SignInState />
          </div>
        </section>

        <SamplePanel />
      </main>
    </div>
  )
}

const POINTS = [
  {
    term: '한국어로 쓴다',
    detail:
      'RSPDL 은 한국어 우선 선언형 언어입니다. 기획자가 읽는 문장이 그대로 검증 대상입니다.',
  },
  {
    term: '고칠 곳을 짚어 준다',
    detail: '컴파일 진단이 몇 행 몇 열인지까지 편집기에 그대로 표시됩니다.',
  },
  {
    term: 'LLM 초안도 같은 문을 지난다',
    detail:
      '자동으로 만든 초안도 컴파일 결과와 함께 도착하고, 저장은 사람이 직접 합니다.',
  },
]

/**
 * 오른쪽에 놓는 예시 화면.
 *
 * 스크린샷 대신 마크업으로 그린다. 이미지로 두면 테마가 바뀔 때 혼자 밝은 채로 남고, 글자가
 * 확대되지 않아 저시력 사용자에게는 읽을 수 없는 그림이 된다. 전부 장식이므로 스크린 리더
 * 에게는 숨긴다 — 옆의 글이 이미 같은 말을 하고 있다.
 */
function SamplePanel() {
  return (
    <div
      aria-hidden
      className="animate-rise hidden rounded-panel border bg-surface shadow-sm md:block"
      style={{ animationDelay: '240ms' }}
    >
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="font-mono text-xs text-text-subtle">주문.rspdl</span>
        <span className="ml-auto font-mono text-[0.6875rem] text-text-subtle">
          3 : 12
        </span>
      </div>

      <pre className="overflow-x-auto px-4 py-4 font-mono text-[0.8125rem] leading-6">
        <code>
          <span className="text-syntax-meta">개체</span>{' '}
          <span className="text-syntax-identifier">주문</span>
          {'\n'}
          {'  '}보관 <span className="text-syntax-number">5년</span>
          {'\n'}
          {'  '}
          <span className="decoration-diagnostic-warning underline decoration-wavy underline-offset-4">
            결제수단
          </span>{' '}
          공유 대상 정산팀
          {'\n'}
          {'\n'}
          <span className="text-syntax-comment"># 파기 시점이 선언되지 않았다</span>
        </code>
      </pre>

      <div className="border-t px-4 py-3">
        <p className="flex items-start gap-2 text-xs leading-relaxed">
          <span className="mt-px shrink-0 rounded-indicator bg-diagnostic-warning-subtle px-1.5 py-0.5 font-medium text-diagnostic-warning">
            경고
          </span>
          <span className="text-text-muted">
            <span className="font-mono">결제수단</span> 은 정산팀과 공유되지만 파기 시점이
            선언되지 않았습니다.
          </span>
        </p>
      </div>
    </div>
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
