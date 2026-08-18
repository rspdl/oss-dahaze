'use client'

import {
  getBeginOauthLoginUrl,
  useListAuthProviders,
  type AuthProvidersResponse,
} from '@dahaze/api-client'
import { Button, Skeleton } from '@dahaze/ui'

import { absoluteApiUrl } from '@/shared/api/base-url'
import { payload } from '@/shared/api/payload'
import { errorMessage } from '@/shared/api/errors'

/**
 * 로그인 제공자 버튼.
 *
 * **버튼을 하드코딩하지 않는다.** 어떤 제공자가 켜져 있는지는 서버의 자격증명 설정이 정하고,
 * 서버가 `/api/auth/providers` 로 알려준다. GitHub 를 박아 두면 두 번째 제공자가 붙는 날
 * 프론트 배포가 있어야 로그인할 수 있게 된다.
 */

/** 서버가 준 제공자 id 를 사람이 읽을 이름으로. 모르는 id 는 그대로 보여준다. */
const PROVIDER_LABEL: Record<string, string> = {
  github: 'GitHub',
}

export function SignInButtons({ redirectTo }: { redirectTo: string }) {
  const query = useListAuthProviders<AuthProvidersResponse>({
    query: { select: payload },
  })

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

  if (providers.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        이 서버에는 설정된 로그인 제공자가 없습니다. 관리자에게 문의하세요.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {providers.map((provider) => (
        <SignInButton key={provider} provider={provider} redirectTo={redirectTo} />
      ))}
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
