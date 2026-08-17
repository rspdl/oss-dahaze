import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * 워크스페이스 패키지는 빌드 산출물 없이 소스를 그대로 내보낸다 (ADR-0006).
   * Next 가 이들을 직접 트랜스파일해야 한다 — 빼먹으면 `Unexpected token` 으로 죽는다.
   *
   * 새 워크스페이스 패키지를 앱에서 쓰기 시작하면 여기에 추가한다.
   */
  // Next 16 부터는 빌드가 eslint 를 돌리지 않는다. 린트는 `pnpm lint` 와 CI 가 담당한다.
  transpilePackages: ['@dahaze/ui', '@dahaze/rspdl-editor', '@dahaze/api-client'],
}

export default nextConfig
