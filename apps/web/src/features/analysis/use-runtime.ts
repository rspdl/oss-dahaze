'use client'

import {
  useGetRspdlRuntime,
  type RspdlRuntimeResponse,
} from '@dahaze/api-client'


/**
 * 이 서버가 어떤 rspdl 로 컴파일하는지.
 *
 * 한 프로세스는 rspdl 버전을 하나만 가진다 (ADR-0002). 그래서 이 값은 배포 사이에 바뀌지
 * 않는다 — 자주 물을 이유가 없어 `staleTime` 을 길게 준다.
 */
const RUNTIME_STALE_TIME_MS = 60 * 60 * 1000

export function useRspdlRuntime() {
  return useGetRspdlRuntime<RspdlRuntimeResponse>({
    query: { staleTime: RUNTIME_STALE_TIME_MS },
  })
}

/**
 * 문서에 기록된 버전과 서버 버전이 다른가.
 *
 * **이 비교가 버전 설계의 존재 이유다.** 문서는 자기가 쓰인 rspdl 버전을 기억하고
 * (`target_rspdl_version`), 서버는 자기 버전으로 컴파일한다. 둘이 다르면 지금 보이는 진단은
 * 문서를 쓸 때의 진단과 다를 수 있다. 조용히 넘어가면 사용자는 진단이 바뀐 이유를 자기
 * 문서에서 찾게 된다.
 *
 * 우리가 판단하지 않는다 — 어느 쪽이 옳은지 정하지 않고 "다르다" 는 사실만 알린다.
 */
export function useVersionMismatch(targetVersion: string | undefined): {
  serverVersion: string | undefined
  mismatched: boolean
} {
  const runtime = useRspdlRuntime()
  const serverVersion = runtime.data?.rspdl_version

  return {
    serverVersion,
    mismatched:
      targetVersion !== undefined &&
      serverVersion !== undefined &&
      targetVersion !== serverVersion,
  }
}
