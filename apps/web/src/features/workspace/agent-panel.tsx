'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  getListAgentItemsQueryKey,
  getListAgentSessionsQueryKey,
  getListAgentTurnsQueryKey,
  useCancelAgentTurn,
  useCreateAgentSession,
  useListAgentItems,
  useListAgentSessions,
  useListAgentTurns,
  useResolveAgentApproval,
  useSendAgentMessage,
  type AgentItemResponse,
  type AgentSessionResponse,
  type AgentTurnResponse,
} from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'
import {
  Button,
  EmptyState,
  ErrorState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  toast,
} from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import {
  ChatIcon,
  CheckIcon,
  ErrorIcon,
  PlusIcon,
  SendIcon,
  SpinnerIcon,
  StopIcon,
  WarningIcon,
} from '@/shared/ui/icons'
import { changeStats, resultSummary, toAgentRows, toolTitle, type AgentRow } from './agent-model'
import { DiffStat } from './diff-view'
import { useWorkspaceStore } from './workspace-store'

const ACTIVE_STATUSES = new Set(['queued', 'running', 'awaiting_approval'])

/**
 * 오른쪽 AI 대화. 대화는 세션 단위다 — 새 세션을 열거나 지난 세션을 이어 간다.
 *
 * 대화 항목과 턴 상태는 서버가 소유한다. 이 패널은 조회 결과를 그리고, 새 항목이 생겼다는
 * 사실은 프로젝트 이벤트 스트림(`use-project-events`)이 조회를 무효화해 알려준다.
 * 턴 도중 흘러오는 답변 조각만 `workspace-store` 에 잠시 둔다.
 */
export function AgentPanel({ projectId }: { projectId: string }) {
  const sessions = useListAgentSessions<AgentSessionResponse[]>(projectId)
  const selectedId = useWorkspaceStore((state) => state.sessionId)
  const selectSession = useWorkspaceStore((state) => state.selectSession)

  const ordered = useMemo(
    () => [...(sessions.data ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [sessions.data],
  )
  // 고른 세션이 없으면 가장 최근 세션. 새 대화를 누르면 `'new'` 로 둔다.
  const [composingNew, setComposingNew] = useState(false)
  const session = composingNew
    ? undefined
    : (ordered.find((candidate) => candidate.id === selectedId) ?? ordered[0])

  return (
    <aside aria-label="AI 대화" className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        {ordered.length === 0 || composingNew ? (
          <h2 className="flex items-center gap-2 pl-1 text-body font-semibold">
            <ChatIcon className="text-text-subtle" />새 대화
          </h2>
        ) : (
          <Select
            value={session?.id}
            onValueChange={(id) => {
              setComposingNew(false)
              selectSession(id)
            }}
          >
            <SelectTrigger size="sm" aria-label="대화 고르기" className="max-w-[16rem] min-w-0 border-transparent px-2 font-semibold hover:bg-state-hover">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ordered.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label="새 대화"
              disabled={composingNew || ordered.length === 0}
              onClick={() => setComposingNew(true)}
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>새 대화</TooltipContent>
        </Tooltip>
      </header>

      {sessions.isPending ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="ml-auto h-10 w-2/3" />
        </div>
      ) : sessions.isError ? (
        <div className="p-4">
          <ErrorState title="대화를 불러오지 못했어요" description={errorMessage(sessions.error)} />
        </div>
      ) : session === undefined ? (
        <NewConversation
          projectId={projectId}
          onStarted={(id) => {
            setComposingNew(false)
            selectSession(id)
          }}
        />
      ) : (
        <Conversation key={session.id} sessionId={session.id} />
      )}
    </aside>
  )
}

/** 세션이 없을 때. 첫 메시지를 보내면 세션을 만들고 그 세션에 보낸다. */
function NewConversation({
  projectId,
  onStarted,
}: {
  projectId: string
  onStarted: (sessionId: string) => void
}) {
  const queryClient = useQueryClient()
  const create = useCreateAgentSession()
  const send = useSendAgentMessage()

  const start = async (text: string) => {
    try {
      const session = await create.mutateAsync({ projectId, data: {} })
      await send.mutateAsync({ sessionId: session.id, data: { text, request_id: crypto.randomUUID() } })
      await queryClient.invalidateQueries({ queryKey: getListAgentSessionsQueryKey(projectId) })
      onStarted(session.id)
      return true
    } catch (error) {
      toast.error('대화를 시작하지 못했어요', { description: errorMessage(error) })
      return false
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        <EmptyState
          icon={<ChatIcon className="size-6" />}
          title="무엇을 만들까요?"
          description="만들 기능이나 고칠 문서를 말해 주세요. AI가 파일을 읽고 쓰며 컴파일 진단까지 확인해요."
        />
      </div>
      <Composer busy={create.isPending || send.isPending} onSend={start} />
    </>
  )
}

function Conversation({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient()
  const items = useListAgentItems<AgentItemResponse[]>(sessionId)
  const turns = useListAgentTurns<AgentTurnResponse[]>(sessionId)
  const streaming = useWorkspaceStore((state) => state.streaming)
  const center = useWorkspaceStore((state) => state.center)
  const openCall = useWorkspaceStore((state) => state.openCall)
  const send = useSendAgentMessage()
  const cancel = useCancelAgentTurn()
  const resolve = useResolveAgentApproval()

  const rows = useMemo(() => toAgentRows(items.data ?? []), [items.data])
  const latestTurn = useMemo(
    () => [...(turns.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0],
    [turns.data],
  )
  const active = latestTurn !== undefined && ACTIVE_STATUSES.has(latestTurn.status)
  const partial = latestTurn === undefined ? undefined : streaming[latestTurn.id]

  // 새 항목이 오면 맨 아래로. 사용자가 위로 올려 읽는 중이면 끌어내리지 않는다.
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const element = scrollRef.current
    if (element !== null && pinned.current) element.scrollTop = element.scrollHeight
  }, [rows.length, partial, latestTurn?.status])

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListAgentItemsQueryKey(sessionId) }),
      queryClient.invalidateQueries({ queryKey: getListAgentTurnsQueryKey(sessionId) }),
    ])

  const sendText = async (text: string) => {
    try {
      await send.mutateAsync({ sessionId, data: { text, request_id: crypto.randomUUID() } })
      pinned.current = true
      await refresh()
      return true
    } catch (error) {
      toast.error('메시지를 보내지 못했어요', { description: errorMessage(error) })
      return false
    }
  }

  if (items.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="ml-auto h-10 w-2/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }
  if (items.isError) {
    return (
      <div className="p-4">
        <ErrorState title="대화를 불러오지 못했어요" description={errorMessage(items.error)} />
      </div>
    )
  }

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        <ol className="flex flex-col gap-3" aria-label="대화 기록">
          {rows.map((row) => (
            <li key={row.id}>
              <Row
                row={row}
                running={active}
                selected={center.kind === 'call' && row.kind === 'tool' && center.callId === row.callId}
                onOpen={(callId) => openCall(sessionId, callId)}
              />
            </li>
          ))}
          {partial !== undefined && partial !== '' ? (
            <li>
              <p className="text-body whitespace-pre-wrap text-text">{partial}</p>
            </li>
          ) : null}
        </ol>

        {latestTurn === undefined ? null : (
          <TurnStatus
            turn={latestTurn}
            busy={cancel.isPending || resolve.isPending || send.isPending}
            onCancel={() =>
              cancel.mutate(
                { turnId: latestTurn.id },
                {
                  onSuccess: () => void refresh(),
                  onError: (error) => toast.error('멈추지 못했어요', { description: errorMessage(error) }),
                },
              )
            }
            onResolve={(approved) =>
              resolve.mutate(
                { turnId: latestTurn.id, data: { approved } },
                {
                  onSuccess: () => void refresh(),
                  onError: (error) => toast.error('답하지 못했어요', { description: errorMessage(error) }),
                },
              )
            }
            onContinue={() => void sendText('계속')}
          />
        )}
      </div>

      <Composer busy={active || send.isPending} onSend={sendText} />
    </>
  )
}

function Row({
  row,
  running,
  selected,
  onOpen,
}: {
  row: AgentRow
  running: boolean
  selected: boolean
  onOpen: (callId: string) => void
}) {
  if (row.kind === 'user') {
    return (
      <div className="ml-8 rounded-panel bg-surface-raised px-3.5 py-2.5 text-body whitespace-pre-wrap text-text">
        {row.text}
      </div>
    )
  }
  if (row.kind === 'assistant') {
    return <p className="text-body whitespace-pre-wrap text-text">{row.text}</p>
  }

  const stats = row.result === null ? null : changeStats(row.result.changes)
  const summary = row.result === null ? null : resultSummary(row.result)
  const hasChanges = row.result !== null && row.result.changes.length > 0

  return (
    <button
      type="button"
      onClick={() => onOpen(row.callId)}
      aria-pressed={selected}
      className={cn(
        'grid w-full gap-0.5 rounded-control border px-3 py-2 text-left outline-none transition-colors duration-150',
        'hover:bg-state-hover focus-visible:focus-ring',
        selected ? 'border-accent bg-accent-subtle' : 'border-border bg-surface',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {row.result === null ? (
          running ? (
            <SpinnerIcon className="size-3.5 text-text-subtle" aria-label="실행 중" />
          ) : (
            <span aria-hidden className="size-3.5 shrink-0" />
          )
        ) : row.result.ok ? (
          <CheckIcon className="size-3.5 text-success" aria-label="성공" />
        ) : (
          <ErrorIcon className="size-3.5 text-diagnostic-error" aria-label="실패" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-body-sm text-text">
          {toolTitle(row.name, row.arguments)}
        </span>
        {hasChanges && stats !== null ? <DiffStat added={stats.added} removed={stats.removed} /> : null}
      </span>
      {summary === null ? null : (
        <span className="truncate pl-6 text-caption text-text-muted">{summary}</span>
      )}
    </button>
  )
}

const STOP_MESSAGES: Record<string, string> = {
  lock_conflict: '다른 작업이 쓰고 있는 파일을 만나 멈췄어요.',
  lock_expired: '10분 동안 쓰기가 없어 잠금이 풀리고 작업을 멈췄어요.',
  cancelled: '작업을 멈췄어요.',
  error: '오류로 작업을 멈췄어요.',
}

function TurnStatus({
  turn,
  busy,
  onCancel,
  onResolve,
  onContinue,
}: {
  turn: AgentTurnResponse
  busy: boolean
  onCancel: () => void
  onResolve: (approved: boolean) => void
  onContinue: () => void
}) {
  if (turn.status === 'queued' || turn.status === 'running') {
    return (
      <div role="status" className="mt-3 flex items-center gap-2 text-body-sm text-text-muted">
        <SpinnerIcon />
        <span className="flex-1">
          {turn.status === 'queued' ? '곧 시작해요' : '작업하고 있어요'}
          {turn.tool_calls > 0 ? (
            <span className="text-text-subtle tabular-nums"> · 도구 {turn.tool_calls}/100</span>
          ) : null}
        </span>
        <Button variant="ghost" size="sm" disabled={busy || turn.cancel_requested} onClick={onCancel}>
          <StopIcon />
          {turn.cancel_requested ? '멈추는 중' : '멈추기'}
        </Button>
      </div>
    )
  }

  if (turn.status === 'awaiting_approval' && turn.pending_approval) {
    return (
      <div role="alert" className="mt-3 rounded-panel border border-border-strong bg-surface p-4">
        <p className="flex items-center gap-2 text-body font-semibold text-text">
          <WarningIcon className="text-diagnostic-warning" />
          진행해도 될까요?
        </p>
        <p className="mt-1 text-body-sm text-text-muted">{turn.pending_approval.reason}</p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => onResolve(false)}>
            거절하기
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => onResolve(true)}>
            진행하기
          </Button>
        </div>
      </div>
    )
  }

  if (turn.stop_reason === 'tool_limit') {
    return (
      <div className="mt-3 rounded-panel bg-diagnostic-info-subtle p-3 text-body-sm text-diagnostic-info">
        <p>도구를 100번 불러 한 턴의 한도에 닿았어요. 이어서 할까요?</p>
        <Button variant="secondary" size="sm" className="mt-2" disabled={busy} onClick={onContinue}>
          계속하기
        </Button>
      </div>
    )
  }

  const message =
    turn.status === 'failed'
      ? (turn.error ?? STOP_MESSAGES.error)
      : turn.stop_reason === null || turn.stop_reason === 'done'
        ? null
        : STOP_MESSAGES[turn.stop_reason]
  if (message === null || message === undefined) return null

  return (
    <p
      role="status"
      className={cn(
        'mt-3 flex items-start gap-2 text-body-sm',
        turn.status === 'failed' ? 'text-diagnostic-error' : 'text-text-muted',
      )}
    >
      {turn.status === 'failed' ? <ErrorIcon className="mt-0.5" /> : <WarningIcon className="mt-0.5" />}
      {message}
    </p>
  )
}

/**
 * 입력창. Enter 로 보내고 Shift+Enter 로 줄을 바꾼다. 한글 조합 중의 Enter 는 보내지 않는다 —
 * 조합 중에 보내면 마지막 글자가 두 번 들어간다.
 */
function Composer({ busy, onSend }: { busy: boolean; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('')
  const trimmed = text.trim()

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (trimmed === '' || busy) return
    const ok = await onSend(trimmed)
    if (ok) setText('')
  }

  return (
    <form onSubmit={submit} className="shrink-0 border-t p-3">
      <div className="rounded-control border border-border-control bg-surface focus-within:border-accent">
        <label htmlFor="workspace-agent-input" className="sr-only">
          AI에게 보낼 메시지
        </label>
        <Textarea
          id="workspace-agent-input"
          rows={3}
          value={text}
          placeholder={busy ? 'AI가 작업하는 동안에는 기다려 주세요' : '무엇을 만들거나 고칠까요?'}
          className="max-h-48 min-h-0 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            void submit()
          }}
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-caption text-text-subtle">Shift+Enter로 줄바꿈</span>
          <Button type="submit" size="icon-sm" aria-label="보내기" disabled={trimmed === '' || busy}>
            {busy ? <SpinnerIcon /> : <SendIcon />}
          </Button>
        </div>
      </div>
    </form>
  )
}
