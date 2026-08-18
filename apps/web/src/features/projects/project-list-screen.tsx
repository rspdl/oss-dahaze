'use client'

import Link from 'next/link'
import { useListProjects, type ProjectResponse } from '@dahaze/api-client'
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/format'
import { FolderIcon } from '@/shared/ui/icons'
import { AppShell } from '@/shared/ui/app-shell'
import { RequireSession } from '@/features/auth/require-session'
import { CreateProjectDialog } from './create-project-dialog'

export function ProjectListScreen() {
  return (
    <AppShell>
      <RequireSession>
        <ProjectList />
      </RequireSession>
    </AppShell>
  )
}

function ProjectList() {
  const query = useListProjects<ProjectResponse[]>(undefined, {
      })

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">프로젝트</h1>
          <p className="mt-1 text-sm text-text-muted">
            RSPDL 문서를 프로젝트 단위로 모읍니다.
          </p>
        </div>
        <CreateProjectDialog trigger={<Button>새 프로젝트</Button>} />
      </div>

      {query.isPending ? (
        <ul className="space-y-2">
          {[0, 1, 2].map((index) => (
            <li key={index}>
              <Skeleton className="h-20 w-full" />
            </li>
          ))}
        </ul>
      ) : query.error !== null ? (
        <ErrorState
          title="프로젝트를 불러오지 못했습니다"
          description={errorMessage(query.error)}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              다시 시도
            </Button>
          }
        />
      ) : (query.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<FolderIcon />}
          title="아직 프로젝트가 없습니다"
          description="프로젝트를 하나 만들고 RSPDL 문서를 쓰기 시작하세요."
          action={<CreateProjectDialog trigger={<Button>새 프로젝트</Button>} />}
        />
      ) : (
        <ul className="space-y-2">
          {query.data?.map((project) => (
            <li key={project.id}>
              <ProjectRow project={project} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ProjectRow({ project }: { project: ProjectResponse }) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="block rounded-panel border bg-surface px-4 py-3 transition-colors hover:bg-surface-raised"
    >
      <div className="flex items-center gap-2">
        <span className="font-medium text-text">{project.name}</span>
        <span className="font-mono text-xs text-text-subtle">{project.slug}</span>
        {project.archived_at === null ? null : (
          <Badge variant="secondary">보관됨</Badge>
        )}
      </div>
      {project.description === null ? null : (
        <p className="mt-1 line-clamp-2 text-sm text-text-muted">
          {project.description}
        </p>
      )}
      <p className="mt-2 text-xs text-text-subtle">
        기본 rspdl {project.default_rspdl_version} · 수정{' '}
        {formatDateTime(project.updated_at)}
      </p>
    </Link>
  )
}
