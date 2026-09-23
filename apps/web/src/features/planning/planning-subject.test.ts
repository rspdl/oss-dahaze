import { describe, expect, it } from 'vitest'

import { elementPlanningSubject, parsePlanningSubject, planningSubjectHref } from './planning-subject'

describe('planning interview subject links', () => {
  it('scopes element identity by screen while preserving the compiler stable ID', () => {
    const checkout = elementPlanningSubject({ screenKey: 'app.rspdl:checkout', elementId: 'submit', sourcePath: 'app.rspdl', label: '결제' })
    const profile = elementPlanningSubject({ screenKey: 'app.rspdl:profile', elementId: 'submit', sourcePath: 'app.rspdl', label: '저장' })

    expect(checkout.id).not.toBe(profile.id)
    expect(checkout).toMatchObject({ id: 'app.rspdl:checkout:stable:submit', stableId: 'submit', sourcePath: 'app.rspdl' })
    expect(profile).toMatchObject({ id: 'app.rspdl:profile:stable:submit', stableId: 'submit', sourcePath: 'app.rspdl' })
  })

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
