'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  ErrorState,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Skeleton,
  cn,
  toast,
} from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/format'
import {
  renderDiagnosticMessage,
  renderDiagnosticTitle,
} from '@/shared/rspdl/diagnostic-messages'
import { ChevronRightIcon, SparkleIcon } from '@/shared/ui/icons'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { RequireSession } from '@/features/auth/require-session'
import { viewHref } from '@/features/navigation/views'
import { useCompile } from '@/features/analysis/use-compile'
import { RevisePanel } from '@/features/authoring/revise-panel'
import { DocumentIssueBanner } from './document-issue-banner'
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
      fullBleed
      /*
       * 이 화면은 페이지가 길어지면 안 된다. 편집기와 AI 대화는 각자 자기 안에서 스크롤하고,
       * 화면 아래에 붙은 AI 입력창은 언제든 그 자리에 있어야 한다. 페이지가 늘어나면 입력창이
       * 화면 밖으로 밀려나고, 거기 닿으려고 스크롤하면 편집기가 위로 사라진다.
       */
      lockToViewport
      breadcrumb={
        <>
          <Crumb href={viewHref(projectId, 'documents')}>문서 편집</Crumb>
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
  const query = useGetDocument<DocumentResponse>(documentId)

  if (query.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="min-h-64 flex-1" />
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
            <Link href={viewHref(projectId, 'documents')}>문서 목록으로</Link>
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
  const isAiPanelCollapsed = useWorkbenchStore((state) => state.isAiPanelCollapsed)
  const setAiPanelCollapsed = useWorkbenchStore((state) => state.setAiPanelCollapsed)

  const [summary, setSummary] = useState('')
  const [selectedIssueIndex, setSelectedIssueIndex] = useState(0)
  const [revealSpan, setRevealSpan] = useState<{ start: number; end: number } | null>(
    null,
  )
  const [suggestedAiRequest, setSuggestedAiRequest] = useState<{
    key: number
    text: string
  }>()
  const queryClient = useQueryClient()
  const updateDocument = useUpdateDocument()

  const diagnostics = useMemo(
    () => compile.snapshot?.diagnostics ?? [],
    [compile.snapshot],
  )

  /*
   * 다시 컴파일하면 진단 목록은 통째로 갈린다. 범위를 벗어난 index 를 그냥 들고 있으면
   * 0 건이 됐다가 다시 생겼을 때 아무도 고르지 않은 문제가 선택된 채로 살아난다. 그래서
   * 렌더 중에 바로 0 으로 되돌린다 — effect 로 미루면 그 사이 한 프레임 동안 배너와
   * `onAskAi` 가 서로 다른 진단을 가리킨다.
   */
  if (selectedIssueIndex !== 0 && selectedIssueIndex >= diagnostics.length) {
    setSelectedIssueIndex(0)
  }

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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/*
        제목과 저장 버튼을 한 줄에 둔다. 편집 중에는 이 줄이 화면에서 유일하게 움직이지 않는
        기준점이라, 여기서 저장 상태를 읽을 수 있어야 손이 편집기를 떠나지 않는다.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {document.title}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-subtle">
            <span className="font-mono">{document.path}</span>
            <span aria-hidden>·</span>
            <span className="font-mono">rspdl {document.target_rspdl_version}</span>
            <span aria-hidden>·</span>
            <span>수정 {formatDateTime(document.updated_at)}</span>
            {isDirty ? (
              <>
                {/*
                  저장되지 않았다는 사실은 색으로만 말하지 않는다. 점은 눈에 먼저 띄고,
                  글자는 색을 구분하지 못하는 사람에게도 같은 말을 한다.
                */}
                <span
                  aria-hidden
                  className="ml-1 size-1.5 rounded-full bg-diagnostic-warning"
                />
                <span className="text-diagnostic-warning">저장되지 않음</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            aria-label="이 편집에 대한 설명 (선택)"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="변경 요약 (선택)"
            className="h-9 w-44 rounded-control border bg-surface px-3 text-sm transition-colors duration-200 ease-out-expo placeholder:text-text-subtle focus-visible:border-accent lg:w-56"
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
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">이력</Button>
            </DialogTrigger>
            <DialogContent className="flex max-h-[80dvh] min-h-96 flex-col sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>문서 저장 이력</DialogTitle>
                <DialogDescription>
                  저장할 때마다 남은 리비전과 변경 요약을 확인합니다.
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-hidden rounded-panel border">
                <RevisionHistory documentId={documentId} />
              </div>
            </DialogContent>
          </Dialog>
          <Button onClick={save} disabled={!isDirty || updateDocument.isPending}>
            {updateDocument.isPending ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>

      <VersionMismatchNotice targetVersion={document.target_rspdl_version} />

      <DocumentIssueBanner
        diagnostics={diagnostics}
        selectedIndex={selectedIssueIndex}
        hasResult={compile.snapshot !== null}
        isCompiling={compile.isCompiling}
        isCurrent={compile.isCurrent}
        recognized={compile.snapshot?.recognized ?? true}
        errorMessage={
          compile.error === null || compile.error === undefined
            ? undefined
            : errorMessage(compile.error)
        }
        onRetry={compile.recompile}
        renderMessage={renderDiagnosticMessage}
        renderTitle={renderDiagnosticTitle}
        onSelect={(diagnostic, index) => {
          setSelectedIssueIndex(index)
          if (compile.isCurrent) setRevealSpan({ ...diagnostic.span })
        }}
        onAskAi={(diagnostic, index) => {
          setSelectedIssueIndex(index)
          // 접힌 채로 요청을 보내면 아무 일도 안 일어난 것처럼 보인다. 요청을 받는 자리를
          // 먼저 펼친다.
          setAiPanelCollapsed(false)
          const message = renderDiagnosticMessage(diagnostic)
          const title = renderDiagnosticTitle(diagnostic)
          setSuggestedAiRequest((current) => ({
            key: (current?.key ?? 0) + 1,
            text: `다음 검토 문제를 해결하도록 문서를 수정해 주세요.\n\n${title}\n${message}\n\n규칙: ${diagnostic.rule_id}`,
          }))
        }}
      />

      {/*
        높이를 `calc(100dvh - 16rem)` 처럼 계산하지 않는다. 그 16rem 은 위쪽 요소들의 높이를
        손으로 더한 값이라, 줄 하나만 늘어도 편집기가 화면 밖으로 밀린다. 남은 공간을
        그대로 차지하게 두면 위가 무엇으로 바뀌든 알아서 맞는다.

        최소 높이를 두지 않는다. 바닥값을 주면 화면이 짧을 때 그 값이 뷰포트를 넘겨, 가둬 둔
        레이아웃이 도로 페이지를 밀어낸다 — 편집기가 좁아지는 것보다 입력창이 사라지는 쪽이
        나쁘다. 편집기는 자기 안에서 스크롤하므로 좁아져도 내용을 잃지 않는다.
      */}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-panel border bg-surface">
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-w-0 flex-1"
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
              renderMessage={renderDiagnosticMessage}
              revealSpan={revealSpan}
              placeholder="여기에 RSPDL 로 제품 의도를 씁니다."
              ariaLabel={`${document.title} 본문`}
              className="h-full"
            />
          </ResizablePanel>

          <ResizableHandle withHandle className={cn(isAiPanelCollapsed && 'hidden')} />

          {/*
            접을 때 AI 패널을 트리에서 떼지 않고 감춘다. 떼면 지금까지의 대화가 사라지고,
            사람은 접었다 편 대가로 방금 받은 초안을 잃는다. 감춘 동안 편집기 패널이 남은
            폭을 전부 가져간다.
          */}
          <ResizablePanel
            defaultSize={`${100 - editorSize}`}
            minSize="25"
            className={cn('relative', isAiPanelCollapsed && 'hidden')}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="AI 도우미 접기"
              className="absolute top-2.5 right-2 z-10"
              onClick={() => setAiPanelCollapsed(true)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
            <RevisePanel
              documentId={documentId}
              currentText={text}
              onApplyDraft={(next) => setDraft(documentId, next)}
              suggestedRequest={suggestedAiRequest}
            />
          </ResizablePanel>
        </ResizablePanelGroup>

        {/*
          접힌 상태에서도 되돌아올 자리가 화면에 남아 있어야 한다. 세로 바가 없으면 AI 패널은
          접는 순간 사라진 기능이 된다.
        */}
        {isAiPanelCollapsed ? (
          <div className="flex w-11 shrink-0 flex-col items-center gap-2 border-l bg-surface-raised py-2.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="AI 도우미 펼치기"
              onClick={() => setAiPanelCollapsed(false)}
            >
              <SparkleIcon className="size-4" />
            </Button>
            <span
              aria-hidden
              className="text-xs whitespace-nowrap text-text-muted [writing-mode:vertical-rl]"
            >
              AI 도우미
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
