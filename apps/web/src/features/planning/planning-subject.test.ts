import { describe, expect, it } from 'vitest'

import { parsePlanningSubject, planningSubjectHref } from './planning-subject'

describe('planning interview subject links', () => {
  it('preserves source path and stable ID for duplicate-safe screen and element context', () => {
    const href = planningSubjectHref('project 1', { kind: 'element', id: 'submit', stableId: 'submit', sourcePath: 'flows/booking.rspdl', label: '결제 버튼' })
    const query = Object.fromEntries(new URL(`https://dahaze.local${href}`).searchParams)

    expect(parsePlanningSubject(query)).toEqual({ kind: 'element', id: 'submit', stableId: 'submit', sourcePath: 'flows/booking.rspdl', label: '결제 버튼' })
  })

  it('rejects incomplete or unknown subject query data', () => {
    expect(parsePlanningSubject({ subjectKind: 'element', subjectId: 'submit' })).toBeUndefined()
    expect(parsePlanningSubject({ subjectKind: 'unknown', subjectId: 'submit', subjectLabel: '버튼' })).toBeUndefined()
  })
})
