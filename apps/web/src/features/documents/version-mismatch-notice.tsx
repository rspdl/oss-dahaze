'use client'

import { useVersionMismatch } from '@/features/analysis/use-runtime'

/**
 * 문서가 기억하는 rspdl 버전과 서버 버전이 다를 때 알린다.
 *
 * **이것이 버전 설계 전체의 이유다.** 문서는 `target_rspdl_version` 으로 자기가 쓰인 버전을
 * 기억하지만, 컴파일은 언제나 서버의 버전으로 돈다 — 한 프로세스는 rspdl 버전을 하나만
 * 가지기 때문이다 (ADR-0002). 둘이 다르면 지금 보이는 진단은 이 문서를 쓸 때 보던 진단과
 * 다를 수 있고, 그 사실을 말해 주지 않으면 사용자는 바뀐 원인을 자기 문장에서 찾게 된다.
 *
 * 어느 쪽이 옳은지는 우리가 정하지 않는다. 자동으로 버전을 올려 주지도 않는다. 다르다는
 * 사실만 전하고 판단은 사람이 한다.
 */
export function VersionMismatchNotice({
  targetVersion,
}: {
  targetVersion: string
}) {
  const { serverVersion, mismatched } = useVersionMismatch(targetVersion)
  if (!mismatched) return null

  return (
    <div
      role="status"
      className="rounded-panel border border-diagnostic-info bg-diagnostic-info-subtle px-3 py-2 text-sm text-text"
    >
      <strong className="font-medium">컴파일러 버전이 다릅니다.</strong> 이 문서는{' '}
      <span className="font-mono">rspdl {targetVersion}</span> 기준으로 쓰였고, 지금
      컴파일은 서버의 <span className="font-mono">rspdl {serverVersion}</span> 로
      돕니다. 아래 진단은 서버 버전 기준이라 문서를 쓸 때와 다를 수 있습니다.
    </div>
  )
}
