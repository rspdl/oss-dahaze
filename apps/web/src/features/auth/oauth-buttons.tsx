'use client'

import {
  getBeginOauthLoginUrl,
  useListAuthProviders,
  type AuthProvidersResponse,
} from '@dahaze/api-client'
import { Button, Skeleton } from '@dahaze/ui'

import { absoluteApiUrl } from '@/shared/api/base-url'
import { errorMessage } from '@/shared/api/errors'

/**
 * OAuth 로 들어가는 문.
 *
 * **버튼을 하드코딩하지 않는다.** 어떤 제공자가 켜져 있는지는 서버의 설정이 정하고 서버가
 * `/api/auth/providers` 로 알려준다. GitHub 을 박아 두면 두 번째 제공자가 붙는 날 프론트
 * 배포가 있어야 로그인할 수 있게 된다.
 *
 * 제공자가 하나도 없으면 **구분선까지 통째로 사라진다.** 아이디·비밀번호 문이 항상 옆에
 * 열려 있으므로, 여기서 "설정된 OAuth 가 없습니다" 라고 말하면 들어갈 수 있는 사람에게
 * 못 들어온다고 말하는 셈이 된다. 구분선을 부르는 쪽에 두면 아래가 빈 채로 선만 남는다.
 */
export function OAuthButtons({ redirectTo }: { redirectTo: string }) {
  const query = useListAuthProviders<AuthProvidersResponse>({})

  if (query.isPending) return <Skeleton className="h-9 w-full" />

  if (query.error !== null) {
    return (
      <p className="text-sm leading-relaxed text-diagnostic-error">
        OAuth 로그인 방법을 불러오지 못했습니다. {errorMessage(query.error)}
      </p>
    )
  }

  const providers = query.data?.providers ?? []
  if (providers.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-3 flex items-center gap-3">
        <span aria-hidden className="h-px flex-1 bg-border" />
        <span className="text-xs text-text-subtle">또는</span>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>

      {providers.map((provider) => (
        <OAuthButton key={provider} provider={provider} redirectTo={redirectTo} />
      ))}
    </div>
  )
}

/** 서버가 준 제공자 id 를 사람이 읽을 이름으로. 모르는 id 는 그대로 보여준다. */
const PROVIDER_LABEL: Record<string, string> = {
  github: 'GitHub',
}

function OAuthButton({
  provider,
  redirectTo,
}: {
  provider: string
  redirectTo: string
}) {
  /*
   * fetch 로 부르지 않는다. 이 엔드포인트는 제공자에게 302 하고, 브라우저가 그 리다이렉트를
   * 직접 따라가야 사용자가 제공자의 화면을 보고 쿠키를 받아온다. XHR 로 부르면 리다이렉트는
   * 조용히 따라가지만 사용자는 아무 것도 못 본다.
   */
  const onClick = () => {
    const absoluteRedirect = new URL(redirectTo, window.location.origin).toString()
    window.location.href = absoluteApiUrl(
      getBeginOauthLoginUrl(provider, { redirect_to: absoluteRedirect }),
    )
  }

  return (
    <Button variant="outline" onClick={onClick} className="w-full">
      {PROVIDER_LABEL[provider] ?? provider} 계정으로 계속하기
    </Button>
  )
}
