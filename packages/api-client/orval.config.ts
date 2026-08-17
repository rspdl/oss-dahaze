import { defineConfig } from 'orval'

/**
 * openapi.json → TanStack Query 훅 + zod 스키마.
 *
 * 입력인 apps/api/openapi.json 은 FastAPI 라우터에서 생성되며 (ADR-0001), 손으로 고치지
 * 않는다. 생성물(src/generated)도 커밋하지 않는다 — codegen 이 build 의 선행 태스크다.
 */
export default defineConfig({
  api: {
    input: {
      target: '../../apps/api/openapi.json',
    },
    output: {
      mode: 'tags-split',
      target: './src/generated/endpoints',
      schemas: './src/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      indexFiles: true,
      prettier: false,
      override: {
        // 세션 쿠키를 상위 도메인으로 공유하므로 (ADR-0004) 모든 요청이
        // credentials: 'include' 로 나가야 한다. 그 규칙을 mutator 한 곳에 둔다.
        mutator: {
          path: './src/fetcher.ts',
          name: 'customFetch',
        },
        query: {
          useQuery: true,
          useMutation: true,
          // 조회 훅에 AbortSignal 을 넘긴다. 사용자가 화면을 떠나면 진행 중인 컴파일
          // 요청이 끊긴다 — 서버에서 실제 solver 가 도는 작업이라 낭비가 크다.
          signal: true,
        },
        // 오류 타입을 고정한다. 기본값(unknown)이면 화면마다 캐스팅이 생기고,
        // 그 캐스팅은 서로 다르게 틀린다.
        useTypeOverInterfaces: true,
      },
    },
  },
  zod: {
    input: {
      target: '../../apps/api/openapi.json',
    },
    output: {
      mode: 'tags-split',
      target: './src/generated/zod',
      client: 'zod',
      fileExtension: '.zod.ts',
      clean: true,
      prettier: false,
    },
  },
})
