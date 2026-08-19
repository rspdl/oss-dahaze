'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import {
  getBeginOauthLoginUrl,
  useListAuthProviders,
  type AuthProvidersResponse,
} from '@dahaze/api-client'
import { Button, Input, Label, Skeleton } from '@dahaze/ui'

import { absoluteApiUrl } from '@/shared/api/base-url'
import { errorMessage } from '@/shared/api/errors'
import { useDevSignIn } from './use-session'

/**
 * 로그인 방법.
 *
 * **버튼을 하드코딩하지 않는다.** 어떤 제공자가 켜져 있는지, 개발용 로그인이 열려 있는지는
 * 서버의 설정이 정하고 서버가 `/api/auth/providers` 로 알려준다. GitHub 를 박아 두면 두 번째
 * 제공자가 붙는 날 프론트 배포가 있어야 로그인할 수 있게 된다.
 */

/** 서버가 준 제공자 id 를 사람이 읽을 이름으로. 모르는 id 는 그대로 보여준다. */
const PROVIDER_LABEL: Record<string, string> = {
  github: 'GitHub',
}

export function SignInButtons({ redirectTo }: { redirectTo: string }) {
  const query = useListAuthProviders<AuthProvidersResponse>({})

  if (query.isPending) {
    return <Skeleton className="h-9 w-40" />
  }

  if (query.error !== null) {
    return (
      <p className="text-sm text-diagnostic-error">
        로그인 방법을 불러오지 못했습니다. {errorMessage(query.error)}
      </p>
    )
  }

  const providers = query.data?.providers ?? []
  const devLogin = query.data?.dev_login ?? false

  if (providers.length === 0 && !devLogin) {
    return (
      <p className="max-w-[52ch] text-sm leading-relaxed text-text-muted">
        이 서버에는 설정된 로그인 방법이 없습니다. 로컬에서 띄운 서버라면{' '}
        <code className="font-mono text-text">ENVIRONMENT=development</code> 로 켜면
        아이디·비밀번호로 바로 들어올 수 있습니다.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {providers.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {providers.map((provider) => (
            <SignInButton
              key={provider}
              provider={provider}
              redirectTo={redirectTo}
            />
          ))}
        </div>
      )}

      {devLogin ? (
        <DevSignInForm withDivider={providers.length > 0} redirectTo={redirectTo} />
      ) : null}
    </div>
  )
}

function SignInButton({
  provider,
  redirectTo,
}: {
  provider: string
  redirectTo: string
}) {
  /*
   * fetch 로 부르지 않는다. 이 엔드포인트는 GitHub 로 302 하고, 브라우저가 그 리다이렉트를
   * 직접 따라가야 사용자가 GitHub 화면을 보고 쿠키를 받아온다. XHR 로 부르면 리다이렉트는
   * 조용히 따라가지만 사용자는 아무 것도 못 본다.
   */
  const onClick = () => {
    const absoluteRedirect = new URL(redirectTo, window.location.origin).toString()
    window.location.href = absoluteApiUrl(
      getBeginOauthLoginUrl(provider, { redirect_to: absoluteRedirect }),
    )
  }

  return (
    <Button onClick={onClick}>
      {PROVIDER_LABEL[provider] ?? provider} 계정으로 로그인
    </Button>
  )
}

/**
 * 개발 환경 전용 로그인 폼.
 *
 * 기여자가 GitHub OAuth App 을 먼저 만들지 않고도 화면을 볼 수 있게 하는 문이다. 서버가
 * `dev_login: true` 를 줄 때만 그려지고, 그 값은 development 에서만 참이다.
 *
 * 기본값을 채워 둔다. 이 폼의 목적이 신원 확인이 아니라 **문을 빨리 통과하는 것** 이라,
 * 처음 온 사람이 무엇을 쳐야 하는지 검색하게 만들면 목적을 잃는다. 아이디를 바꾸면 다른
 * 사람이 되므로 공유·권한 화면도 로컬에서 확인할 수 있다.
 */
function DevSignInForm({
  redirectTo,
  withDivider,
}: {
  redirectTo: string
  withDivider: boolean
}) {
  const [username, setUsername] = useState('dev')
  const [password, setPassword] = useState('dahaze')
  const signIn = useDevSignIn()
  const router = useRouter()

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    signIn.mutate(
      { data: { username, password } },
      { onSuccess: () => router.push(redirectTo) },
    )
  }

  return (
    <div className="max-w-sm">
      {withDivider ? (
        <div className="mb-5 flex items-center gap-3">
          <span aria-hidden className="h-px flex-1 bg-border" />
          <span className="text-xs text-text-subtle">또는</span>
          <span aria-hidden className="h-px flex-1 bg-border" />
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-text">개발 환경 로그인</p>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            이 서버는 <code className="font-mono">development</code> 로 떠 있어 아이디만
            정하면 들어올 수 있습니다. 아이디가 곧 계정이라, 다른 아이디로 들어오면 다른
            사람이 됩니다.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="dev-username">아이디</Label>
          <Input
            id="dev-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="dev-password">비밀번호</Label>
          <Input
            id="dev-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            aria-describedby="dev-password-hint"
          />
          <p id="dev-password-hint" className="text-xs text-text-subtle">
            <code className="font-mono">DEV_LOGIN_PASSWORD</code> 에 설정한 값. 기본값은{' '}
            <code className="font-mono">dahaze</code> 입니다.
          </p>
        </div>

        {signIn.error === null ? null : (
          <p role="alert" className="text-sm text-diagnostic-error">
            {errorMessage(signIn.error)}
          </p>
        )}

        <Button type="submit" disabled={signIn.isPending} className="self-start">
          {signIn.isPending ? '들어가는 중…' : '개발 계정으로 들어가기'}
        </Button>
      </form>
    </div>
  )
}
