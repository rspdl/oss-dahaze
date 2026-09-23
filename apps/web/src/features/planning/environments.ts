export type PlanningEnvironment = {
  id: string
  name: string
  width: number
  height: number
  screenMode: 'all' | 'selected'
  screenKeys: string[]
}

/**
 * Older metadata used an empty screenKeys list to mean every screen. New metadata records
 * screenMode so that an intentionally empty selected set stays empty.
 */
export function parsePlanningEnvironments(value: unknown): PlanningEnvironment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw, index) => {
    if (!isRecord(raw)) return []
    const screenKeys = Array.isArray(raw.screenKeys)
      ? raw.screenKeys.filter((item): item is string => typeof item === 'string')
      : []
    const screenMode = raw.screenMode === 'all' || raw.screenMode === 'selected'
      ? raw.screenMode
      : screenKeys.length === 0 ? 'all' : 'selected'
    return [{
      id: typeof raw.id === 'string' ? raw.id : `environment-${index}`,
      name: typeof raw.name === 'string' ? raw.name : `환경 ${index + 1}`,
      width: typeof raw.width === 'number' ? raw.width : 390,
      height: typeof raw.height === 'number' ? raw.height : 844,
      screenMode,
      screenKeys,
    }]
  })
}

export function visibleScreenKeys(environment: PlanningEnvironment | undefined): ReadonlySet<string> | undefined {
  if (environment === undefined || environment.screenMode === 'all') return undefined
  return new Set(environment.screenKeys)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
