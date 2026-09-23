import type { CompilerEditHandler, CompilerEditHandlerKind } from '@dahaze/api-client'

import type { ElementSelection, SemanticProposal } from '../mockup/prototype-contract'
import type { ReadablePath } from '../specification/readable-specification'

export function disconnectProposal(selection: ElementSelection, path: ReadablePath): SemanticProposal | null {
  if (selection.elementId === undefined) return null
  const handler = readableHandler(path)
  if (path.targetScreen === null && handler === null) return null
  return { kind: 'disconnect', sourceScreenKey: selection.screenKey, sourceElementId: selection.elementId, outcomeId: path.outcomeId, targetScreenId: path.targetScreen?.id ?? null, handler, label: path.label }
}

export function readableHandler(path: ReadablePath): CompilerEditHandler | null {
  const handler = path.handler
  if (handler === null || handler.id === null || !isHandlerKind(handler.kind)) return null
  return { kind: handler.kind, id: handler.id, ...(handler.content === null ? {} : { content: handler.content }) }
}

function isHandlerKind(value: string): value is CompilerEditHandlerKind {
  return value === 'state' || value === 'message' || value === 'popup' || value === 'loading'
}
