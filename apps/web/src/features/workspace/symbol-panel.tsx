'use client'

import type { ReactNode } from 'react'
import {
  useFetchTreeSymbol,
  useSearchTreeSymbols,
  type LinkedSymbolResponse,
  type SymbolFetchResponse,
  type SymbolMatchResponse,
  type SymbolSearchResponse,
} from '@dahaze/api-client'
import { Button, Input, Skeleton } from '@dahaze/ui'

import { errorMessage, isNotFound } from '@/shared/api/errors'
import { useDebouncedValue } from '@/shared/use-debounced-value'
import { ChevronRightIcon, SearchIcon } from '@/shared/ui/icons'
import { useWorkspaceStore } from './workspace-store'

interface Selected {
  id: string
  ownerId: string | null
}

/**
 * 심볼 찾기와 연결. 작업 트리 전체를 컴파일한 IR 에서 심볼을 찾고(search), 고른 심볼을
 * 가리키는 것과 그 심볼이 가리키는 것을 보여준다(fetch).
 *
 * 텍스트 일치가 아니라 컴파일러가 붙인 심볼 ID·이름으로 찾는다. 연결 정보는 컴파일러가 줄 때만
 * 있다 — `references_supported` 가 거짓이면 목록이 비어도 "연결 없음"이 아니다.
 */
export function SymbolPanel({ projectId }: { projectId: string }) {
  // 검색어와 고른 심볼은 저장소에 둔다. 연결을 눌러 다른 파일로 넘어가면 에디터가 새로
  // 마운트되는데, 그때도 따라가던 목록이 남아야 한다.
  const query = useWorkspaceStore((state) => state.symbolQuery)
  const setQuery = useWorkspaceStore((state) => state.setSymbolQuery)
  const selected = useWorkspaceStore((state) => state.symbol)
  const setSelected = useWorkspaceStore((state) => state.selectSymbol)
  const debounced = useDebouncedValue(query.trim(), 250)

  const search = useSearchTreeSymbols<SymbolSearchResponse>(
    projectId,
    { query: debounced },
    { query: { enabled: debounced !== '' && selected === null } },
  )

  if (selected !== null) {
    return (
      <SymbolLinks
        projectId={projectId}
        selected={selected}
        onBack={() => setSelected(null)}
        onSelect={setSelected}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 px-4 pt-2 pb-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-7 mt-0.5 -translate-y-1/2 text-text-subtle" />
        <Input
          value={query}
          aria-label="심볼 찾기"
          placeholder="심볼 ID나 이름으로 찾기 (예: 주문, order.amount)"
          className="h-8 pl-8 text-body-sm"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {debounced === '' ? (
          <p className="px-4 py-2 text-caption text-text-muted">
            모델·역할·행동·정책 같은 심볼을 찾아 무엇이 그것을 쓰는지 볼 수 있어요.
          </p>
        ) : search.isPending ? (
          <div className="space-y-2 px-4 py-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : search.isError ? (
          <p className="px-4 py-2 text-caption text-diagnostic-error">
            심볼을 찾지 못했어요. {errorMessage(search.error)}
          </p>
        ) : (
          <>
            {search.data.matches.length === 0 ? (
              <p className="px-4 py-2 text-caption text-text-muted">일치하는 심볼이 없어요.</p>
            ) : (
              <ul>
                {search.data.matches.map((match) => (
                  <li key={`${match.path}:${match.id}:${match.start.line}`}>
                    <MatchRow match={match} onSelect={() => setSelected({ id: match.id, ownerId: null })} />
                  </li>
                ))}
              </ul>
            )}
            {search.data.truncated ? (
              <p className="px-4 py-1 text-caption text-text-subtle">결과가 많아 일부만 보여요. 더 자세히 찾아 주세요.</p>
            ) : null}
            <UnparsedNote paths={search.data.unparsed.map((file) => file.path)} />
          </>
        )}
      </div>
    </div>
  )
}

function MatchRow({ match, onSelect }: { match: SymbolMatchResponse; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 px-4 py-1.5 text-left outline-none hover:bg-state-hover focus-visible:focus-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-body-sm text-text">{match.id}</span>
        <span className="block truncate text-caption text-text-muted">
          {match.name ?? '이름 없음'} · {match.kind}
        </span>
      </span>
      <span className="shrink-0 font-mono text-caption text-text-subtle tabular-nums">
        {match.path}:{match.start.line}
      </span>
      <ChevronRightIcon className="size-3.5 text-text-subtle" />
    </button>
  )
}

function SymbolLinks({
  projectId,
  selected,
  onBack,
  onSelect,
}: {
  projectId: string
  selected: Selected
  onBack: () => void
  onSelect: (next: Selected) => void
}) {
  const openFile = useWorkspaceStore((state) => state.openFile)
  const fetched = useFetchTreeSymbol<SymbolFetchResponse>(projectId, {
    id: selected.id,
    ...(selected.ownerId === null ? {} : { owner_id: selected.ownerId }),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-2 pb-1">
        <Button variant="ghost" size="xs" onClick={onBack}>
          <ChevronRightIcon className="rotate-180" />
          찾기로 돌아가기
        </Button>
        <span className="min-w-0 truncate font-mono text-body-sm font-semibold text-text">{selected.id}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {fetched.isPending ? (
          <div className="space-y-2 px-4 py-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : fetched.isError ? (
          <p className="px-4 py-2 text-caption text-diagnostic-error">
            {isNotFound(fetched.error)
              ? '이 심볼이 지금 작업 트리에 없어요. 이름이 바뀌었거나 지워졌을 수 있어요.'
              : `연결을 불러오지 못했어요. ${errorMessage(fetched.error)}`}
          </p>
        ) : (
          <>
            <Section title="선언">
              {fetched.data.symbols.map((symbol) => (
                <LinkRow
                  key={`${symbol.path}:${symbol.start.line}`}
                  primary={symbol.name ?? symbol.id}
                  secondary={symbol.kind}
                  path={symbol.path}
                  line={symbol.start.line}
                  onOpen={() => openFile(symbol.path, symbol.start.line)}
                />
              ))}
            </Section>

            {fetched.data.references_supported ? (
              <>
                <LinkSection
                  title="이 심볼을 쓰는 곳"
                  empty="이 심볼을 가리키는 심볼이 없어요."
                  links={fetched.data.referenced_by}
                  onOpen={openFile}
                  onSelect={onSelect}
                />
                <LinkSection
                  title="이 심볼이 쓰는 것"
                  empty="이 심볼이 가리키는 심볼이 없어요."
                  links={fetched.data.references}
                  onOpen={openFile}
                  onSelect={onSelect}
                />
              </>
            ) : (
              <p className="mx-4 mt-2 rounded-control bg-diagnostic-info-subtle px-3 py-2 text-caption text-diagnostic-info">
                지금 컴파일러는 연결 정보를 주지 않아요. 연결이 없다는 뜻은 아니에요.
              </p>
            )}
            <UnparsedNote paths={fetched.data.unparsed.map((file) => file.path)} />
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pt-2">
      <h3 className="px-4 pb-1 text-label-sm text-text-muted">{title}</h3>
      <ul>{children}</ul>
    </section>
  )
}

function LinkSection({
  title,
  empty,
  links,
  onOpen,
  onSelect,
}: {
  title: string
  empty: string
  links: readonly LinkedSymbolResponse[]
  onOpen: (path: string, line?: number) => void
  onSelect: (next: Selected) => void
}) {
  return (
    <Section title={`${title} ${links.length.toLocaleString('ko-KR')}`}>
      {links.length === 0 ? (
        <li className="px-4 py-1 text-caption text-text-muted">{empty}</li>
      ) : (
        links.map((link, index) => (
          <LinkRow
            key={`${link.id}:${link.field}:${index}`}
            primary={link.id}
            secondary={`${link.kind} · ${link.field}`}
            path={link.path}
            line={link.start.line}
            onOpen={() => onOpen(link.path, link.start.line)}
            onSelect={() => onSelect({ id: link.id, ownerId: link.owner_id })}
          />
        ))
      )}
    </Section>
  )
}

/** 누르면 그 줄을 에디터에 연다. 연결된 심볼이면 오른쪽 화살표로 그 심볼의 연결로 넘어간다. */
function LinkRow({
  primary,
  secondary,
  path,
  line,
  onOpen,
  onSelect,
}: {
  primary: string
  secondary: string
  path: string
  line: number
  onOpen: () => void
  onSelect?: () => void
}) {
  return (
    <li className="group flex items-center hover:bg-state-hover">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 py-1.5 pl-4 text-left outline-none focus-visible:focus-ring"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-body-sm text-text">{primary}</span>
          <span className="block truncate text-caption text-text-muted">{secondary}</span>
        </span>
        <span className="shrink-0 font-mono text-caption text-text-subtle tabular-nums">
          {path}:{line}
        </span>
      </button>
      {onSelect === undefined ? (
        <span className="w-4" />
      ) : (
        <Button
          variant="ghost"
          size="icon-xs"
          className="mr-2 ml-1"
          aria-label={`${primary}의 연결 보기`}
          onClick={onSelect}
        >
          <ChevronRightIcon />
        </Button>
      )}
    </li>
  )
}

function UnparsedNote({ paths }: { paths: readonly string[] }) {
  if (paths.length === 0) return null
  return (
    <p className="px-4 pt-2 text-caption text-diagnostic-warning">
      구문 오류로 읽지 못한 파일이 있어 결과에서 빠졌어요: {paths.join(', ')}
    </p>
  )
}
