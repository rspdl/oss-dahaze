import type { AgentItemResponse } from '@dahaze/api-client'

import { diffLines, summarizeDiff } from '../../shared/diff-lines'

/**
 * AI 대화 항목을 화면 행으로 바꾼다.
 *
 * 서버는 항목을 기록된 순서대로 준다: 사용자 메시지, 도구 호출, 도구 결과, AI 답변. 화면은
 * 도구 호출과 그 결과를 카드 하나로 보여주므로 `call_id` 로 둘을 묶는다.
 *
 * payload 는 서버 스키마에서 `dict[str, Any]` 라 여기서 한 번만 좁힌다. 모르는 모양을 만나면
 * 던지지 않고 빈 값으로 둔다 — 대화 목록 전체가 그려지지 않는 것보다 카드 하나가 덜 채워지는
 * 편이 낫다.
 */

export interface FileChange {
  pathBefore: string | null
  pathAfter: string | null
  textBefore: string | null
  textAfter: string | null
}

export interface ToolResult {
  ok: boolean
  output: unknown
  changes: FileChange[]
}

export type AgentRow =
  | { kind: 'user'; id: string; seq: number; text: string }
  | { kind: 'assistant'; id: string; seq: number; text: string }
  | {
      kind: 'tool'
      id: string
      seq: number
      callId: string
      name: string
      arguments: Record<string, unknown>
      /** 결과가 아직 기록되지 않았으면 null. 도구가 실행 중이다. */
      result: ToolResult | null
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toChanges(value: unknown): FileChange[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((change) => ({
    pathBefore: stringOrNull(change.path_before),
    pathAfter: stringOrNull(change.path_after),
    textBefore: stringOrNull(change.text_before),
    textAfter: stringOrNull(change.text_after),
  }))
}

export function toAgentRows(items: readonly AgentItemResponse[]): AgentRow[] {
  const rows: AgentRow[] = []
  const toolRows = new Map<string, Extract<AgentRow, { kind: 'tool' }>>()

  for (const item of [...items].sort((a, b) => a.seq - b.seq)) {
    const payload = isRecord(item.payload) ? item.payload : {}

    if (item.kind === 'user_message' || item.kind === 'assistant_message') {
      rows.push({
        kind: item.kind === 'user_message' ? 'user' : 'assistant',
        id: item.id,
        seq: item.seq,
        text: stringOrNull(payload.text) ?? '',
      })
      continue
    }

    const callId = stringOrNull(payload.call_id) ?? item.id
    const name = stringOrNull(payload.name) ?? '도구'

    if (item.kind === 'tool_call') {
      const row: Extract<AgentRow, { kind: 'tool' }> = {
        kind: 'tool',
        id: item.id,
        seq: item.seq,
        callId,
        name,
        arguments: isRecord(payload.arguments) ? payload.arguments : {},
        result: null,
      }
      toolRows.set(callId, row)
      rows.push(row)
      continue
    }

    // tool_result. 짝이 되는 호출이 없으면(목록 앞부분만 받은 경우 등) 결과만으로 카드를 만든다.
    const result: ToolResult = {
      ok: payload.ok !== false,
      output: payload.output,
      changes: toChanges(payload.changes),
    }
    const call = toolRows.get(callId)
    if (call !== undefined) {
      call.result = result
    } else {
      rows.push({
        kind: 'tool',
        id: item.id,
        seq: item.seq,
        callId,
        name,
        arguments: {},
        result,
      })
    }
  }

  return rows
}

/** 도구 결과가 바꾼 줄 수의 합. 카드에 `+12 −3` 으로 보인다. */
export function changeStats(changes: readonly FileChange[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const change of changes) {
    const summary = summarizeDiff(diffLines(change.textBefore ?? '', change.textAfter ?? ''))
    added += summary.added
    removed += summary.removed
  }
  return { added, removed }
}

/**
 * 도구 카드 제목. `Edit(/주문/결제.rspdl)` 처럼 도구 이름과 가장 중요한 인자 하나.
 *
 * 인자 이름은 도구 정의(docs/plans/agent-workspace.md "도구")를 따른다. 모르는 도구는 이름만
 * 보여준다 — 인자를 추측해 고르면 엉뚱한 값이 제목이 된다.
 */
export function toolTitle(name: string, args: Record<string, unknown>): string {
  const label = name.length === 0 ? name : name[0]!.toUpperCase() + name.slice(1)
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = args[key]
      if (typeof value === 'string' && value !== '') return value
    }
    return null
  }

  let subject: string | null
  switch (name) {
    case 'mv': {
      const from = pick('from', 'source')
      const to = pick('to', 'target')
      subject = from !== null && to !== null ? `${from} → ${to}` : (from ?? to)
      break
    }
    case 'add':
    case 'mkdir': {
      const parent = pick('parent')
      const entry = pick('name')
      subject =
        parent !== null && entry !== null
          ? parent === '/'
            ? `/${entry}`
            : `${parent}/${entry}`
          : (entry ?? parent)
      break
    }
    case 'search':
      subject = pick('query')
      break
    case 'grep':
      subject = pick('pattern')
      break
    case 'fetch':
      subject = pick('id')
      break
    case 'commit':
      subject = pick('message')
      break
    default:
      subject = pick('path')
  }

  return subject === null ? label : `${label}(${subject})`
}

/**
 * 도구 결과 한 줄 요약. 출력이 문자열이면 첫 줄, 목록이면 건수. 그 밖에는 비운다 —
 * 객체를 JSON 으로 늘어놓아도 사람이 읽을 요약이 되지 않는다.
 */
export function resultSummary(result: ToolResult): string | null {
  const { output } = result
  if (typeof output === 'string') {
    const first = output.split('\n', 1)[0]?.trim() ?? ''
    return first === '' ? null : first.length > 120 ? `${first.slice(0, 120)}…` : first
  }
  if (Array.isArray(output)) return `${output.length.toLocaleString('ko-KR')}건`
  if (isRecord(output)) {
    const message = output.message ?? output.error
    if (typeof message === 'string') return message
  }
  return null
}
