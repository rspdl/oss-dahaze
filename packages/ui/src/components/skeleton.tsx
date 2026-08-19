import { cn } from "../lib/cn"

/**
 * 아직 오지 않은 내용의 자리.
 *
 * 자리를 실제 내용과 **같은 크기로** 잡아 두는 것이 이 컴포넌트의 전부다. 크기가 다르면
 * 내용이 도착하는 순간 화면이 튀고, 사용자는 자기가 방금 누르려던 것을 놓친다.
 *
 * 깜빡임(`animate-pulse`) 대신 빛이 한 방향으로 지나가게 한다. 깜빡이는 회색 덩어리는
 * "고장" 처럼 보이지만, 한 방향으로 흐르는 빛은 "오는 중" 으로 읽힌다. 움직이는 것은
 * 가상 요소의 `transform` 하나뿐이라 스크롤 중에도 레이아웃을 다시 계산하지 않는다.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        "relative isolate overflow-hidden rounded-control bg-surface-raised",
        "after:absolute after:inset-y-0 after:-left-full after:w-full after:animate-shimmer after:content-['']",
        "after:bg-[linear-gradient(90deg,transparent,var(--color-shimmer),transparent)]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
