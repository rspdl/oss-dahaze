import { spanToLineColumn, type ByteSpan } from '@dahaze/rspdl-editor'

/**
 * 컴파일 결과(`AnalysisResponse.result`)에서 정보구조와 화면 흐름을 읽어 파일별 계층으로 묶는다.
 *
 * 새 의미를 만들지 않는다. 읽는 목록은 컴파일러가 준 네 개뿐이고(docs/rfcs/0001-screen-boards.md),
 * 여기서 하는 일은 `parent_id`·`screen_categories` 로 묶고 byte span 을 줄 번호로 바꾸는 것이다.
 *
 * ```
 * information_architecture  [{ id, name, parent_id?, span }]   선언 순서 = 전위 순회
 * screen_categories         [{ screen_id, category_id, span }]
 * screens                   [{ id, name, span }]               id 순으로 온다
 * screen_paths              [{ source_screen_id, source_element_id, target_screen_id, label?, span }]
 * ```
 *
 * 소속은 전부 `path + id` 로 푼다. 두 문서가 같은 모듈 id 를 쓰면 분류 id 도 글자 그대로 같아지므로,
 * id 만으로 묶으면 한 문서의 화면이 다른 문서의 분류에 붙는다. 참조는 자기 문서 안의 선언을 가리킨다.
 */

/** 원문 위치. `line` 은 1부터 센다. */
export interface IaLocation {
  path: string
  line: number
}

export interface IaScreenPath {
  key: string
  targetId: string
  /** 같은 문서에서 찾은 대상 화면 이름. 못 찾으면 null 이고 화면은 id 를 보여준다. */
  targetName: string | null
  elementId: string | null
  label: string | null
  location: IaLocation | null
}

export interface IaScreen {
  key: string
  id: string
  name: string
  location: IaLocation | null
  paths: IaScreenPath[]
}

export interface IaCategory {
  key: string
  id: string
  name: string
  location: IaLocation | null
  categories: IaCategory[]
  screens: IaScreen[]
}

export interface IaFile {
  path: string
  categories: IaCategory[]
  /** 어느 분류에도 담기지 않은 화면. 원문 선언 순서. */
  uncategorized: IaScreen[]
}

export interface IaOutline {
  /** `result` 가 알아볼 수 있는 모양(`files` 배열)이었는지. */
  recognized: boolean
  /** 분류나 화면이 하나라도 있는 파일만. */
  files: IaFile[]
  /** 구문 오류로 `module` 이 비어 읽지 못한 파일. 이 파일의 화면은 `files` 에 없다. */
  unparsed: { path: string; errorCount: number }[]
}

type RawRecord = Record<string, unknown>

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function records(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function byteSpan(value: unknown): ByteSpan | null {
  if (!isRecord(value)) return null
  const { start, end } = value
  if (typeof start !== 'number' || typeof end !== 'number') return null
  return { start, end }
}

export function buildIaOutline(result: unknown, texts: ReadonlyMap<string, string>): IaOutline {
  if (!isRecord(result) || !Array.isArray(result.files)) {
    return { recognized: false, files: [], unparsed: [] }
  }

  const files: IaFile[] = []
  const unparsed: IaOutline['unparsed'] = []

  for (const rawFile of records(result.files)) {
    const path = str(rawFile.path) ?? ''
    const moduleIr = isRecord(rawFile.module) ? rawFile.module : null
    if (moduleIr === null) {
      const errorCount = records(rawFile.diagnostics).filter(
        (diagnostic) => diagnostic.severity === 'error',
      ).length
      unparsed.push({ path, errorCount })
      continue
    }
    const file = readFile(path, moduleIr, texts.get(path))
    if (file.categories.length > 0 || file.uncategorized.length > 0) files.push(file)
  }

  return { recognized: true, files, unparsed }
}

function readFile(path: string, moduleIr: RawRecord, text: string | undefined): IaFile {
  const locate = (span: ByteSpan | null): IaLocation | null =>
    span === null || text === undefined ? null : { path, line: spanToLineColumn(text, span).line }

  const screenNames = new Map<string, string>()
  const screenSpans = new Map<string, ByteSpan | null>()
  const screenIds: string[] = []
  for (const rawScreen of records(moduleIr.screens)) {
    const id = str(rawScreen.id)
    if (id === null || screenNames.has(id)) continue
    screenIds.push(id)
    screenNames.set(id, str(rawScreen.name) ?? id)
    screenSpans.set(id, byteSpan(rawScreen.span))
  }

  const pathsBySource = new Map<string, IaScreenPath[]>()
  records(moduleIr.screen_paths).forEach((rawPath, index) => {
    const sourceId = str(rawPath.source_screen_id)
    const targetId = str(rawPath.target_screen_id)
    if (sourceId === null || targetId === null) return
    const list = pathsBySource.get(sourceId) ?? []
    list.push({
      key: `${path}:path:${index}`,
      targetId,
      targetName: screenNames.get(targetId) ?? null,
      elementId: str(rawPath.source_element_id),
      label: str(rawPath.label),
      location: locate(byteSpan(rawPath.span)),
    })
    pathsBySource.set(sourceId, list)
  })

  const makeScreen = (id: string): IaScreen => ({
    key: `${path}:screen:${id}`,
    id,
    name: screenNames.get(id) ?? id,
    location: locate(screenSpans.get(id) ?? null),
    paths: pathsBySource.get(id) ?? [],
  })

  /*
    화면 → 분류. 컴파일러가 한 화면을 한 분류에만 두도록 강제하므로 먼저 온 배정을 남긴다.
    분류 안의 화면 차례는 `screen_categories` 의 순서, 곧 머리말에 적은 차례다 — `screens` 는
    id 순이라 그대로 쓰면 적은 순서가 뒤집힌다.
  */
  const categoryIds = new Set<string>()
  const rawCategories = records(moduleIr.information_architecture).filter((raw) => {
    const id = str(raw.id)
    if (id === null || categoryIds.has(id)) return false
    categoryIds.add(id)
    return true
  })

  const screensByCategory = new Map<string, string[]>()
  const assigned = new Set<string>()
  for (const rawAssignment of records(moduleIr.screen_categories)) {
    const screenId = str(rawAssignment.screen_id)
    const categoryId = str(rawAssignment.category_id)
    if (screenId === null || categoryId === null || assigned.has(screenId)) continue
    if (!categoryIds.has(categoryId)) continue
    assigned.add(screenId)
    const members = screensByCategory.get(categoryId) ?? []
    members.push(screenId)
    screensByCategory.set(categoryId, members)
  }

  /* 부모를 찾지 못한 분류는 버리지 않고 최상위에 둔다. 버리면 화면이 문서 내용을 빠뜨린다. */
  const children = new Map<string, RawRecord[]>()
  const roots: RawRecord[] = []
  for (const raw of rawCategories) {
    const parentId = str(raw.parent_id)
    if (parentId === null || !categoryIds.has(parentId) || parentId === str(raw.id)) {
      roots.push(raw)
      continue
    }
    const siblings = children.get(parentId) ?? []
    siblings.push(raw)
    children.set(parentId, siblings)
  }

  const visited = new Set<string>()
  const makeCategory = (raw: RawRecord): IaCategory => {
    const id = str(raw.id)!
    visited.add(id)
    return {
      key: `${path}:category:${id}`,
      id,
      name: str(raw.name) ?? id,
      location: locate(byteSpan(raw.span)),
      categories: (children.get(id) ?? [])
        .filter((child) => !visited.has(str(child.id)!))
        .map(makeCategory),
      screens: (screensByCategory.get(id) ?? []).map(makeScreen),
    }
  }

  /* 분류에 없는 화면은 원문에 선언한 순서로 둔다. span 이 없으면 뒤로 보낸다. */
  const uncategorized = screenIds
    .filter((id) => !assigned.has(id))
    .sort(
      (left, right) =>
        (screenSpans.get(left)?.start ?? Number.MAX_SAFE_INTEGER) -
        (screenSpans.get(right)?.start ?? Number.MAX_SAFE_INTEGER),
    )
    .map(makeScreen)

  return { path, categories: roots.map(makeCategory), uncategorized }
}
