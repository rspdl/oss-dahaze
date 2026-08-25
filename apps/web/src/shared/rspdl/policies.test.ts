import { describe, expect, it } from 'vitest'

import type { ProjectCompileResponse } from '@dahaze/api-client'
import fixture from './__policies-fixture.json'
import {
  axisKey,
  axisOptions,
  collectPolicies,
  filterFieldGroups,
  filterPolicies,
  groupPolicies,
  indexPoliciesByAxes,
} from './policies'

/**
 * 픽스처는 **실제 컴파일러가 뱉은 결과**다 (rspdl 0.1.0, wire schema 1). 손으로 지어낸
 * IR 로 테스트하면 우리가 상상한 모양만 검증하게 되고, 정작 컴파일러가 주는 모양이
 * 달라도 초록불이 켜진다.
 *
 * 입력은 `__policies-fixture/` 의 `.rspdl` 세 개다. 결과만 두면 픽스처를 넓히려 할 때마다
 * 입력을 IR 에서 거꾸로 짐작해야 한다.
 *
 * 재생성:
 *   rspdl.compile(
 *     [{path, text} for each __policies-fixture/*.rspdl],
 *     locale=rspdl.SUPPORTED_LOCALE,
 *   )["result"]
 */
function response(result: unknown): ProjectCompileResponse {
  return {
    rspdl_version: '0.1.0',
    wire_schema_version: 1,
    locale: 'ko-KR',
    result: result as ProjectCompileResponse['result'],
    documents: [],
  }
}

const collected = collectPolicies(response(fixture))

describe('collectPolicies', () => {
  it('정책의 네 축을 이름과 함께 꺼낸다', () => {
    const row = collected.rows.find(
      (entry) => entry.effect === 'deny' && entry.path === 'expense.rspdl',
    )

    expect(row).toBeDefined()
    expect(row?.role.name).toBe('사용자')
    expect(row?.model.name).toBe('비용 신청')
    expect(row?.field.name).toBe('승인 상태')
    expect(row?.action.name).toBe('변경')
    expect(row?.path).toBe('expense.rspdl')
  })

  it('여러 문서의 정책을 한 목록으로 모은다', () => {
    expect(collected.rows).toHaveLength(7)
    expect(new Set(collected.rows.map((row) => row.path))).toEqual(
      new Set(['expense.rspdl', 'ordering.rspdl', 'both.rspdl']),
    )
  })

  it('enum 필드의 가능한 값 이름을 붙인다', () => {
    // `value_type.definition` 은 id 만 준다. 이름은 `module.enums` 에서 와야 한다.
    const status = collected.fields.find((group) => group.field.name === '승인 상태')

    expect(status?.field.typeKind).toBe('enum')
    expect(status?.field.enumVariants).toEqual(['작성 중', '제출됨', '승인됨'])
    expect(status?.field.required).toBe(true)
  })

  it('같은 네 축의 allow 와 deny 가 같은 키로 묶인다', () => {
    /*
      컴파일러는 이 소스에 진단을 주지 않는다 (rspdl 0.1.0 에서 확인). 표에서 두 줄이
      나란히 놓이는 것이 사람이 이것을 발견하는 유일한 경로다 — 그래서 키가 맞아야 한다.
    */
    const keys = collected.rows.map(axisKey)
    const shared = keys.filter((key, index) => keys.indexOf(key) !== index)

    expect(shared).toHaveLength(1)
    const both = collected.rows.filter((row) => axisKey(row) === shared[0])
    expect(both.map((row) => row.effect).sort()).toEqual(['allow', 'deny'])
    expect(both.every((row) => row.role.name === '편집자')).toBe(true)
    // 심각도나 라벨을 얹지 않는다. 사실만 나란히 둔다.
    expect(both[0]).not.toHaveProperty('severity')
  })

  it('같은 네 축의 상대 정책을 필터 전 전체 목록에서 찾는다', () => {
    const onlyDenied = filterPolicies(collected.rows, { effect: ['deny'] })
    const indexed = indexPoliciesByAxes(collected.rows)
    const deniedWithPeer = onlyDenied.find(
      (row) => (indexed.get(axisKey(row))?.length ?? 0) > 1,
    )

    expect(deniedWithPeer).toBeDefined()
    expect(indexed.get(axisKey(deniedWithPeer!))?.map((row) => row.effect).sort()).toEqual([
      'allow',
      'deny',
    ])
  })

  it('정책이 걸린 필드에 제약을 붙인다', () => {
    const status = collected.fields.find((group) => group.field.name === '승인 상태')
    const amount = collected.fields.find((group) => group.field.name === '금액')
    const applicant = collected.fields.find((group) => group.field.name === '신청자')

    // 제약이 걸리지 않은 필드는 빈 목록이지 누락이 아니다.
    expect(status?.constraints).toEqual([])
    expect(amount?.constraints).toEqual([
      expect.objectContaining({ left: '금액', operator: '>', right: '0' }),
    ])
    // 두 필드를 비교하는 제약은 양쪽 피연산자 모두에 붙어야 한다. `승인자` 에는 정책이
    // 없어 표에 없지만, 그 사실이 `신청자` 쪽 부착까지 지우면 안 된다.
    expect(applicant?.constraints).toEqual([
      expect.objectContaining({ left: '신청자', operator: '≠', right: '승인자' }),
    ])
  })

  it('정책이 없는 필드는 묶음에 넣지 않는다', () => {
    // 정책 검토는 스키마 뷰어가 아니다. 제약이 걸려 있어도 정책이 없으면 나오지 않는다.
    expect(collected.fields.find((group) => group.field.name === '승인자')).toBeUndefined()
  })

  it('필드를 건드리는 화면을 조작 종류와 함께 모은다', () => {
    const status = collected.fields.find((group) => group.field.name === '승인 상태')

    expect(status?.screens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'input' }),
        expect.objectContaining({ kind: 'update' }),
      ]),
    )
    // 필드를 지목하지 않는 `생성` 도 그 모델의 필드에 해당한다.
    expect(status?.screens.some((touch) => touch.kind === 'create')).toBe(true)
  })

  it('계산으로 만들어지는 필드의 재료를 붙인다', () => {
    const total = collected.fields.find((group) => group.field.name === '합계 금액')

    expect(total?.derivedFrom).toEqual(['품목 금액'])
  })

  it('모르는 모양은 던지지 않고 recognized 로 말한다', () => {
    expect(collectPolicies(response({ files: '이건 배열이 아니다' })).recognized).toBe(
      false,
    )
  })

  it('컴파일한 적이 없는 것과 정책 0건을 구분한다', () => {
    const never = collectPolicies(response(null))
    const nothing = collectPolicies(response({ files: [] }))

    expect(never.compiled).toBe(false)
    expect(nothing.compiled).toBe(true)
    expect(nothing.rows).toEqual([])
  })

  it('진단 때문에 module 이 없는 파일에서 정책을 지어내지 않는다', () => {
    const broken = collectPolicies(
      response({ files: [{ path: 'broken.rspdl', module: null, diagnostics: [{}] }] }),
    )

    expect(broken.recognized).toBe(true)
    expect(broken.rows).toEqual([])
  })
})

describe('필터와 묶기', () => {
  const roleId = (name: string) =>
    collected.rows.find((row) => row.role.name === name)?.role.id ?? ''

  it('한 축 안의 값끼리는 OR 로 묶는다', () => {
    const rows = filterPolicies(collected.rows, {
      role: [roleId('회계 관리자'), roleId('사용자')],
    })

    expect(rows).toHaveLength(4)
    expect(new Set(rows.map((row) => row.role.name))).toEqual(
      new Set(['회계 관리자', '사용자']),
    )
  })

  it('축끼리는 AND 로 묶는다', () => {
    const rows = filterPolicies(collected.rows, {
      role: [roleId('회계 관리자'), roleId('사용자')],
      effect: ['deny'],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.role.name).toBe('사용자')
  })

  it('빈 선택은 거르지 않는다', () => {
    expect(filterPolicies(collected.rows, {})).toHaveLength(collected.rows.length)
    expect(filterPolicies(collected.rows, { role: [] })).toHaveLength(
      collected.rows.length,
    )
  })

  it('선택지는 지금 있는 정책에서만 뽑고 개수를 함께 센다', () => {
    const options = axisOptions(collected.rows, 'effect')

    expect(options.map((option) => option.label)).toEqual(['금지', '허용'])
    expect(options.reduce((sum, option) => sum + option.count, 0)).toBe(
      collected.rows.length,
    )
  })

  it('고른 축으로 묶고 이름순으로 고정한다', () => {
    const groups = groupPolicies(collected.rows, 'model')
    const labels = groups.map((group) => group.label)

    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'ko')))
    expect(groups.reduce((sum, group) => sum + group.rows.length, 0)).toBe(
      collected.rows.length,
    )
  })

  it('필드 묶음도 걸러진 줄에 맞춰 줄어든다', () => {
    /* 필터를 켠 채 탭만 옮겼는데 걸러낸 정책이 다시 보이면 안 된다. */
    const visible = filterPolicies(collected.rows, { effect: ['deny'] })
    const groups = filterFieldGroups(collected.fields, visible)

    expect(groups.every((group) => group.policies.length > 0)).toBe(true)
    expect(
      groups.flatMap((group) => group.policies).every((p) => p.effect === 'deny'),
    ).toBe(true)
  })

  it('남는 정책이 없는 필드는 묶음째 뺀다', () => {
    const groups = filterFieldGroups(collected.fields, [])

    expect(groups).toEqual([])
  })
})
