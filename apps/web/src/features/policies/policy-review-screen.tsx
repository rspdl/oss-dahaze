'use client'

import Link from 'next/link'
import { useEffect, useMemo } from 'react'
import {
  useCompileProject,
  useGetProject,
  type CompiledDocumentRef,
  type ProjectCompileResponse,
  type ProjectResponse,
} from '@dahaze/api-client'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import {
  collectDiagnosticsFromResult,
  countBySeverity,
} from '@/shared/rspdl/analysis'
import {
  collectPolicies,
  filterFieldGroups,
  filterPolicies,
} from '@/shared/rspdl/policies'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { ShieldIcon, TableIcon } from '@/shared/ui/icons'
import { RequireSession } from '@/features/auth/require-session'
import { DEFAULT_PROJECT_VIEW, viewHref } from '@/features/navigation/views'
import { PolicyFields } from './policy-fields'
import { usePolicyFilterStore } from './policy-filter-store'
import { PolicyFilters } from './policy-filters'
import { PolicyMatrix } from './policy-matrix'

/**
 * 정책 검토 뷰.
 *
 * 단위가 문서가 아니라 **프로젝트**다. 문서 하나만 보면 정책이 문장 사이에 흩어져 있어
 * 서로 비교가 되지 않는데, 비교되지 않는 정책은 구현 전에 문제를 드러내지 못한다.
 * 그래서 프로젝트 전체를 한 번에 컴파일해 (`GET /api/projects/{id}/compile`) 그 결과만
 * 다르게 배열한다 — 새로 해석하지 않는다.
 */
export function PolicyReviewScreen({ projectId }: { projectId: string }) {
  return (
    <AppShell breadcrumb={<Crumb>정책 검토</Crumb>}>
      <RequireSession>
        <PolicyReview projectId={projectId} />
      </RequireSession>
    </AppShell>
  )
}

function PolicyReview({ projectId }: { projectId: string }) {
  const project = useGetProject<ProjectResponse>(projectId, {})
  const selection = usePolicyFilterStore((state) => state.selection)
  const groupBy = usePolicyFilterStore((state) => state.groupBy)
  const enter = usePolicyFilterStore((state) => state.enter)
  const clearAll = usePolicyFilterStore((state) => state.clearAll)

  /* 다른 프로젝트의 선택을 들고 오면 아무 줄과도 맞지 않아 "정책이 없다" 로 보인다. */
  useEffect(() => enter(projectId), [enter, projectId])
  const compilation = useCompileProject<ProjectCompileResponse>(projectId, {
    // 컴파일은 저장된 텍스트에서 나온다. 편집기에서 저장하면 이 뷰도 다시 물어야 한다.
    query: { staleTime: 10_000 },
  })

  const documentsByPath = useMemo(() => {
    const map = new Map<string, CompiledDocumentRef>()
    for (const document of compilation.data?.documents ?? []) {
      map.set(document.path, document)
    }
    return map
  }, [compilation.data])

  const policies = useMemo(
    () => collectPolicies(compilation.data),
    [compilation.data],
  )

  /*
    거르는 것은 **보이는 것**뿐이다. 정책은 컴파일 결과에서 전부 들고 있고 화면에서만
    줄인다 — 두 탭이 같은 줄 집합을 보게 해야 탭을 옮겼을 때 걸러낸 것이 되살아나지 않는다.
  */
  const visibleRows = useMemo(
    () => filterPolicies(policies.rows, selection),
    [policies.rows, selection],
  )
  const visibleFields = useMemo(
    () => filterFieldGroups(policies.fields, visibleRows),
    [policies.fields, visibleRows],
  )

  /*
    진단은 여기서도 컴파일러가 준 그대로 센다. 정책 표가 비어 보이는 이유가 "정책이 없다"
    인지 "그 문서가 컴파일되지 않았다" 인지는 사람이 알아야 한다.
  */
  const diagnostics = useMemo(
    () =>
      countBySeverity(
        collectDiagnosticsFromResult(compilation.data?.result).diagnostics,
      ),
    [compilation.data],
  )

  if (compilation.isPending || project.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    )
  }

  if (compilation.error !== null) {
    return (
      <ErrorState
        title="정책을 불러오지 못했습니다"
        description={errorMessage(compilation.error)}
        action={
          <Button variant="outline" onClick={() => void compilation.refetch()}>
            다시 시도
          </Button>
        }
      />
    )
  }

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">정책 검토</h1>
        <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-text-muted">
          {project.data?.name ?? '이 프로젝트'} 의 문서 전부를 컴파일해, 선언된 정책을
          한자리에 모았습니다. 표시된 것은 전부 컴파일러가 산출한 값입니다.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
          <span className="text-text-subtle">
            문서 {compilation.data?.documents.length ?? 0}개 · 정책{' '}
            {policies.rows.length}건
          </span>
          {diagnostics.error > 0 ? (
            <Badge
              variant="outline"
              className="border-diagnostic-error/40 text-diagnostic-error"
            >
              진단 오류 {diagnostics.error}건
            </Badge>
          ) : null}
          {diagnostics.warning > 0 ? (
            <Badge
              variant="outline"
              className="border-diagnostic-warning/40 text-diagnostic-warning"
            >
              진단 경고 {diagnostics.warning}건
            </Badge>
          ) : null}
          <span className="ml-auto font-mono text-text-subtle">
            rspdl {compilation.data?.rspdl_version}
          </span>
        </div>
      </header>

      {!policies.recognized ? (
        /*
          모르는 모양을 만나면 "정책 0건" 이라고 말하지 않는다. 그건 거짓이고, 사용자가
          정책을 지웠다고 착각하게 만든다.
        */
        <ErrorState
          title="이 컴파일 결과를 읽지 못했습니다"
          description={`서버의 rspdl ${compilation.data?.rspdl_version ?? ''} 이 이 화면이 아는 것과 다른 모양을 돌려주었습니다. 문서 편집 화면에서는 진단을 그대로 볼 수 있습니다.`}
          action={
            <Button variant="outline" asChild>
              <Link href={viewHref(projectId, DEFAULT_PROJECT_VIEW)}>문서 편집으로</Link>
            </Button>
          }
        />
      ) : !policies.compiled ? (
        <EmptyState
          icon={<ShieldIcon />}
          title="아직 문서가 없습니다"
          description="RSPDL 문서를 하나 쓰면 그 안에 선언한 정책이 여기 모입니다."
          action={
            <Button asChild>
              <Link href={viewHref(projectId, DEFAULT_PROJECT_VIEW)}>문서 편집으로</Link>
            </Button>
          }
        />
      ) : policies.rows.length === 0 ? (
        <EmptyState
          icon={<ShieldIcon />}
          title="선언된 정책이 없습니다"
          description={
            diagnostics.error > 0
              ? '진단 오류가 있는 문서는 컴파일되지 않아 정책도 나오지 않습니다. 문서 편집 화면에서 진단을 먼저 확인하세요.'
              : '누가 무엇을 할 수 있는지를 문서에 쓰면 여기 모입니다. 역할과 행동을 선언한 뒤 `역할`은 `모델`의 `필드`를 `행동`할 수 있다 로 씁니다.'
          }
          action={
            <Button variant="outline" asChild>
              <Link href={viewHref(projectId, DEFAULT_PROJECT_VIEW)}>문서 편집으로</Link>
            </Button>
          }
        />
      ) : (
        <>
          <PolicyFilters
            rows={policies.rows}
            visibleCount={visibleRows.length}
            documentsByPath={documentsByPath}
          />

          <Tabs defaultValue="matrix">
            <TabsList className="mb-5">
              <TabsTrigger value="matrix" className="gap-1.5">
                <TableIcon className="size-4" />
                매트릭스
              </TabsTrigger>
              <TabsTrigger value="fields" className="gap-1.5">
                <ShieldIcon className="size-4" />
                필드 중심
              </TabsTrigger>
            </TabsList>

            {visibleRows.length === 0 ? (
              /* 필터가 다 걸러낸 경우. "정책이 없다" 와 다른 말을 해야 한다. */
              <EmptyState
                icon={<ShieldIcon />}
                title="필터에 걸리는 정책이 없습니다"
                description={`선언된 정책 ${policies.rows.length}건 중 지금 조건에 맞는 것이 없습니다.`}
                action={
                  <Button variant="outline" onClick={clearAll}>
                    필터 지우기
                  </Button>
                }
              />
            ) : (
              <>
                <TabsContent value="matrix">
                  <PolicyMatrix
                    projectId={projectId}
                    rows={visibleRows}
                    allRows={policies.rows}
                    groupBy={groupBy}
                    documentsByPath={documentsByPath}
                  />
                </TabsContent>

                <TabsContent value="fields">
                  <PolicyFields
                    projectId={projectId}
                    groups={visibleFields}
                    documentsByPath={documentsByPath}
                  />
                </TabsContent>
              </>
            )}
          </Tabs>
        </>
      )}
    </>
  )
}
