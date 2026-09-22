import type { ProjectCompileResponse } from '@dahaze/api-client'
import type { ByteSpan } from '@dahaze/rspdl-editor'

/**
 * 컴파일 결과에서 **보드가 그릴 구조**만 좁힌다.
 *
 * 화면 안을 그리는 일은 `features/mockup/screen-layouts.ts` 가 맡는다. 여기는 그 바깥 —
 * 분류 계층, 화면 목록, 화면 사이 경로다. 둘을 나눈 이유는 관심사가 달라서다. 렌더러는
 * 요소와 필드를 알아야 하고, 보드는 노드와 간선을 알아야 한다.
 *
 * 새 의미를 만들지 않는다. `information_architecture` 는 이미 **선언 순서(전위 순회)** 로
 * 오므로 그대로 옮기고, 이름순으로 정렬하지 않는다. 정보구조에서 형제의 순서는 곧 메뉴
 * 순서이고, 그건 기획자가 그 순서로 적어서 내린 결정이다.
 *
 * `span` 을 함께 들고 온다. 오른쪽 패널이 원문 조각을 보여주려면 필요하고, 그것이 IR 이
 * 준 사실 그대로를 가리키는 유일한 방법이다 (ADR-0003 — `result` 는 컴파일러가 소유한다).
 */

/** 정보구조의 분류 하나. */
export interface BoardCategory {
  /** 같은 id 가 다른 문서에 있어도 합쳐지지 않도록 path 를 포함한다. */
  key: string
  id: string
  name: string
  /** 최상위 분류는 `null`. */
  parentId: string | null
  path: string
  span: ByteSpan | null
}

/** 화면 하나. 레이아웃이 있든 없든 보드의 노드가 된다. */
export interface BoardScreen {
  key: string
  id: string
  /** 선언된 이름. 없으면 id 를 대신 쓴다. */
  name: string
  path: string
  span: ByteSpan | null
  /** 담긴 분류. 어느 분류에도 없으면 `null` — 오류가 아니라 사실이다. */
  categoryId: string | null
  /** 분류 소속이 선언된 자리. 오른쪽 패널이 그 줄을 가리킬 때 쓴다. */
  categorySpan: ByteSpan | null
  /**
   * 머리말 `정보구조:` 목록에서 이 화면이 적힌 차례.
   *
   * **`module.screens` 는 id 순으로 정렬돼 온다.** 문장으로 선언된 화면에는 authored order 가
   * 없기 때문이다. 반면 분류 안의 차례는 기획자가 `[시설 목록 화면, 시설 상세 화면]` 처럼
   * 직접 적은 것이고 그것이 곧 메뉴 순서다. 그 차례를 잃지 않으려고 여기 싣는다.
   */
  categoryOrder: number | null
  /**
   * 이 화면이 레이아웃을 선언했는지. **span 유무와 다른 사실이다** — 선언은 했는데 span 이
   * 빠진 모양이 오면 빈 상자로 떨어뜨리는 대신 선언된 것으로 센다.
   */
  hasLayout: boolean
  /** 레이아웃이 선언된 자리. 선언하지 않았거나 span 을 읽지 못하면 `null`. */
  layoutSpan: ByteSpan | null
}

/** 화면 사이의 경로 하나. */
export interface BoardPath {
  /**
   * 경로에는 stable ID 가 없다. 아무도 이름 붙이지 않는 것에 ID 를 지어 주면 없는 사실을
   * 만드는 것이므로, 양 끝점과 설명으로 가리킨다 (RFC-0001 알려진 제약).
   */
  key: string
  sourceScreenId: string
  sourceElementId: string
  targetScreenId: string
  /** 사람이 읽는 설명. 적지 않았으면 `null` — 빈 문자열로 채우지 않는다. */
  label: string | null
  path: string
  span: ByteSpan | null
}

export interface CollectedBoard {
  categories: BoardCategory[]
  screens: BoardScreen[]
  paths: BoardPath[]
  /** 화면이 현재 SDK wire shape 를 인식하는지. `false` 는 "없음" 이 아니라 "모른다". */
  recognized: boolean
  /** 문서가 있어 실제 컴파일이 실행됐는지. */
  compiled: boolean
}

const EMPTY: CollectedBoard = {
  categories: [],
  screens: [],
  paths: [],
  recognized: true,
  compiled: true,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

/** IR 의 span 을 그대로 옮긴다. 모양이 다르면 지어내지 않고 `null` 로 둔다. */
function span(value: unknown): ByteSpan | null {
  if (!isRecord(value)) return null
  const { start, end } = value
  if (typeof start !== 'number' || typeof end !== 'number') return null
  return { start, end }
}

/**
 * 컴파일 결과는 `{ files: [{ path, module, diagnostics }] }` 모양이다.
 * 파일 여러 개를 한 번에 컴파일하므로 전부 이어 붙인다. 참조는 파일 안에서만 푼다 —
 * 분류 소속도 경로의 끝점도 같은 문서 안의 선언을 가리킨다.
 */
export function collectBoard(
  response: ProjectCompileResponse | undefined,
): CollectedBoard {
  if (response === undefined) return EMPTY
  if (response.result === null || response.result === undefined) {
    return { ...EMPTY, compiled: false }
  }

  const rawResult: unknown = response.result
  if (!isRecord(rawResult) || !Array.isArray(rawResult.files)) {
    return { ...EMPTY, recognized: false }
  }

  const categories: BoardCategory[] = []
  const screens: BoardScreen[] = []
  const paths: BoardPath[] = []

  for (const rawFile of records(rawResult.files)) {
    const path = str(rawFile.path) ?? ''
    const moduleIr = isRecord(rawFile.module) ? rawFile.module : null
    if (moduleIr === null) continue

    for (const rawCategory of records(moduleIr.information_architecture)) {
      const id = str(rawCategory.id)
      if (id === null) continue
      categories.push({
        key: `${path}:${id}`,
        id,
        name: str(rawCategory.name) ?? id,
        parentId: str(rawCategory.parent_id),
        path,
        span: span(rawCategory.span),
      })
    }

    /* 화면 → 분류. 한 화면은 최대 하나의 분류에 속하고 컴파일러가 그것을 강제한다
       (`semantic.information_architecture.screen_multiple_categories`). 그래서 뒤에 온
       항목으로 덮지 않고 먼저 온 것을 남긴다 — 컴파일러가 이미 거부했을 상황이다. */
    const categoryOf = new Map<
      string,
      { id: string; span: ByteSpan | null; order: number }
    >()
    for (const rawAssignment of records(moduleIr.screen_categories)) {
      const screenId = str(rawAssignment.screen_id)
      const categoryId = str(rawAssignment.category_id)
      if (screenId === null || categoryId === null) continue
      if (categoryOf.has(screenId)) continue
      categoryOf.set(screenId, {
        id: categoryId,
        span: span(rawAssignment.span),
        order: categoryOf.size,
      })
    }

    const layoutSpans = new Map<string, ByteSpan | null>()
    for (const rawLayout of records(moduleIr.screen_layouts)) {
      const screenId = str(rawLayout.screen_id)
      if (screenId === null) continue
      layoutSpans.set(screenId, span(rawLayout.span))
    }

    for (const rawScreen of records(moduleIr.screens)) {
      const id = str(rawScreen.id)
      if (id === null) continue
      const assignment = categoryOf.get(id) ?? null
      screens.push({
        key: `${path}:${id}`,
        id,
        name: str(rawScreen.name) ?? id,
        path,
        span: span(rawScreen.span),
        categoryId: assignment?.id ?? null,
        categorySpan: assignment?.span ?? null,
        categoryOrder: assignment?.order ?? null,
        hasLayout: layoutSpans.has(id),
        layoutSpan: layoutSpans.get(id) ?? null,
      })
    }

    for (const rawPath of records(moduleIr.screen_paths)) {
      const sourceScreenId = str(rawPath.source_screen_id)
      const sourceElementId = str(rawPath.source_element_id)
      const targetScreenId = str(rawPath.target_screen_id)
      if (sourceScreenId === null || sourceElementId === null || targetScreenId === null) {
        continue
      }
      const label = str(rawPath.label)
      paths.push({
        key: `${path}:${sourceScreenId}.${sourceElementId}->${targetScreenId}:${label ?? ''}`,
        sourceScreenId,
        sourceElementId,
        targetScreenId,
        label,
        path,
        span: span(rawPath.span),
      })
    }
  }

  return { ...EMPTY, categories, screens, paths }
}

/**
 * 문서 하나 안의 선언을 가리키는 키.
 *
 * **id 만으로는 부족하다.** 두 문서가 같은 모듈 id 를 선언하면 화면 id 도 글자 그대로 같아진다
 * (컴파일러는 `RSPDL-LINK-001` 로 알리지만 두 파일의 module IR 을 모두 내보낸다). 그때 id 로만
 * 묶으면 한 문서의 화면이 다른 문서의 화면을 덮어쓰고, 사람은 자기가 쓴 화면이 사라진 것을
 * 본다. `data-models.ts` 가 같은 이유로 `path + id` 를 쓴다.
 *
 * `key` 필드들이 이미 이 모양이다. 참조를 풀 때도 같은 규칙을 써야 하므로 여기 한 곳에 둔다.
 */
export function refKey(path: string, id: string): string {
  return `${path}:${id}`
}

/**
 * 오른쪽 패널이 가리킬 자리.
 *
 * 레이아웃을 선언한 화면은 그 블록을, 아니면 화면을 선언한 문장을 가리킨다. 사람이 노드를
 * 골랐을 때 보고 싶은 것은 "이 노드가 어디서 왔는가" 이고, 레이아웃이 있으면 그게 더 가깝다.
 */
export function screenSourceSpan(screen: BoardScreen): ByteSpan | null {
  return screen.layoutSpan ?? screen.span
}
