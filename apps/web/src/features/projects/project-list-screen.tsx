'use client'

import Link from 'next/link'
import { useListProjects, type ProjectResponse } from '@dahaze/api-client'
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/format'
import { ChevronRightIcon, FolderIcon } from '@/shared/ui/icons'
import { AppShell } from '@/shared/ui/app-shell'
import { RequireSession } from '@/features/auth/require-session'
import { CreateProjectDialog } from './create-project-dialog'

export function ProjectListScreen() {
  return (
    <AppShell
      actions={
        <CreateProjectDialog trigger={<Button size="sm">새 프로젝트</Button>} />
      }
    >
      <RequireSession>
        <ProjectList />
      </RequireSession>
    </AppShell>
  )
}

function ProjectList() {
  const query = useListProjects<ProjectResponse[]>(undefined, {})

  return (
    <>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">프로젝트</h1>
        <p className="mt-1.5 text-sm text-text-muted">
          RSPDL 문서를 프로젝트 단위로 모읍니다.
        </p>
      </header>

      {query.isPending ? (
        <ul className="divide-y border-y" aria-label="불러오는 중">
          {[0, 1, 2].map((index) => (
            <li key={index} className="flex flex-col gap-2 py-4">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-4 w-80" />
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
        /*
          카드로 감싸지 않는다. 목록의 항목들은 서로 같은 층에 있고, 상자가 하나씩 붙으면
          층이 있다고 말하는 셈이 된다. 1px 선이면 경계는 충분하다.
        */
        <ul className="divide-y border-y">
          {query.data?.map((project, index) => (
            <li
              key={project.id}
              className="animate-rise"
              style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
            >
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
      className="group flex items-start gap-4 py-4 transition-colors duration-200 ease-out-expo hover:bg-surface-raised"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-text">{project.name}</span>
          <span className="font-mono text-xs text-text-subtle">{project.slug}</span>
          {project.archived_at === null ? null : (
            <Badge variant="secondary">보관됨</Badge>
          )}
        </div>
        {project.description === null ? null : (
          <p className="mt-1 line-clamp-2 max-w-[65ch] text-sm text-text-muted">
            {project.description}
          </p>
        )}
        <p className="mt-2 text-xs text-text-subtle">
          기본 rspdl{' '}
          <span className="font-mono">{project.default_rspdl_version}</span> · 수정{' '}
          {formatDateTime(project.updated_at)}
        </p>
      </div>

      {/*
        줄 전체가 링크라는 사실은 hover 색만으로는 잘 읽히지 않는다. 화살표가 오른쪽으로
        한 걸음 나가면 "여기를 누르면 들어간다" 가 손보다 먼저 읽힌다.
      */}
      <ChevronRightIcon
        aria-hidden
        className="mt-1 size-4 shrink-0 text-text-subtle transition-transform duration-200 ease-out-expo group-hover:translate-x-0.5"
      />
    </Link>
  )
}
