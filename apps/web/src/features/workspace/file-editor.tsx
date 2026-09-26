'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  useCompileTree,
  useListTree,
  useReadTreeFile,
  type TreeCompileResponse,
  type TreeEntryResponse,
  type TreeFileResponse,
} from '@dahaze/api-client'
import { RspdlEditor, type ByteSpan, type RspdlDiagnostic } from '@dahaze/rspdl-editor'
import {
  Button,
  DiagnosticBadge,
  ErrorState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  cn,
} from '@dahaze/ui'

import { errorMessage, isNotFound } from '@/shared/api/errors'
import { parseDiagnostic } from '@/shared/rspdl/diagnostics'
import { renderDiagnosticMessage, renderDiagnosticTitle } from '@/shared/rspdl/diagnostic-messages'
import { LockIcon, SpinnerIcon } from '@/shared/ui/icons'
import { describeHolder } from './tree-model'
import { useTreeActions } from './use-tree-actions'
import { useWorkspaceStore } from './workspace-store'

interface LocatedDiagnostic {
  diagnostic: RspdlDiagnostic
  line: number | null
  column: number | null
}

/**
 * 가운데 에디터. 고른 파일의 작업 트리 원문을 보여주고 직접 고쳐 저장한다.
 *
 * - 저장하지 않은 입력은 `workspace-store` 의 초안에 둔다. 다른 파일을 열었다 돌아와도 남는다.
 * - AI 나 MCP 가 잠근 파일은 읽기 전용이다. 서버도 저장을 409 로 막는다.
 * - 진단은 작업 트리 전체를 컴파일한 결과에서 이 파일 것만 고른다. 진단 위치는 **저장된 원문**
 *   기준이라, 저장하지 않은 입력이 있으면 밑줄을 긋지 않는다 — 다른 텍스트의 바이트 위치를 얹으면
 *   엉뚱한 곳에 그어진다.
 */
export function FileEditor({ projectId, path }: { projectId: string; path: string }) {
  const file = useReadTreeFile<TreeFileResponse>(projectId, { path })
  const tree = useListTree<TreeEntryResponse[]>(projectId)
  const compile = useCompileTree<TreeCompileResponse>(projectId)
  const draft = useWorkspaceStore((state) => state.drafts[path])
  const setDraft = useWorkspaceStore((state) => state.setDraft)
  const dropDraft = useWorkspaceStore((state) => state.dropDraft)
  const actions = useTreeActions(projectId)
  const [revealSpan, setRevealSpan] = useState<ByteSpan | null>(null)

  const lockedBy = tree.data?.find((entry) => entry.path === path)?.locked_by ?? null
  const saved = file.data?.text
  const value = draft ?? saved ?? ''
  const dirty = draft !== undefined && draft !== saved
  const readOnly = lockedBy !== null || file.data?.change === 'delete'

  const diagnostics = useMemo<LocatedDiagnostic[]>(() => {
    if (compile.data === undefined) return []
    const located: LocatedDiagnostic[] = []
    for (const entry of compile.data.diagnostics) {
      if (entry.path !== path) continue
      const diagnostic = parseDiagnostic(entry.diagnostic)
      if (diagnostic === null) continue
      located.push({ diagnostic, line: entry.start?.line ?? null, column: entry.start?.column ?? null })
    }
    return located
  }, [compile.data, path])

  const counts = useMemo(() => {
    const result = { error: 0, warning: 0, info: 0 }
    for (const { diagnostic } of diagnostics) result[diagnostic.severity] += 1
    return result
  }, [diagnostics])

  const save = async () => {
    if (!dirty || readOnly || actions.saving) return
    await actions.save(path, value)
  }

  // ⌘S / Ctrl+S. 브라우저의 "페이지 저장" 을 막고 파일을 저장한다.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 's' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (file.isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  }
  if (file.isError) {
    return (
      <div className="p-6">
        <ErrorState
          title={isNotFound(file.error) ? '파일이 없어요' : '파일을 열지 못했어요'}
          description={
            isNotFound(file.error)
              ? '옮겨졌거나 지워졌을 수 있어요. 왼쪽 목록에서 다시 골라 주세요.'
              : errorMessage(file.error)
          }
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Select value="file">
          <SelectTrigger size="sm" aria-label="보기" className="w-auto gap-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="file">파일</SelectItem>
          </SelectContent>
        </Select>
        <p className="min-w-0 truncate font-mono text-body-sm text-text" title={path}>
          {path}
        </p>
        {dirty ? <span className="shrink-0 text-caption text-text-muted">저장하지 않음</span> : null}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {compile.isFetching ? (
            <SpinnerIcon className="text-text-subtle" aria-label="진단을 다시 읽는 중" />
          ) : null}
          {counts.error > 0 ? <DiagnosticBadge severity="error" count={counts.error} /> : null}
          {counts.warning > 0 ? <DiagnosticBadge severity="warning" count={counts.warning} /> : null}
          {counts.info > 0 ? <DiagnosticBadge severity="info" count={counts.info} /> : null}
          {dirty ? (
            <Button variant="ghost" size="sm" onClick={() => dropDraft(path)}>
              되돌리기
            </Button>
          ) : null}
          <Button
            variant={dirty ? 'weak' : 'secondary'}
            size="sm"
            disabled={!dirty || readOnly || actions.saving}
            onClick={() => void save()}
          >
            {actions.saving ? <SpinnerIcon /> : null}
            저장하기
          </Button>
        </div>
      </header>

      {lockedBy !== null ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b bg-diagnostic-warning-subtle px-4 py-2 text-body-sm text-diagnostic-warning"
        >
          <LockIcon />
          {describeHolder(lockedBy)}이(가) 이 파일을 쓰고 있어요. 작업이 끝날 때까지 읽기 전용이에요.
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        <RspdlEditor
          key={path}
          value={value}
          onChange={readOnly ? undefined : (next) => (next === saved ? dropDraft(path) : setDraft(path, next))}
          readOnly={readOnly}
          diagnostics={dirty ? [] : diagnostics.map((entry) => entry.diagnostic)}
          revealSpan={dirty ? null : revealSpan}
          renderMessage={renderDiagnosticMessage}
          ariaLabel={`${path} 원문`}
          placeholder="RSPDL 원문을 입력하거나 오른쪽 AI 대화에 부탁해 보세요."
          className="h-full"
        />
      </div>

      {diagnostics.length > 0 ? (
        <DiagnosticList
          diagnostics={diagnostics}
          stale={dirty}
          onReveal={(diagnostic) => setRevealSpan({ ...diagnostic.span })}
        />
      ) : null}
    </div>
  )
}

function DiagnosticList({
  diagnostics,
  stale,
  onReveal,
}: {
  diagnostics: readonly LocatedDiagnostic[]
  stale: boolean
  onReveal: (diagnostic: RspdlDiagnostic) => void
}) {
  return (
    <section aria-label="진단" className="max-h-44 shrink-0 overflow-y-auto border-t bg-canvas-subtle">
      {stale ? (
        <p className="px-4 pt-2 text-caption text-text-muted">
          저장한 원문 기준 진단이에요. 저장하면 다시 확인해요.
        </p>
      ) : null}
      <ul className="py-1">
        {diagnostics.map(({ diagnostic, line, column }, index) => (
          <li key={index}>
            <button
              type="button"
              disabled={stale}
              onClick={() => onReveal(diagnostic)}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-1.5 text-left outline-none focus-visible:focus-ring',
                !stale && 'hover:bg-state-hover',
              )}
            >
              <DiagnosticBadge severity={diagnostic.severity} className="mt-px" />
              <span className="min-w-0 flex-1">
                <span className="block text-body-sm font-semibold text-text">
                  {renderDiagnosticTitle(diagnostic)}
                </span>
                <span className="block text-body-sm text-text-muted">{renderDiagnosticMessage(diagnostic)}</span>
              </span>
              {line === null ? null : (
                <span className="shrink-0 font-mono text-caption text-text-subtle tabular-nums">
                  {line}:{column ?? 1}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
