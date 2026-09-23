import type { PlanningSubject } from './planning-types'

const SUBJECT_KINDS = new Set<PlanningSubject['kind']>(['question', 'diagnostic', 'proposal', 'draft', 'screen', 'element'])

export function planningSubjectHref(projectId: string, subject: PlanningSubject): string {
  const query = new URLSearchParams({ subjectKind: subject.kind, subjectId: subject.id, subjectLabel: subject.label })
  if (subject.sourcePath !== undefined) query.set('subjectPath', subject.sourcePath)
  if (subject.stableId !== undefined) query.set('subjectStableId', subject.stableId)
  return `/projects/${projectId}/planning?${query.toString()}`
}

export function parsePlanningSubject(params: Record<string, string | string[] | undefined>): PlanningSubject | undefined {
  const kind = first(params.subjectKind)
  const id = first(params.subjectId)
  const label = first(params.subjectLabel)
  if (kind === undefined || !SUBJECT_KINDS.has(kind as PlanningSubject['kind']) || id === undefined || label === undefined) return undefined
  const sourcePath = first(params.subjectPath)
  const stableId = first(params.subjectStableId)
  return { kind: kind as PlanningSubject['kind'], id, label, ...(sourcePath === undefined ? {} : { sourcePath }), ...(stableId === undefined ? {} : { stableId }) }
}

function first(value: string | string[] | undefined): string | undefined { return typeof value === 'string' && value !== '' ? value : Array.isArray(value) && value[0] ? value[0] : undefined }
