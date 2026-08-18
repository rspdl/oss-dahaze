'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  getGetDocumentQueryKey,
  getListDocumentRevisionsQueryKey,
  getListDocumentsQueryKey,
  useGetDocument,
  useUpdateDocument,
  type DocumentResponse,
} from '@dahaze/api-client'
import { RspdlEditor } from '@dahaze/rspdl-editor'
import { useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  ErrorState,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/format'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { RequireSession } from '@/features/auth/require-session'
import { useCompile } from '@/features/analysis/use-compile'
import { RevisePanel } from '@/features/authoring/revise-panel'
import { DiagnosticsPanel } from './diagnostics-panel'
import { RevisionHistory } from './revision-history'
import { VersionMismatchNotice } from './version-mismatch-notice'
import { useDraft, useDraftStore } from './draft-store'
import { useWorkbenchStore } from './workbench-store'

/**
 * 문서 작업 화면.
 *
 * 편집기 · 진단 · LLM 저작이 한 화면에 있다. 이 셋의 관계가 제품의 핵심이므로 화면을 나누지
 * 않는다 — 진단을 보려고 화면을 옮겨야 하면 사람은 진단을 보지 않게 된다.
 */
export function DocumentWorkbenchScreen({
  projectId,
  documentId,
}: {
  projectId: string
  documentId: string
}) {
  return (
    <AppShell
      breadcrumb={
        <>
          <Crumb href="/projects">프로젝트</Crumb>
          <Crumb href={`/projects/${projectId}`}>문서 목록</Crumb>
        </>
      }
    >
      <RequireSession>
        <DocumentLoader projectId={projectId} documentId={documentId} />
      </RequireSession>
    </AppShell>
  )
}

function DocumentLoader({
  projectId,
  documentId,
}: {
  projectId: string
  documentId: string
}) {
  const query = useGetDocument<DocumentResponse>(documentId, {
      })

  if (query.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    )
  }

  if (query.error !== null || query.data === undefined) {
    return (
      <ErrorState
        title="문서를 불러오지 못했습니다"
        description={errorMessage(query.error)}
        action={
          <Button variant="outline" asChild>
            <Link href={`/projects/${projectId}`}>프로젝트로 돌아가기</Link>
          </Button>
        }
      />
    )
  }

  return <Workbench projectId={projectId} document={query.data} />
}

function Workbench({
  projectId,
  document,
}: {
  projectId: string
  document: DocumentResponse
}) {
  const documentId = document.id

  /*
   * 편집 중인 텍스트는 클라이언트 상태다. 저장하기 전까지 서버는 이 텍스트를 모른다
   * (ADR-0006). 초안이 없으면 서버 본문을 그대로 보여준다 — 서버 본문을 스토어에 복사해
   * 두지 않기 때문에, 다른 사람이 저장한 내용이 들어오면 그대로 따라간다.
   */
  const draft = useDraft(documentId)
  const setDraft = useDraftStore((state) => state.setDraft)
  const clearDraft = useDraftStore((state) => state.clearDraft)

  const text = draft ?? document.text
  const isDirty = draft !== undefined && draft !== document.text

  const compile = useCompile({ path: document.path, text })

  const editorSize = useWorkbenchStore((state) => state.editorSize)
  const setEditorSize = useWorkbenchStore((state) => state.setEditorSize)

  const [summary, setSummary] = useState('')
  const queryClient = useQueryClient()
  const updateDocument = useUpdateDocument()

  const save = useCallback(() => {
    if (!isDirty || updateDocument.isPending) return
    updateDocument.mutate(
      {
        documentId,
        data: { text, summary: summary.trim() === '' ? null : summary.trim() },
      },
      {
        onSuccess: async () => {
          /*
           * 저장에 성공하면 초안을 버린다. 이 시점부터 진실은 서버에 있고, 초안이 남아
           * 있으면 서버가 바뀌어도 화면은 옛 텍스트를 계속 보여준다 (ADR-0006).
           */
          clearDraft(documentId)
          setSummary('')
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: getGetDocumentQueryKey(documentId),
            }),
            queryClient.invalidateQueries({
              queryKey: getListDocumentsQueryKey(projectId),
            }),
            queryClient.invalidateQueries({
              queryKey: getListDocumentRevisionsQueryKey(documentId),
            }),
          ])
          toast.success('저장했습니다')
        },
        onError: (error) => {
          toast.error('저장하지 못했습니다', { description: errorMessage(error) })
        },
      },
    )
  }, [
    clearDraft,
    documentId,
    isDirty,
    projectId,
    queryClient,
    summary,
    text,
    updateDocument,
  ])

  /* 편집기에서 손을 떼지 않고 저장할 수 있어야 한다. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 's' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      save()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  /* 저장하지 않은 편집이 있는 채로 탭을 닫으면 브라우저가 한 번 물어보게 한다. */
  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {document.title}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-subtle">
            <span className="font-mono">{document.path}</span>
            <span aria-hidden>·</span>
            <span>rspdl {document.target_rspdl_version} 기준</span>
            <span aria-hidden>·</span>
            <span>수정 {formatDateTime(document.updated_at)}</span>
            {isDirty ? <Badge variant="secondary">저장되지 않음</Badge> : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            aria-label="이 편집에 대한 설명 (선택)"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="변경 요약 (선택)"
            className="h-9 w-52 rounded-control border bg-surface px-3 text-sm placeholder:text-text-subtle"
          />
          {isDirty ? (
            <Button
              variant="ghost"
              onClick={() => clearDraft(documentId)}
              disabled={updateDocument.isPending}
            >
              편집 취소
            </Button>
          ) : null}
          <Button onClick={save} disabled={!isDirty || updateDocument.isPending}>
            {updateDocument.isPending ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>

      <VersionMismatchNotice targetVersion={document.target_rspdl_version} />

      <ResizablePanelGroup
        orientation="horizontal"
        className="h-[calc(100dvh-16rem)] min-h-96 rounded-panel border"
      >
        {/*
          `defaultSize` 는 숫자면 픽셀, 문자열이면 퍼센트다. 우리가 저장하는 값은 비율이므로
          반드시 문자열로 넘긴다 — 숫자로 넘기면 62px 짜리 편집기가 나온다.
        */}
        <ResizablePanel
          defaultSize={`${editorSize}`}
          minSize="30"
          onResize={(panelSize) => setEditorSize(panelSize.asPercentage)}
        >
          <RspdlEditor
            value={text}
            onChange={(next) => setDraft(documentId, next)}
            /*
             * 진단은 **그 진단을 만든 텍스트에 대해서만** 위치가 맞는다. 편집 중이라 짝이
             * 어긋난 동안에는 밑줄을 아예 그리지 않는다 — 엉뚱한 곳에 그어진 밑줄은 없느니만
             * 못하다. 그동안에도 진단 목록은 자기 텍스트 기준으로 계속 보인다.
             */
            diagnostics={compile.isCurrent ? compile.snapshot?.diagnostics : []}
            placeholder="여기에 RSPDL 로 제품 의도를 씁니다."
            ariaLabel={`${document.title} 본문`}
            className="h-full"
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={`${100 - editorSize}`} minSize="25">
          <Tabs defaultValue="diagnostics" className="flex h-full min-h-0 flex-col">
            <TabsList variant="line" className="mx-3 mt-2">
              <TabsTrigger value="diagnostics">진단</TabsTrigger>
              <TabsTrigger value="authoring">LLM 저작</TabsTrigger>
              <TabsTrigger value="history">이력</TabsTrigger>
            </TabsList>
            <TabsContent value="diagnostics" className="min-h-0 flex-1">
              <DiagnosticsPanel compile={compile} />
            </TabsContent>
            <TabsContent value="authoring" className="min-h-0 flex-1">
              <RevisePanel
                documentId={documentId}
                onApplyDraft={(next) => setDraft(documentId, next)}
              />
            </TabsContent>
            <TabsContent value="history" className="min-h-0 flex-1">
              <RevisionHistory documentId={documentId} />
            </TabsContent>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
