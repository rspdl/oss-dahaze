"use client"

import type * as React from "react"
import {
  ErrorIcon,
  InfoIcon,
  SpinnerIcon,
  SuccessIcon,
  WarningIcon,
} from "./icons"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * 토스트 컨테이너.
 *
 * shadcn 기본 코드는 `next-themes` 의 `useTheme()` 로 테마를 읽는다. 그 의존을 걷어냈다 —
 * 공용 패키지가 앱의 테마 라이브러리를 알면 다른 앱에서 그대로 못 쓴다. 색은 아래처럼
 * design-system 토큰(jwdesign `--jw-*`)을 CSS 변수로 넘겨주므로, `.dark` 가 켜지면 토큰 값이 바뀌면서
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
        success: <SuccessIcon />,
        info: <InfoIcon />,
        warning: <WarningIcon />,
        error: <ErrorIcon />,
        loading: <SpinnerIcon />,
      }}
      style={
        {
          // jwdesign 토스트: 반전 면(짙은 바탕 + 밝은 글자). 테마가 바뀌면 함께 뒤집힌다.
          "--normal-bg": "var(--jw-surface-inverse)",
          "--normal-text": "var(--jw-text-inverse)",
          "--normal-border": "transparent",
          "--success-bg": "var(--jw-success-soft)",
          "--success-text": "var(--jw-text-primary)",
          "--success-border": "transparent",
          "--info-bg": "var(--jw-info-soft)",
          "--info-text": "var(--jw-text-primary)",
          "--info-border": "transparent",
          "--warning-bg": "var(--jw-warning-soft)",
          "--warning-text": "var(--jw-text-primary)",
          "--warning-border": "transparent",
          "--error-bg": "var(--jw-danger-soft)",
          "--error-text": "var(--jw-text-primary)",
          "--error-border": "transparent",
          "--border-radius": "var(--jw-radius-lg)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
