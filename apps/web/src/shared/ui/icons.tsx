/**
 * 화면에서 쓰는 아이콘.
 *
 * `packages/ui` 는 lucide-react 를 의존하지만 pnpm 이 node_modules 를 격리하므로 `apps/web`
 * 에서는 그 패키지를 그대로 import 할 수 없다. 아이콘 몇 개 때문에 앱에 의존성을 하나 더
 * 들이는 대신 필요한 것만 인라인 SVG 로 둔다.
 *
 * 전부 장식이다. 의미는 항상 옆의 글자가 나른다 — 아이콘만으로 뜻을 전달하지 않는다.
 */
import type { SVGProps } from 'react'

function Base(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  )
}

export function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.6.8l.8 1.05a2 2 0 0 0 1.6.8H19a2 2 0 0 1 2 2v7.35a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Base>
  )
}

export function FileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </Base>
  )
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Base>
  )
}

export function SparkleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9Z" />
      <path d="M18.5 3v3M20 4.5h-3" />
    </Base>
  )
}

export function SpinnerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props} className={`animate-spin ${props.className ?? ''}`}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </Base>
  )
}
