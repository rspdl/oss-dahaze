import { describe, expect, it } from 'vitest'

import { buildIaOutline } from './ia-outline'

const TEXT = [
  '---',
  '모듈: 시설 예약(reservation)',
  '정보구조:',
  '  관리(admin):',
  '    등록(register): [시설 등록 화면]',
  '  둘러보기(browse):',
  '    시설 찾기(search): [시설 목록 화면, 시설 상세 화면]',
  '화면:',
  '  시설 등록 화면:',
  '  시설 목록 화면:',
  '  시설 상세 화면:',
  '  공지 화면:',
].join('\n')

/** `needle` 이 처음 나오는 곳의 UTF-8 byte span. 컴파일러가 주는 span 과 같은 단위다. */
function spanOf(needle: string) {
  const index = TEXT.indexOf(needle)
  if (index === -1) throw new Error(needle)
  const encoder = new TextEncoder()
  const start = encoder.encode(TEXT.slice(0, index)).length
  return { start, end: start + encoder.encode(needle).length }
}

const RESULT = {
  files: [
    {
      path: '/예약.rspdl',
      diagnostics: [],
      module: {
        id: 'reservation',
        information_architecture: [
          { id: 'reservation.admin', name: '관리', span: spanOf('관리(admin)') },
          {
            id: 'reservation.register',
            name: '등록',
            parent_id: 'reservation.admin',
            span: spanOf('등록(register)'),
          },
          { id: 'reservation.browse', name: '둘러보기', span: spanOf('둘러보기(browse)') },
          {
            id: 'reservation.search',
            name: '시설 찾기',
            parent_id: 'reservation.browse',
            span: spanOf('시설 찾기(search)'),
          },
        ],
        screen_categories: [
          { screen_id: 'reservation.create', category_id: 'reservation.register', span: spanOf('[시설 등록 화면]') },
          { screen_id: 'reservation.list', category_id: 'reservation.search', span: spanOf('[시설 목록 화면') },
          { screen_id: 'reservation.detail', category_id: 'reservation.search', span: spanOf('시설 상세 화면]') },
        ],
        // 컴파일러는 화면을 id 순으로 준다. 분류 안의 차례는 screen_categories 를 따라야 한다.
        screens: [
          { id: 'reservation.create', name: '시설 등록 화면', span: spanOf('  시설 등록 화면:') },
          { id: 'reservation.detail', name: '시설 상세 화면', span: spanOf('  시설 상세 화면:') },
          { id: 'reservation.list', name: '시설 목록 화면', span: spanOf('  시설 목록 화면:') },
          { id: 'reservation.notice', name: '공지 화면', span: spanOf('  공지 화면:') },
        ],
        screen_paths: [
          {
            source_screen_id: 'reservation.list',
            source_element_id: 'open',
            target_screen_id: 'reservation.detail',
            label: '목록에서 하나 고름',
            span: spanOf('  시설 목록 화면:'),
          },
        ],
      },
    },
    {
      path: '/깨진.rspdl',
      module: null,
      diagnostics: [{ severity: 'error' }, { severity: 'warning' }, { severity: 'error' }],
    },
    { path: '/빈.rspdl', module: { id: 'empty' }, diagnostics: [] },
  ],
}

describe('buildIaOutline', () => {
  const texts = new Map([['/예약.rspdl', TEXT]])
  const outline = buildIaOutline(RESULT, texts)

  it('parent_id 로 분류를 묶고 선언 순서를 지킨다', () => {
    const [file] = outline.files
    expect(file?.categories.map((category) => category.name)).toEqual(['관리', '둘러보기'])
    expect(file?.categories[0]?.categories.map((category) => category.name)).toEqual(['등록'])
    expect(file?.categories[1]?.categories[0]?.location).toEqual({ path: '/예약.rspdl', line: 7 })
  })

  it('분류 안의 화면은 머리말에 적은 차례로 둔다', () => {
    const search = outline.files[0]?.categories[1]?.categories[0]
    expect(search?.screens.map((screen) => screen.name)).toEqual(['시설 목록 화면', '시설 상세 화면'])
  })

  it('화면 흐름을 출발 화면 아래에 두고 대상 이름을 같은 문서에서 찾는다', () => {
    const list = outline.files[0]?.categories[1]?.categories[0]?.screens[0]
    expect(list?.paths).toHaveLength(1)
    expect(list?.paths[0]).toMatchObject({
      targetId: 'reservation.detail',
      targetName: '시설 상세 화면',
      elementId: 'open',
      label: '목록에서 하나 고름',
    })
  })

  it('분류에 없는 화면을 따로 모으고 줄 번호를 byte span 에서 구한다', () => {
    expect(outline.files[0]?.uncategorized.map((screen) => screen.name)).toEqual(['공지 화면'])
    expect(outline.files[0]?.uncategorized[0]?.location).toEqual({ path: '/예약.rspdl', line: 12 })
  })

  it('module 이 없는 파일은 오류 수와 함께 unparsed 로 돌려주고, 빈 파일은 뺀다', () => {
    expect(outline.unparsed).toEqual([{ path: '/깨진.rspdl', errorCount: 2 }])
    expect(outline.files.map((file) => file.path)).toEqual(['/예약.rspdl'])
  })

  it('원문이 없으면 위치를 비운다', () => {
    const withoutText = buildIaOutline(RESULT, new Map())
    expect(withoutText.files[0]?.categories[0]?.location).toBeNull()
  })

  it('알아볼 수 없는 결과는 recognized: false', () => {
    expect(buildIaOutline({ unexpected: true }, texts).recognized).toBe(false)
  })
})
