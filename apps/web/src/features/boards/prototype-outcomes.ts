import type { CompilerEditHandler, CompilerEditHandlerKind } from '@dahaze/api-client'

import type { ActionOutcome } from '@/features/mockup/prototype-contract'
import type { ReadableElement, ReadablePath, ReadableSpecification } from '@/features/specification/readable-specification'

const OUTCOME_LABELS: Record<string, string> = {
  success: '성공',
  failure: '실패',
  cancel: '취소',
  timeout: '시간 초과',
}

const HANDLER_LABELS: Record<CompilerEditHandlerKind, string> = {
  state: '상태',
  message: '메시지',
  popup: '팝업',
  loading: '로딩',
}

export function prototypeOutcomesByScreen(specification: ReadableSpecification): Record<string, Record<string, ActionOutcome[]>> {
  const result: Record<string, Record<string, ActionOutcome[]>> = {}
  for (const screen of specification.screens) {
    const byElement: Record<string, ActionOutcome[]> = {}
    for (const element of flattenElements(screen.elements)) {
      if (element.id === null || element.outcomes.length === 0) continue
      byElement[element.id] = element.outcomes.map((outcome) => {
        const path = element.paths.find((candidate) => candidate.outcomeId === outcome.id)
        const targetScreenKey = path?.targetScreen === null || path?.targetScreen === undefined
          ? null
          : `${screen.source.path}:${path.targetScreen.id}`
        const handler = compilerHandler(path)
        const kind = OUTCOME_LABELS[outcome.kind] ?? outcome.kind
        const destination = path === undefined
          ? null
          : path.targetScreen !== null
            ? `이동 · ${path.targetScreen.name}`
            : handler === null
              ? null
              : `${HANDLER_LABELS[handler.kind]} · ${handler.id}`
        return {
          id: outcome.id,
          label: [kind, outcome.localId, path?.label, destination].filter((value) => value !== null && value !== undefined && value !== '').join(' · '),
          targetScreenKey,
          handler,
        }
      })
    }
    result[screen.key] = byElement
  }
  return result
}

export function handlerDisplay(handler: CompilerEditHandler): string {
  const prefix = `${HANDLER_LABELS[handler.kind]} · ${handler.id}`
  return handler.content === null || handler.content === undefined || handler.content === ''
    ? prefix
    : `${prefix} · ${handler.content}`
}

function compilerHandler(path: ReadablePath | undefined): CompilerEditHandler | null {
  const handler = path?.handler
  if (handler === null || handler === undefined || handler.id === null || !isHandlerKind(handler.kind)) return null
  return { kind: handler.kind, id: handler.id, ...(handler.content === null ? {} : { content: handler.content }) }
}

function isHandlerKind(value: string): value is CompilerEditHandlerKind {
  return value === 'state' || value === 'message' || value === 'popup' || value === 'loading'
}

function flattenElements(elements: ReadableElement[]): ReadableElement[] {
  return elements.flatMap((element) => [element, ...flattenElements(element.children)])
}
