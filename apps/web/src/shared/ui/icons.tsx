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

export function PanelLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16" />
    </Base>
  )
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  )
}

export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Base>
  )
}

export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </Base>
  )
}

export function ArchiveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 6.5v1A1.5 1.5 0 0 1 19.5 9h-15A1.5 1.5 0 0 1 3 7.5Z" />
      <path d="M4.75 9v9a1.5 1.5 0 0 0 1.5 1.5h11.5a1.5 1.5 0 0 0 1.5-1.5V9" />
      <path d="M10 13h4" />
    </Base>
  )
}

/** 프로젝트 전환기의 열림 표시. 위아래 화살표가 "여기서 바꾼다" 를 말한다. */
export function ChevronsUpDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="m7 9 5-5 5 5" />
      <path d="m7 15 5 5 5-5" />
    </Base>
  )
}

export function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12 3.5 5 6v5.5c0 4 3 7.3 7 9 4-1.7 7-5 7-9V6Z" />
      <path d="m9.25 12 2 2 3.5-3.5" />
    </Base>
  )
}

export function PenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M16.5 4.5a2.12 2.12 0 0 1 3 3L8 19l-4 1 1-4Z" />
      <path d="m14.5 6.5 3 3" />
    </Base>
  )
}

/** 접힌 줄을 펼치는 표시. `PenIcon` 처럼 장식이고 뜻은 옆 글자가 나른다. */
export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </Base>
  )
}

export function TableIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Z" />
      <path d="M4 9.5h16" />
      <path d="M10 9.5V20" />
    </Base>
  )
}
