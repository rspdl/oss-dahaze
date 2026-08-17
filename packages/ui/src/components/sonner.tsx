"use client"

import type * as React from "react"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * 토스트 컨테이너.
 *
 * shadcn 기본 코드는 `next-themes` 의 `useTheme()` 로 테마를 읽는다. 그 의존을 걷어냈다 —
 * 공용 패키지가 앱의 테마 라이브러리를 알면 다른 앱에서 그대로 못 쓴다. 색은 아래처럼
 * design-system 토큰을 CSS 변수로 넘겨주므로, `.dark` 가 켜지면 토큰 값이 바뀌면서
 * 토스트도 함께 따라온다. 컴포넌트는 지금이 어느 테마인지 몰라도 된다.
 *
 * 아이콘을 명시하는 이유도 같다. 성공·경고·오류를 색으로만 구분하면 색각 이상 사용자에게는
 * 전부 같은 알림이 된다.
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--color-surface)",
          "--normal-text": "var(--color-text)",
          "--normal-border": "var(--color-border)",
          "--success-bg": "var(--color-surface)",
          "--success-text": "var(--color-text)",
          "--success-border": "var(--color-border)",
          "--info-bg": "var(--color-diagnostic-info-subtle)",
          "--info-text": "var(--color-text)",
          "--info-border": "var(--color-diagnostic-info)",
          "--warning-bg": "var(--color-diagnostic-warning-subtle)",
          "--warning-text": "var(--color-text)",
          "--warning-border": "var(--color-diagnostic-warning)",
          "--error-bg": "var(--color-diagnostic-error-subtle)",
          "--error-text": "var(--color-text)",
          "--error-border": "var(--color-diagnostic-error)",
          "--border-radius": "var(--radius-panel)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
