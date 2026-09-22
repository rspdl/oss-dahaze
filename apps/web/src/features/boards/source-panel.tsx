'use client'

import Link from 'next/link'
import { useGetDocument, type DocumentResponse } from '@dahaze/api-client'
import { spanToLineColumn, spanToRange, type ByteSpan } from '@dahaze/rspdl-editor'
import { Button, Skeleton } from '@dahaze/ui'

import { documentHref } from '@/features/navigation/views'
import { FileIcon } from '@/shared/ui/icons'

/**
 * 고른 노드가 어느 원문에서 왔는지 보여준다. **읽기 전용이다.**
 *
 * 같은 텍스트를 두 곳에서 편집하면 작업대의 저장하지 않은 초안과 갈라진다. 여기서는 보여만
 * 주고, 고치려면 문서로 간다.
 *
 * `span` 은 **UTF-8 바이트 오프셋**이다. JavaScript 문자열은 UTF-16 으로 세므로 그대로
 * 잘라내면 한글이 든 문서가 전부 어긋난다 — 그리고 여기 문서는 전부 한국어다. 변환은
 * `@dahaze/rspdl-editor` 가 소유하고 (ADR-0006), 여기서 다시 쓰지 않는다.
 */
export function SourcePanel({
  projectId,
  documentId,
  documentTitle,
  path,
  span,
  title,
  subtitle,
  emptyMessage,
}: {
  projectId: string
  /** 원문을 담은 문서. 경로로 문서를 찾지 못했으면 `null`. */
  documentId: string | null
  documentTitle: string | null
  path: string | null
  /** 보여줄 범위. 고른 것이 없거나 IR 이 span 을 주지 않았으면 `null`. */
  span: ByteSpan | null
  title: string
  subtitle: string | null
  emptyMessage: string
}) {
  return (
    <aside
      aria-label="선택한 항목의 원문"
      className="flex min-h-0 w-full flex-col gap-3 overflow-y-auto border-t bg-surface-raised/35 px-4 py-4 md:w-[22rem] md:shrink-0 md:border-t-0 md:border-l md:px-5"
    >
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-[0.1em] text-text-subtle">SOURCE</p>
        <h2 className="mt-2 truncate text-base font-semibold tracking-tight text-text">
          {title}
        </h2>
        {subtitle === null ? null : (
          <p className="mt-1 truncate font-mono text-xs text-text-subtle">{subtitle}</p>
        )}
      </div>

      {documentId === null ? (
        <p className="text-sm text-text-muted">
          {path === null ? emptyMessage : `${path} 문서를 찾지 못했습니다.`}
        </p>
      ) : (
        <>
          <SourceExcerpt documentId={documentId} span={span} />
          <Button variant="ghost" size="sm" className="-ml-2 w-fit text-text-muted" asChild>
            <Link href={documentHref(projectId, documentId)}>
              <FileIcon className="size-4" />
              {documentTitle ?? '문서에서 열기'}
            </Link>
          </Button>
        </>
      )}
    </aside>
  )
}

function SourceExcerpt({
  documentId,
  span,
}: {
  documentId: string
  span: ByteSpan | null
}) {
  const document = useGetDocument<DocumentResponse>(documentId)

  if (document.isPending) return <Skeleton className="h-28 w-full" />
  if (document.error !== null || document.data === undefined) {
    return <p className="text-sm text-text-muted">원문을 불러오지 못했습니다.</p>
  }

  const text = document.data.text
  if (span === null) {
    return (
      <p className="text-sm text-text-muted">
        컴파일 결과에 이 항목의 원문 위치가 없습니다.
      </p>
    )
  }

  const range = spanToRange(text, span)
  const excerpt = text.slice(range.from, range.to)
  const { line } = spanToLineColumn(text, span)

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 font-mono text-[11px] text-text-subtle">
        {line}행
      </figcaption>
      <pre className="overflow-x-auto rounded-control border bg-surface px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre text-text">
        {excerpt === '' ? '(빈 범위)' : excerpt}
      </pre>
    </figure>
  )
}
