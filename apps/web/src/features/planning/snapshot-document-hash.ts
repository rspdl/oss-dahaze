import { utf8Sha256 } from '../boards/document-hash'

export async function snapshotDocumentSourceHashes(documents: readonly unknown[]): Promise<Record<string, string>> {
  const entries = await Promise.all(documents.flatMap((value) => {
    const document = record(value)
    const path = string(document?.path)
    const explicit = string(document?.source_hash)
    const text = string(document?.text)
    if (path === null || (explicit === null && text === null)) return []
    return [explicit === null ? utf8Sha256(text!).then((hash) => [path, hash] as const) : Promise.resolve([path, explicit] as const)]
  }))
  return Object.fromEntries(entries)
}

function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null }
function string(value: unknown): string | null { return typeof value === 'string' ? value : null }
