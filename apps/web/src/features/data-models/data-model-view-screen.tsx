'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  useCompileProject,
  useGetProject,
  type CompiledDocumentRef,
  type ProjectCompileResponse,
  type ProjectResponse,
} from '@dahaze/api-client'
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton, cn } from '@dahaze/ui'

import { RequireSession } from '@/features/auth/require-session'
import { documentHref, viewHref, DEFAULT_PROJECT_VIEW } from '@/features/navigation/views'
import { errorMessage } from '@/shared/api/errors'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { FileIcon, TableIcon } from '@/shared/ui/icons'
import { ErdDiagram } from './erd-diagram'
import {
  collectDataModels,
  type DataModelEntry,
  type DataModelField,
} from './data-models'

/** 프로젝트 전체에서 컴파일된 모델을 읽는 화면. */
export function DataModelViewScreen({ projectId }: { projectId: string }) {
  return (
    <AppShell breadcrumb={<Crumb>데이터 모델</Crumb>} fullBleed>
      <RequireSession>
        <DataModelView projectId={projectId} />
      </RequireSession>
    </AppShell>
  )
}

function DataModelView({ projectId }: { projectId: string }) {
  const project = useGetProject<ProjectResponse>(projectId, {})
  const compilation = useCompileProject<ProjectCompileResponse>(projectId, {
    query: { staleTime: 10_000 },
  })
  const [query, setQuery] = useState('')
  const [requiredOnly, setRequiredOnly] = useState(false)
  const collected = useMemo(
    () => collectDataModels(compilation.data),
    [compilation.data],
  )
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ko')

    return collected.models
      .map((model) => {
        const fields = model.fields.filter((field) => {
          if (requiredOnly && !field.required) return false
          if (normalizedQuery === '') return true
          return [model.name, model.id, field.name, field.id, field.typeKind]
            .some((value) => value.toLocaleLowerCase('ko').includes(normalizedQuery))
        })
        const modelMatches = [model.name, model.id]
          .some((value) => value.toLocaleLowerCase('ko').includes(normalizedQuery))
        return { ...model, fields, matches: modelMatches || fields.length > 0 }
      })
      .filter((model) => model.matches)
  }, [collected.models, query, requiredOnly])

  /* 필터로 선택한 항목이 사라지면 첫 항목을 표시한다. 상태를 effect 로 다시 쓰지 않아
     검색할 때마다 한 번 더 렌더링하지 않고, 필터를 풀면 사람이 고른 항목도 남아 있다. */
  const selectedModel =
    filteredModels.find((model) => model.key === selectedKey) ?? filteredModels[0] ?? null
  const selectedField =
    selectedModel?.fields.find((field) => field.id === selectedFieldId) ??
    selectedModel?.fields[0] ??
    null
  const documentsByPath = useMemo(
    () => new Map((compilation.data?.documents ?? []).map((document) => [document.path, document])),
    [compilation.data?.documents],
  )
  const fieldCount = collected.models.reduce((total, model) => total + model.fields.length, 0)

  if (project.isPending || compilation.isPending) return <DataModelLoading />

  if (project.error !== null || project.data === undefined) {
    return (
      <ErrorState
        title="프로젝트를 불러오지 못했습니다"
        description={errorMessage(project.error)}
        action={<Button variant="outline" asChild><Link href="/projects">프로젝트 목록으로</Link></Button>}
      />
    )
  }

  if (compilation.error !== null) {
    return (
      <ErrorState
        title="데이터 모델을 불러오지 못했습니다"
        description={errorMessage(compilation.error)}
        action={<Button variant="outline" onClick={() => void compilation.refetch()}>다시 시도</Button>}
      />
    )
  }

  if (!collected.recognized) {
    return (
      <ErrorState
        title="이 컴파일 결과를 읽지 못했습니다"
        description={`서버의 rspdl ${compilation.data?.rspdl_version ?? ''} 이 이 화면이 아는 것과 다른 모양을 돌려주었습니다. 문서 편집 화면에서는 컴파일러 진단을 그대로 확인할 수 있습니다.`}
        action={<Button variant="outline" asChild><Link href={viewHref(projectId, DEFAULT_PROJECT_VIEW)}>문서 편집으로</Link></Button>}
      />
    )
  }

  if (!collected.compiled) {
    return (
      <EmptyState
        icon={<TableIcon />}
        title="아직 문서가 없습니다"
        description="RSPDL 문서를 작성하면 컴파일된 데이터 모델이 이곳에 나타납니다."
        action={<Button asChild><Link href={viewHref(projectId, DEFAULT_PROJECT_VIEW)}>문서 편집으로</Link></Button>}
      />
    )
  }

  if (collected.models.length === 0) {
    return (
      <EmptyState
        icon={<TableIcon />}
        title="선언된 데이터 모델이 없습니다"
        description="모델과 필드를 RSPDL 문서에 선언하면, 컴파일 결과를 여기에서 비교할 수 있습니다."
        action={<Button variant="outline" asChild><Link href={viewHref(projectId, DEFAULT_PROJECT_VIEW)}>문서 편집으로</Link></Button>}
      />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col">
      <header className="border-b pb-5 md:pb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-[0.14em] text-text-subtle">PROJECT SCHEMA</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-text">데이터 모델</h1>
            <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-text-muted">
              {project.data.name}의 저장된 문서를 한 번에 컴파일해, 엔터티와 선언된 관계를 원본 결과 그대로 그렸습니다.
            </p>
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-1.5 border-t pt-3 text-xs text-text-subtle md:border-t-0 md:pt-0">
            <div><dt className="sr-only">모델</dt><dd><span className="font-mono text-text">{collected.models.length}</span> 모델</dd></div>
            <div><dt className="sr-only">필드</dt><dd><span className="font-mono text-text">{fieldCount}</span> 필드</dd></div>
            <div><dt className="sr-only">관계</dt><dd><span className="font-mono text-text">{collected.relations.length}</span> 관계</dd></div>
            <div><dt className="sr-only">RSPDL 버전</dt><dd className="font-mono">rspdl {compilation.data?.rspdl_version}</dd></div>
          </dl>
        </div>
      </header>

      <section aria-label="데이터 모델 탐색" className="flex flex-col gap-4 py-5 md:py-6">
        <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="w-full sm:max-w-sm">
            <span className="sr-only">모델 또는 필드 검색</span>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="모델, 필드 또는 타입 검색"
              type="search"
            />
          </label>
          <button
            type="button"
            aria-pressed={requiredOnly}
            onClick={() => setRequiredOnly((value) => !value)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center justify-center rounded-control border px-3 text-sm font-medium transition-[color,background-color,transform] duration-200 ease-out-expo active:translate-y-px',
              requiredOnly
                ? 'border-accent bg-accent-subtle text-text'
                : 'text-text-muted hover:bg-surface-raised hover:text-text',
            )}
          >
            필수 필드만
          </button>
        </div>

        {filteredModels.length === 0 ? (
          <EmptyState
            icon={<TableIcon />}
            title="조건에 맞는 모델이 없습니다"
            description={`선언된 모델 ${collected.models.length}개 안에서 현재 검색 조건과 일치하는 모델 또는 필드를 찾지 못했습니다.`}
            action={<Button variant="outline" onClick={() => { setQuery(''); setRequiredOnly(false) }}>필터 지우기</Button>}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <ErdDiagram
              models={filteredModels}
              relations={collected.relations}
              selectedKey={selectedModel?.key ?? null}
              onSelectModel={(key) => {
                setSelectedKey(key)
                setSelectedFieldId(null)
              }}
            />
            {selectedModel === null ? null : (
              <ModelDetail
                projectId={projectId}
                model={selectedModel}
                selectedField={selectedField}
                selectedFieldId={selectedField?.id ?? null}
                onSelectField={setSelectedFieldId}
                document={documentsByPath.get(selectedModel.path)}
              />
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function ModelDetail({
  projectId,
  model,
  selectedField,
  selectedFieldId,
  onSelectField,
  document,
}: {
  projectId: string
  model: DataModelEntry
  selectedField: DataModelField | null
  selectedFieldId: string | null
  onSelectField: (fieldId: string) => void
  document: CompiledDocumentRef | undefined
}) {
  return (
    <section aria-label={`${model.name} 모델 상세`} className="min-w-0 bg-surface">
      <header className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between md:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold tracking-tight">{model.name}</h2>
            <Badge variant="outline" className="font-mono text-xs">{model.fields.length} fields</Badge>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-text-subtle">{model.id}</p>
        </div>
        {document === undefined ? (
          <span className="font-mono text-xs text-text-subtle">{model.path}</span>
        ) : (
          <Button variant="ghost" size="sm" className="-ml-2 w-fit text-text-muted" asChild>
            <Link href={documentHref(projectId, document.id)}><FileIcon className="size-4" />{document.title}</Link>
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(15rem,0.8fr)]">
        <div className="min-w-0 border-b xl:border-r xl:border-b-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[33rem] text-sm">
              <thead className="border-b bg-surface-raised/55 text-left text-xs text-text-subtle">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium md:px-6">필드</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">타입</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">입력</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {model.fields.map((field) => {
                  const active = field.id === selectedFieldId
                  return (
                    <tr key={field.id} className={cn('transition-colors duration-200 ease-out-expo', active && 'bg-accent-subtle/55')}>
                      <td className="p-0">
                        <button
                          type="button"
                          onClick={() => onSelectField(field.id)}
                          aria-pressed={active}
                          className="flex w-full flex-col gap-0.5 px-4 py-3 text-left active:translate-y-px md:px-6"
                        >
                          <span className="font-medium text-text">{field.name}</span>
                          <span className="font-mono text-xs text-text-subtle">{field.id}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3"><TypeBadge typeKind={field.typeKind} /></td>
                      <td className="px-4 py-3 text-xs text-text-muted">{field.required ? '필수' : '선택'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <FieldInspector field={selectedField} />
      </div>
    </section>
  )
}

function FieldInspector({ field }: { field: DataModelField | null }) {
  if (field === null) {
    return <div className="px-4 py-6 text-sm text-text-muted md:px-6">필드를 선택하면 상세를 봅니다.</div>
  }

  return (
    <aside aria-label={`${field.name} 필드 상세`} className="bg-surface-raised/35 px-4 py-5 md:px-6">
      <p className="text-xs font-medium tracking-[0.1em] text-text-subtle">FIELD DETAIL</p>
      <h3 className="mt-2 text-base font-semibold tracking-tight">{field.name}</h3>
      <p className="mt-1 break-all font-mono text-xs text-text-subtle">{field.id}</p>
      <dl className="mt-5 divide-y border-y text-sm">
        <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-text-muted">타입</dt><dd><TypeBadge typeKind={field.typeKind} /></dd></div>
        <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-text-muted">입력</dt><dd className="font-medium">{field.required ? '필수' : '선택'}</dd></div>
      </dl>
      {field.enumVariants === null ? null : (
        <div className="mt-5">
          <p className="text-xs font-medium text-text-muted">허용 값</p>
          {field.enumVariants.length === 0 ? (
            <p className="mt-2 text-sm text-text-subtle">컴파일 결과에 enum 값이 없습니다.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {field.enumVariants.map((variant) => <li key={variant}><Badge variant="secondary">{variant}</Badge></li>)}
            </ul>
          )}
        </div>
      )}
    </aside>
  )
}

function TypeBadge({ typeKind }: { typeKind: string }) {
  return <Badge variant="outline" className="font-mono text-xs text-text-muted">{typeKind}</Badge>
}

function DataModelLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
      <div className="border-b pb-6"><Skeleton className="h-3 w-28" /><Skeleton className="mt-3 h-8 w-40" /><Skeleton className="mt-3 h-4 w-[min(32rem,100%)]" /></div>
      <div className="flex gap-3 border-b pb-4"><Skeleton className="h-9 w-72" /><Skeleton className="ml-auto h-9 w-28" /></div>
      <div className="grid grid-cols-1 border-y lg:grid-cols-[minmax(15rem,0.75fr)_minmax(0,2fr)]"><div className="space-y-4 border-b p-4 lg:border-r lg:border-b-0">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-12 w-full" />)}</div><div className="p-6"><Skeleton className="h-6 w-48" /><Skeleton className="mt-7 h-52 w-full" /></div></div>
    </div>
  )
}
