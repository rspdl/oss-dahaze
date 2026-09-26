import type { ComponentPropsWithoutRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@dahaze/ui'

/*
 * AI 응답 같은 마크다운 문자열을 좁은 패널 폭에 맞춰 렌더한다.
 *
 * - raw HTML 은 렌더하지 않는다. rehype-raw 를 넣지 않았으므로 `<script>` 같은 태그는
 *   DOM 요소가 되지 않고 이스케이프한 글자로 보인다. `javascript:` 링크 주소는 react-markdown
 *   기본 urlTransform 이 지운다.
 * - 스트리밍 중인 partial 처럼 코드 펜스가 닫히지 않은 입력도 파서가 문서 끝까지를 코드 블록으로
 *   읽을 뿐 예외를 던지지 않는다.
 * - 코드 블록은 언어와 관계없이 등폭 글꼴로만 보여준다. `rspdl` 도 하이라이팅하지 않는다.
 */

const BLOCK = 'my-2 first:mt-0 last:mb-0'

function List({ ordered, className, ...props }: ComponentPropsWithoutRef<'ul'> & { ordered: boolean }) {
  // GFM 체크리스트는 체크박스가 마커 역할을 하므로 글머리표를 붙이지 않는다.
  const tasks = className?.includes('contains-task-list') === true
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag
      {...props}
      className={cn(
        BLOCK,
        'marker:text-text-subtle [li>&]:my-1',
        tasks ? 'list-none pl-1' : ordered ? 'list-decimal pl-5' : 'list-disc pl-5',
      )}
    />
  )
}

const components: Components = {
  h1: ({ node: _node, ...props }) => <h3 {...props} className={cn(BLOCK, 'mt-4 text-headline text-text')} />,
  h2: ({ node: _node, ...props }) => <h4 {...props} className={cn(BLOCK, 'mt-4 text-label text-text')} />,
  h3: ({ node: _node, ...props }) => <h5 {...props} className={cn(BLOCK, 'mt-3 text-body font-semibold text-text')} />,
  h4: ({ node: _node, ...props }) => <h6 {...props} className={cn(BLOCK, 'mt-3 text-body-sm font-semibold text-text')} />,
  h5: ({ node: _node, ...props }) => <h6 {...props} className={cn(BLOCK, 'text-body-sm font-semibold text-text-muted')} />,
  h6: ({ node: _node, ...props }) => <h6 {...props} className={cn(BLOCK, 'text-body-sm font-semibold text-text-muted')} />,
  p: ({ node: _node, ...props }) => <p {...props} className={BLOCK} />,
  ul: ({ node: _node, ...props }) => <List ordered={false} {...props} />,
  ol: ({ node: _node, ...props }) => <List ordered {...(props as ComponentPropsWithoutRef<'ul'>)} />,
  li: ({ node: _node, className, ...props }) => (
    <li {...props} className={cn('my-0.5 pl-0.5', className?.includes('task-list-item') === true && 'flex items-baseline gap-1.5')} />
  ),
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer"
      className="text-accent-text underline underline-offset-2 hover:no-underline"
    />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote {...props} className={cn(BLOCK, 'border-l-2 border-border-strong pl-3 text-text-muted')} />
  ),
  hr: ({ node: _node, ...props }) => <hr {...props} className="my-3 border-border" />,
  // 인라인 코드 스타일. 코드 블록 안의 <code> 는 아래 `pre` 가 이 스타일을 되돌린다.
  code: ({ node: _node, ...props }) => (
    <code
      {...props}
      className={cn(props.className, 'rounded-xs bg-surface-raised px-1 py-px font-mono text-[0.9em] text-text')}
    />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre
      {...props}
      className={cn(
        BLOCK,
        'overflow-x-auto rounded-control border border-border bg-canvas-subtle px-3 py-2.5 font-mono text-body-sm text-text',
        '[&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]',
      )}
    />
  ),
  table: ({ node: _node, ...props }) => (
    <div className={cn(BLOCK, 'overflow-x-auto rounded-control border border-border')}>
      <table {...props} className="w-full border-collapse text-body-sm" />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead {...props} className="bg-surface-raised" />,
  tr: ({ node: _node, ...props }) => <tr {...props} className="border-b border-border last:border-b-0" />,
  th: ({ node: _node, ...props }) => (
    <th {...props} className="px-2.5 py-1.5 text-left font-semibold whitespace-nowrap text-text" />
  ),
  td: ({ node: _node, ...props }) => <td {...props} className="px-2.5 py-1.5 align-top text-text" />,
  input: ({ node: _node, ...props }) => <input {...props} className="translate-y-px accent-accent" />,
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('min-w-0 text-body break-words text-text', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
