'use client'

import {
  useListDocumentRevisions,
  type DocumentRevisionResponse,
} from '@dahaze/api-client'
import { ErrorState, ScrollArea, Skeleton } from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/format'

/**
 * 저장 이력.
 *
 * 저장이 명시적이라는 설계가 여기서 값을 낸다. 사람이 누른 저장 하나가 리비전 하나이므로
 * 이력을 읽으면 문서가 어떻게 변해 왔는지가 그대로 남는다 — LLM 이 조용히 덮어썼다면 이
 * 목록은 아무 것도 설명하지 못했을 것이다 (ADR-0005).
 *
 * 각 리비전이 어떤 rspdl 버전 기준으로 쓰였는지도 함께 남는다. 진단이 달라 보이는 이유를
 * 나중에 되짚을 수 있는 유일한 단서다.
 */
export function RevisionHistory({ documentId }: { documentId: string }) {
  const query = useListDocumentRevisions<DocumentRevisionResponse[]>(documentId, {
      })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <h2 className="text-sm font-medium text-text">저장 이력</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          저장할 때마다 리비전이 하나 남습니다.
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {query.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : query.error !== null ? (
          <ErrorState
            className="m-3"
            title="이력을 불러오지 못했습니다"
            description={errorMessage(query.error)}
          />
        ) : (query.data?.length ?? 0) === 0 ? (
          <p className="p-6 text-center text-sm text-text-muted">
            아직 저장한 적이 없습니다.
          </p>
        ) : (
          <ul className="divide-y">
            {query.data?.map((revision) => (
              <li key={revision.id} className="px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <span className="font-mono text-text">#{revision.revision_no}</span>
                  <span>{formatDateTime(revision.created_at)}</span>
                  <span className="ml-auto font-mono text-text-subtle">
                    rspdl {revision.target_rspdl_version}
                  </span>
                </div>
                {revision.summary === null ? null : (
                  <p className="mt-1 text-sm break-words text-text">
                    {revision.summary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
