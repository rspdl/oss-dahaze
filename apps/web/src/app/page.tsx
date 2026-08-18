import { LandingScreen } from '@/features/auth/landing-screen'

/** 라우트는 feature 를 조립만 한다. 로직은 `src/features/` 에 있다 (ADR-0006). */
export default function HomePage() {
  return <LandingScreen />
}
