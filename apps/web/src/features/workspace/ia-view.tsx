'use client'

import { useMemo, type ReactNode } from 'react'
import { Button, EmptyState, ErrorState, Skeleton, cn } from '@dahaze/ui'

import { isRspdlPath } from '@/features/wireframe/wireframe-file'
import { errorMessage } from '@/shared/api/errors'
import { FileTextIcon, FlowIcon, HierarchyIcon, WarningIcon } from '@/shared/ui/icons'
import {
  buildIaOutline,
  type IaCategory,
  type IaFile,
  type IaLocation,
  type IaScreen,
} from './ia-outline'
import { useTreeCompilation } from './use-tree-compilation'

/**
 * IA 뷰: 작업 트리를 컴파일한 결과에서 정보구조(분류 → 화면)와 화면 흐름을 계층으로 보여준다.
 *
 * 데이터 출처: 트리 컴파일(`compile_tree`)과 심볼 검색(`search_tree_symbols`)은 IR 을 돌려주지 않고,
 * 검색 결과에는 `parent_id`·`screen_categories` 같은 연결이 없다. 그래서 작업 트리 문서를 읽어
 * `compile_workspace` 에 넘기고(`use-tree-compilation.ts`), 돌아온 `result` 에서 목록 네 개만
 * 읽는다(`ia-outline.ts`).
 * 진단은 만들지 않는다. 읽지 못한 파일은 컴파일러가 준 오류 수만 알린다.
 *
 * 항목을 누르면 그 줄을 "문서" 뷰에서 연다.
 */
export function IaView({
  projectId,
  onOpen,
}: {
  projectId: string
  onOpen: (location: IaLocation) => void
}) {
  const { tree, paths, readError, compile } = useTreeCompilation(projectId)

  const outline = useMemo(
    () =>
      compile.data === undefined
        ? null
        : buildIaOutline(compile.data.response.result, compile.data.texts),
    [compile.data],
  )

  if (tree.isError || readError !== null) {
    return (
      <Centered>
        <ErrorState
          title="작업 트리를 읽지 못했어요"
          description={errorMessage(tree.error ?? readError)}
          action={
            <Button variant="secondary" size="sm" onClick={() => void tree.refetch()}>
              다시 불러오기
            </Button>
          }
        />
      </Centered>
    )
  }
  if (tree.isSuccess && !paths.some(isRspdlPath)) {
    return (
      <Centered>
        <EmptyState
          icon={<HierarchyIcon className="size-6" />}
          title="아직 파일이 없어요"
          description="문서를 만들면 정보구조와 화면을 여기서 계층으로 볼 수 있어요."
        />
      </Centered>
    )
  }
  if (compile.isError) {
    return (
      <Centered>
        <ErrorState
          title="컴파일하지 못했어요"
          description={errorMessage(compile.error)}
          action={
            <Button variant="secondary" size="sm" onClick={() => void compile.refetch()}>
              다시 시도
            </Button>
          }
        />
      </Centered>
    )
  }
  if (outline === null || compile.data === undefined) {
    return (
      <div className="space-y-2 p-6" aria-busy>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-5 w-52" />
      </div>
    )
  }
  if (!outline.recognized) {
    return (
      <Centered>
        <ErrorState
          title="컴파일 결과의 모양을 알아보지 못했어요"
          description={`rspdl ${compile.data.response.rspdl_version} (wire ${compile.data.response.wire_schema_version}) 결과에 files 목록이 없어요.`}
        />
      </Centered>
    )
  }

  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-y-auto transition-opacity duration-150',
        compile.isPlaceholderData && 'opacity-60',
      )}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-5">
        {outline.files.length === 0 ? (
          <EmptyState
            icon={<HierarchyIcon className="size-6" />}
            title="정보구조와 화면이 없어요"
            description="문서 머리말에 '정보구조:'와 '화면:'을 쓰면 여기에 계층으로 보여요."
          />
        ) : (
          outline.files.map((file) => <FileOutline key={file.path} file={file} onOpen={onOpen} />)
        )}

        {outline.unparsed.length > 0 ? (
          <section aria-labelledby="ia-unparsed-heading" className="rounded-panel border px-4 py-3">
            <h2
              id="ia-unparsed-heading"
              className="flex items-center gap-1.5 text-label-sm text-diagnostic-warning"
            >
              <WarningIcon className="size-4" />
              읽지 못한 파일
            </h2>
            <p className="mt-1 text-caption text-text-muted">
              오류가 있으면 컴파일러가 그 파일의 구조를 내보내지 않아요. 이 파일들의 화면은 위 목록에 없어요.
            </p>
            <ul className="mt-2">
              {outline.unparsed.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => onOpen({ path: file.path, line: 1 })}
                    className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-body-sm outline-none hover:bg-state-hover focus-visible:focus-ring"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                    <span className="shrink-0 text-caption text-text-subtle tabular-nums">
                      오류 {file.errorCount.toLocaleString('ko-KR')}개
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="text-caption text-text-subtle">
          rspdl {compile.data.response.rspdl_version} 컴파일 결과 · 저장한 원문 기준
        </p>
      </div>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-8">{children}</div>
}

function FileOutline({ file, onOpen }: { file: IaFile; onOpen: (location: IaLocation) => void }) {
  return (
    <section aria-label={file.path}>
      <button
        type="button"
        onClick={() => onOpen({ path: file.path, line: 1 })}
        className="mb-1 flex items-center gap-1.5 rounded-sm px-1 font-mono text-caption text-text-muted outline-none hover:text-text focus-visible:focus-ring"
      >
        <FileTextIcon className="size-3.5" />
        {file.path}
      </button>
      <ul role="list">
        {file.categories.map((category) => (
          <CategoryNode key={category.key} category={category} depth={0} onOpen={onOpen} />
        ))}
      </ul>
      {file.uncategorized.length > 0 ? (
        <div className="mt-2">
          <p className="px-1 py-1 text-caption text-text-subtle">정보구조에 없는 화면</p>
          <ul role="list">
            {file.uncategorized.map((screen) => (
              <ScreenNode key={screen.key} screen={screen} depth={0} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function CategoryNode({
  category,
  depth,
  onOpen,
}: {
  category: IaCategory
  depth: number
  onOpen: (location: IaLocation) => void
}) {
  return (
    <li>
      <Row
        depth={depth}
        icon={<HierarchyIcon className="size-4 text-text-subtle" />}
        location={category.location}
        onOpen={onOpen}
        label={<span className="font-semibold text-text">{category.name}</span>}
        detail={category.id}
      />
      {category.categories.length > 0 || category.screens.length > 0 ? (
        <ul role="list">
          {category.categories.map((child) => (
            <CategoryNode key={child.key} category={child} depth={depth + 1} onOpen={onOpen} />
          ))}
          {category.screens.map((screen) => (
            <ScreenNode key={screen.key} screen={screen} depth={depth + 1} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function ScreenNode({
  screen,
  depth,
  onOpen,
}: {
  screen: IaScreen
  depth: number
  onOpen: (location: IaLocation) => void
}) {
  return (
    <li>
      <Row
        depth={depth}
        icon={<FileTextIcon className="size-4 text-accent-text" />}
        location={screen.location}
        onOpen={onOpen}
        label={<span className="text-text">{screen.name}</span>}
        detail={screen.id}
      />
      {screen.paths.length > 0 ? (
        <ul role="list" aria-label={`${screen.name}에서 가는 화면`}>
          {screen.paths.map((path) => (
            <li key={path.key}>
              <Row
                depth={depth + 1}
                icon={<FlowIcon className="size-3.5 text-text-subtle" />}
                location={path.location}
                onOpen={onOpen}
                label={
                  <span className="text-text-muted">
                    <span className="sr-only">이동: </span>
                    {path.targetName ?? path.targetId}
                    {path.label !== null ? <span className="text-text-subtle"> · {path.label}</span> : null}
                  </span>
                }
                detail={path.elementId === null ? null : `버튼 ${path.elementId}`}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function Row({
  depth,
  icon,
  label,
  detail,
  location,
  onOpen,
}: {
  depth: number
  icon: ReactNode
  label: ReactNode
  detail: string | null
  location: IaLocation | null
  onOpen: (location: IaLocation) => void
}) {
  const content = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate text-body-sm">{label}</span>
      {detail !== null ? (
        <span className="hidden shrink-0 truncate font-mono text-caption text-text-subtle sm:inline">
          {detail}
        </span>
      ) : null}
      {location !== null ? (
        <span className="shrink-0 font-mono text-caption text-text-subtle tabular-nums">
          :{location.line}
        </span>
      ) : null}
    </>
  )
  const className =
    'flex h-8 w-full items-center gap-2 rounded-sm pr-2 text-left outline-none'
  const style = { paddingLeft: `${0.25 + depth * 1.25}rem` }

  if (location === null) {
    return (
      <div className={className} style={style}>
        {content}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(location)}
      className={cn(className, 'hover:bg-state-hover focus-visible:focus-ring')}
      style={style}
    >
      {content}
    </button>
  )
}
