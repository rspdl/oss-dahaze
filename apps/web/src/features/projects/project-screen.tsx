'use client'

import Link from 'next/link'
import {
  useArchiveProject,
  useGetProject,
  useListDocuments,
  type DocumentSummaryResponse,
  type ProjectResponse,
} from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  toast,
} from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { payload } from '@/shared/api/payload'
import { formatDateTime } from '@/shared/format'
import { FileIcon } from '@/shared/ui/icons'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { RequireSession } from '@/features/auth/require-session'
import { useRspdlRuntime } from '@/features/analysis/use-runtime'
import { CreateDocumentDialog } from '@/features/documents/create-document-dialog'

export function ProjectScreen({ projectId }: { projectId: string }) {
  return (
    <AppShell breadcrumb={<Crumb href="/projects">프로젝트</Crumb>}>
      <RequireSession>
        <ProjectDetail projectId={projectId} />
      </RequireSession>
    </AppShell>
  )
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const project = useGetProject<ProjectResponse>(projectId, {
    query: { select: payload },
  })

  if (project.isPending) return <Skeleton className="h-40 w-full" />

  if (project.error !== null || project.data === undefined) {
    return (
      <ErrorState
        title="프로젝트를 불러오지 못했습니다"
        description={errorMessage(project.error)}
        action={
          <Button variant="outline" asChild>
            <Link href="/projects">프로젝트 목록으로</Link>
          </Button>
        }
      />
    )
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {project.data.name}
            {project.data.archived_at === null ? null : (
              <Badge variant="secondary">보관됨</Badge>
            )}
          </h1>
          {project.data.description === null ? null : (
            <p className="mt-1 max-w-prose text-sm text-text-muted">
              {project.data.description}
            </p>
          )}
          <p className="mt-2 text-xs text-text-subtle">
            <span className="font-mono">{project.data.slug}</span> · 새 문서 기본 rspdl{' '}
            {project.data.default_rspdl_version}
          </p>
        </div>
        <div className="flex gap-2">
          {project.data.archived_at === null ? (
            <ArchiveProjectButton project={project.data} />
          ) : null}
          <CreateDocumentDialog
            projectId={projectId}
            trigger={<Button>새 문서</Button>}
          />
        </div>
      </div>

      <DocumentList projectId={projectId} />
    </>
  )
}

function ArchiveProjectButton({ project }: { project: ProjectResponse }) {
  const queryClient = useQueryClient()
  const archive = useArchiveProject()

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={archive.isPending}>
          보관
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            프로젝트 &quot;{project.name}&quot; 을(를) 보관할까요?
          </AlertDialogTitle>
          <AlertDialogDescription>
            보관하면 기본 목록에서 빠집니다. 문서와 이력은 지워지지 않습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              archive.mutate(
                { projectId: project.id },
                {
                  onSuccess: async () => {
                    await queryClient.invalidateQueries()
                    toast.success('프로젝트를 보관했습니다')
                  },
                  onError: (error) => {
                    toast.error('보관하지 못했습니다', {
                      description: errorMessage(error),
                    })
                  },
                },
              )
            }}
          >
            보관
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DocumentList({ projectId }: { projectId: string }) {
  const documents = useListDocuments<DocumentSummaryResponse[]>(projectId, {
    query: { select: payload },
  })
  const runtime = useRspdlRuntime()

  if (documents.isPending) {
    return (
      <ul className="space-y-2">
        {[0, 1, 2].map((index) => (
          <li key={index}>
            <Skeleton className="h-16 w-full" />
          </li>
        ))}
      </ul>
    )
  }

  if (documents.error !== null) {
    return (
      <ErrorState
        title="문서를 불러오지 못했습니다"
        description={errorMessage(documents.error)}
        action={
          <Button variant="outline" onClick={() => void documents.refetch()}>
            다시 시도
          </Button>
        }
      />
    )
  }

  if ((documents.data?.length ?? 0) === 0) {
    return (
      <EmptyState
        icon={<FileIcon />}
        title="아직 문서가 없습니다"
        description="RSPDL 문서를 하나 만들어 제품 의도를 선언해 보세요."
        action={
          <CreateDocumentDialog
            projectId={projectId}
            trigger={<Button>새 문서</Button>}
          />
        }
      />
    )
  }

  return (
    <ul className="space-y-2">
      {documents.data?.map((document) => (
        <li key={document.id}>
          <Link
            href={`/projects/${projectId}/documents/${document.id}`}
            className="block rounded-panel border bg-surface px-4 py-3 transition-colors hover:bg-surface-raised"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-text">{document.title}</span>
              <span className="font-mono text-xs text-text-subtle">
                {document.path}
              </span>
              {/*
                문서가 기억하는 rspdl 버전이 서버 버전과 다르면 그 사실을 목록에서부터
                말한다. 열어 보기 전에 알 수 있어야 어떤 문서부터 볼지 정할 수 있다.
              */}
              {runtime.data !== undefined &&
              runtime.data.rspdl_version !== document.target_rspdl_version ? (
                <Badge variant="outline" className="font-mono text-xs">
                  rspdl {document.target_rspdl_version} ≠ 서버{' '}
                  {runtime.data.rspdl_version}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-text-subtle">
              수정 {formatDateTime(document.updated_at)}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  )
}
