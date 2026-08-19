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
import { formatDateTime } from '@/shared/format'
import { ChevronRightIcon, FileIcon } from '@/shared/ui/icons'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { RequireSession } from '@/features/auth/require-session'
import { useRspdlRuntime } from '@/features/analysis/use-runtime'
import { CreateDocumentDialog } from '@/features/documents/create-document-dialog'

export function ProjectScreen({ projectId }: { projectId: string }) {
  return (
    <AppShell
      breadcrumb={<Crumb href="/projects">프로젝트</Crumb>}
      actions={
        <CreateDocumentDialog
          projectId={projectId}
          trigger={<Button size="sm">새 문서</Button>}
        />
      }
    >
      <RequireSession>
        <ProjectDetail projectId={projectId} />
      </RequireSession>
    </AppShell>
  )
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const project = useGetProject<ProjectResponse>(projectId, {})

  if (project.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    )
  }

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
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              {project.data.name}
              {project.data.archived_at === null ? null : (
                <Badge variant="secondary">보관됨</Badge>
              )}
            </h1>
            {project.data.description === null ? null : (
              <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-text-muted">
                {project.data.description}
              </p>
            )}
          </div>

          {project.data.archived_at === null ? (
            <ArchiveProjectButton project={project.data} />
          ) : null}
        </div>

        {/*
          슬러그와 기본 버전은 자주 보는 값이 아니지만 필요할 때 반드시 있어야 하는 값이다.
          제목 옆에 붙이면 제목을 읽는 데 방해가 되므로 아래에 얇은 줄로 따로 둔다.
        */}
        <dl className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-1 border-t pt-3 text-xs text-text-subtle">
          <div className="flex items-center gap-1.5">
            <dt>슬러그</dt>
            <dd className="font-mono text-text-muted">{project.data.slug}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>새 문서 기본</dt>
            <dd className="font-mono text-text-muted">
              rspdl {project.data.default_rspdl_version}
            </dd>
          </div>
        </dl>
      </header>

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
        <Button variant="outline" size="sm" disabled={archive.isPending}>
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
  const documents = useListDocuments<DocumentSummaryResponse[]>(projectId, {})
  const runtime = useRspdlRuntime()

  if (documents.isPending) {
    return (
      <ul className="divide-y border-y" aria-label="불러오는 중">
        {[0, 1, 2].map((index) => (
          <li key={index} className="flex flex-col gap-2 py-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3.5 w-64" />
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
    <ul className="divide-y border-y">
      {documents.data?.map((document, index) => (
        <li
          key={document.id}
          className="animate-rise"
          style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
        >
          <Link
            href={`/projects/${projectId}/documents/${document.id}`}
            className="group flex items-start gap-4 py-4 transition-colors duration-200 ease-out-expo hover:bg-surface-raised"
          >
            <div className="min-w-0 flex-1">
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
            </div>

            <ChevronRightIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-text-subtle transition-transform duration-200 ease-out-expo group-hover:translate-x-0.5"
            />
          </Link>
        </li>
      ))}
    </ul>
  )
}
