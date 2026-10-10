import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Markdown } from './markdown'

function render(text: string) {
  return renderToStaticMarkup(<Markdown>{text}</Markdown>)
}

describe('Markdown', () => {
  it('글머리표 목록과 번호 목록을 각각 ul·ol 로 렌더한다', () => {
    const html = render('- 가\n- 나\n  - 나-1\n\n1. 첫째\n2. 둘째')

    expect(html).toMatch(/<ul class="[^"]*list-disc[^"]*">\s*<li[^>]*>가<\/li>/)
    expect(html).toMatch(/<ol class="[^"]*list-decimal[^"]*">\s*<li[^>]*>첫째<\/li>/)
    // 중첩 목록은 li 안에 ul 로 들어간다
    expect(html).toMatch(/<li[^>]*>나\s*<ul/)
  })

  it('인라인 코드와 코드 블록을 구분하고, 코드 블록 원문을 그대로 둔다', () => {
    const html = render('`x` 값\n\n```rspdl\nentity 주문 {\n  id: ID\n}\n```')

    expect(html).toMatch(/<p[^>]*><code class="[^"]*font-mono[^"]*">x<\/code> 값<\/p>/)
    expect(html).toMatch(/<pre class="[^"]*overflow-x-auto[^"]*font-mono[^"]*"><code class="language-rspdl/)
    expect(html).toContain('entity 주문 {\n  id: ID\n}')
  })

  it('GFM 표를 가로 스크롤 영역 안에 렌더한다', () => {
    const html = render('| 이름 | 값 |\n| --- | --- |\n| a | 1 |')

    expect(html).toMatch(/<div class="[^"]*overflow-x-auto[^"]*"><table/)
    expect(html).toContain('<th')
    expect(html).toMatch(/<td[^>]*>1<\/td>/)
  })

  it('링크는 새 탭으로 열고 referrer 를 보내지 않는다', () => {
    const html = render('[문서](https://example.com/a)')

    expect(html).toContain('href="https://example.com/a"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer"')
  })

  it('javascript: 링크의 주소를 지운다', () => {
    const html = render('[눌러](javascript:alert(1))')

    expect(html).not.toContain('javascript:')
  })

  it('raw HTML 을 요소로 만들지 않고 이스케이프한 글자로 보여준다', () => {
    const html = render('앞 <script>alert(1)</script> <img src=x onerror="alert(1)"> 뒤\n\n<div onclick="x()">블록</div>')

    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<div onclick')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('닫히지 않은 코드 펜스도 예외 없이 문서 끝까지 코드 블록으로 렌더한다', () => {
    const html = render('설명\n\n```rspdl\nentity 주문 {\n  id')

    expect(html).toContain('<pre')
    expect(html).toContain('entity 주문 {\n  id')
  })

  it('닫히지 않은 표·강조·링크 조각도 예외 없이 렌더한다', () => {
    for (const partial of ['| a | b |\n| --', '**굵', '[링크](https://exa', '- ', '> ', '1.', '```']) {
      expect(() => render(partial)).not.toThrow()
    }
  })
})
