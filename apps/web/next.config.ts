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

  /**
   * 루트에는 화면이 없다. 이 제품에서 사람이 하는 일은 프로젝트 안에 있고, 그 앞에 소개
   * 화면을 세워 두면 매일 쓰는 사람이 매일 한 번씩 그것을 지나야 한다.
   *
   * 라우트 파일에서 `redirect()` 하지 않고 여기서 처리한다. 설정의 리다이렉트는 파일
   * 시스템보다 먼저 검사되므로 React 를 한 번도 그리지 않고 끝난다.
   *
   * `permanent: false` 다. 308 은 브라우저가 영구히 캐시하므로, 언젠가 루트에 화면을
   * 되돌리면 이미 한 번 다녀간 사람에게는 영원히 보이지 않는다.
   */
  redirects() {
    return Promise.resolve([
      { source: '/', destination: '/projects', permanent: false },
    ])
  },
}

export default nextConfig
