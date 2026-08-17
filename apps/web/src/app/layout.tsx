import type { Metadata } from 'next'

import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'dahaze',
  description: 'RSPDL 저작·검증 워크스페이스',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // RSPDL 은 한국어 우선 언어다. 문서 언어를 ko 로 선언해야 스크린리더가 올바른 음성으로
  // 읽고, 브라우저가 한국어 줄바꿈 규칙을 적용한다.
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
