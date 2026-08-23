'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button,
  ErrorState,
  Input,
  Label,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { OAuthButtons } from './oauth-buttons'
import { usePasswordSignIn, useRegisterAccount, useSession } from './use-session'

/**
 * 로그인 화면.
 *
 * **개발이든 프로덕션이든 같은 화면이다.** 예전에는 개발 환경에서만 열리는 로그인 폼이
 * 따로 있었고, 그래서 로컬에서 보는 첫 화면과 배포된 첫 화면이 달랐다. 화면이 갈리면
 * 로컬에서 재현되지 않는 문제가 로그인 단계에서부터 생긴다.
 *
 * 화면에 폼 말고는 아무 것도 두지 않는다. 상단 막대도, 제품 설명도, 칸마다 붙는 도움말도
 * 없다. 여기 온 사람이 하려는 일은 하나뿐이고, 그 일을 둘러싼 글은 전부 그 일을 늦춘다.
 *
 * `AppShell` 도 쓰지 않는다. 왼쪽 기둥은 프로젝트를 오가는 도구인데 로그인 전에는 오갈
 * 프로젝트가 없다. 빈 기둥을 세워 두면 제품이 비어 보인다.
 */
export function LoginScreen() {
  const next = useNextPath()
  const session = useSession()
  const router = useRouter()

  /*
   * 로그인 상태 확인은 클라이언트에서만 가능하다 (쿠키가 API 도메인에 있다). 그래서 서버
   * 리다이렉트가 아니라 세션이 확인된 뒤의 이동이다. `replace` 인 이유는 뒤로 가기로 이
   * 화면에 돌아오면 다시 튕겨 나가는 고리가 생기기 때문이다.
   */
  useEffect(() => {
    if (session.isSignedIn) router.replace(next)
  }, [session.isSignedIn, router, next])

  /*
   * 세로 가운데 정렬을 `items-center` 가 아니라 `my-auto` 로 하는 이유: `items-center` 는
   * 내용이 화면보다 길어질 때 — 좁은 화면에서 회원가입 탭을 열면 그렇게 된다 — 위쪽을
   * 잘라 먹어서 아이디 칸에 닿을 수 없게 된다.
   */
  return (
    <main className="flex min-h-dvh flex-col items-center px-6 py-10">
      <div className="w-full max-w-sm md:my-auto">
        {session.error !== null ? (
          <ErrorState
            title="서버에 연결하지 못했습니다"
            description={errorMessage(session.error)}
          />
        ) : session.isPending || session.isSignedIn ? (
          <LoadingPlaceholder />
        ) : (
          <SignInPanel next={next} />
        )}
      </div>
    </main>
  )
}

/**
 * 세션을 확인하는 동안의 자리.
 *
 * 폼을 먼저 그리고 나중에 치우지 않는다. 이미 로그인한 사람이 이 주소로 들어오면 곧바로
 * 작업 화면으로 나가는데, 그 전에 로그인 폼이 한 번 번쩍이면 방금 로그아웃된 것처럼 보인다.
 */
function LoadingPlaceholder() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-4 h-9 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  )
}

type Mode = 'signin' | 'signup'

function SignInPanel({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>('signin')

  return (
    <>
      {/*
        상단 막대를 없앴으므로 제품 이름은 여기 한 번만 나온다. 제목에 "로그인" 을 쓰지
        않는 것은 바로 아래 탭이 이미 그 말을 하고 있기 때문이다 — 같은 말이 두 줄 연달아
        있으면 둘 다 읽히지 않는다.
      */}
      <h1 className="animate-rise text-2xl font-semibold tracking-tight">dahaze</h1>

      <Tabs
        value={mode}
        onValueChange={(value) => setMode(value as Mode)}
        className="animate-rise mt-6"
        style={{ animationDelay: '60ms' }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="signin">로그인</TabsTrigger>
          <TabsTrigger value="signup">회원가입</TabsTrigger>
        </TabsList>

        <TabsContent value="signin" className="pt-5">
          <SignInForm next={next} />
        </TabsContent>
        <TabsContent value="signup" className="pt-5">
          <SignUpForm next={next} />
        </TabsContent>
      </Tabs>

      <div className="animate-rise mt-7" style={{ animationDelay: '120ms' }}>
        <OAuthButtons redirectTo={next} />
      </div>
    </>
  )
}

function SignInForm({ next }: { next: string }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const signIn = usePasswordSignIn()
  const router = useRouter()

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    signIn.mutate(
      { data: { login, password } },
      { onSuccess: () => router.replace(next) },
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="아이디" htmlFor="signin-login">
        <Input
          id="signin-login"
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
      </Field>

      <Field label="비밀번호" htmlFor="signin-password">
        <Input
          id="signin-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>

      <FormError error={signIn.error} />

      <Button type="submit" disabled={signIn.isPending} className="w-full">
        {signIn.isPending ? '확인하는 중…' : '들어가기'}
      </Button>
    </form>
  )
}

/*
 * 서버 스키마와 같은 값. 규칙을 글로 적어 두는 대신 브라우저가 막게 한다 — 도움말은 다
 * 지키고 나면 읽을 이유가 없는 글이고, 어기는 순간에는 이미 늦었다.
 */
const LOGIN_PATTERN = '[A-Za-z0-9._\\-]{3,64}'
const MIN_PASSWORD_LENGTH = 8

function SignUpForm({ next }: { next: string }) {
  const [login, setLogin] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const register = useRegisterAccount()
  const router = useRouter()

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    register.mutate(
      { data: { login, display_name: displayName, password } },
      { onSuccess: () => router.replace(next) },
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="아이디" htmlFor="signup-login">
        <Input
          id="signup-login"
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          autoComplete="username"
          pattern={LOGIN_PATTERN}
          minLength={3}
          maxLength={64}
          required
        />
      </Field>

      <Field label="표시 이름" htmlFor="signup-name">
        <Input
          id="signup-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          autoComplete="name"
          maxLength={200}
          required
        />
      </Field>

      <Field label="비밀번호" htmlFor="signup-password">
        <Input
          id="signup-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </Field>

      <FormError error={register.error} />

      <Button type="submit" disabled={register.isPending} className="w-full">
        {register.isPending ? '만드는 중…' : '계정 만들기'}
      </Button>
    </form>
  )
}

/** 라벨은 입력 위. 라벨과 입력이 같은 세로선에서 시작해야 눈이 아래로만 내려간다. */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

/**
 * 실패는 폼 안에서, 제출 버튼 바로 위에 말한다.
 *
 * `role="alert"` 이 없으면 화면을 보지 않는 사용자에게는 아무 일도 일어나지 않은 것과
 * 같다 — 버튼을 눌렀는데 아무 소리가 없으니 계속 다시 누르게 된다.
 */
function FormError({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null

  return (
    <p role="alert" className="text-sm leading-relaxed text-diagnostic-error">
      {errorMessage(error)}
    </p>
  )
}

const DEFAULT_NEXT = '/projects'

function useNextPath(): string {
  const params = useSearchParams()
  return safeNextPath(params.get('next'))
}

/**
 * 로그인 뒤에 돌아갈 곳.
 *
 * `?next=` 는 주소창에서 누구나 바꿀 수 있는 값이라 **앱 안의 경로만 받는다.** 스킴이
 * 생략된 절대 URL(`//evil.example`)이나 역슬래시로 시작하는 값을 그대로 쓰면, 이 화면이
 * 곧 남의 사이트로 사람을 보내는 문이 된다 — 주소는 우리 도메인이므로 눈으로는 알 수 없다.
 *
 * 로그인 화면 자신도 받지 않는다. 들어온 직후 다시 여기로 오면 튕겨 나가는 고리가 된다.
 */
function safeNextPath(raw: string | null): string {
  if (raw === null || !raw.startsWith('/')) return DEFAULT_NEXT
  if (raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_NEXT
  if (raw === '/login' || raw.startsWith('/login?')) return DEFAULT_NEXT
  return raw
}
