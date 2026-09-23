import { describe, expect, it } from 'vitest'

import { parsePlanningEnvironments, visibleScreenKeys } from './environments'

describe('planning environment screen scope', () => {
  it('keeps legacy empty screen lists compatible with all screens', () => {
    const [environment] = parsePlanningEnvironments([{ id: 'legacy', screenKeys: [] }])
    expect(environment?.screenMode).toBe('all')
    expect(visibleScreenKeys(environment)).toBeUndefined()
  })

  it('does not turn an explicit empty selected set into all screens', () => {
    const [environment] = parsePlanningEnvironments([{ id: 'empty', screenMode: 'selected', screenKeys: [] }])
    expect(visibleScreenKeys(environment)).toEqual(new Set())
  })
})
