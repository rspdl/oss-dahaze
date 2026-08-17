import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 조건부 클래스를 합치고 Tailwind 충돌을 해소한다.
 *
 * shadcn 이 생성하는 컴포넌트가 이 이름을 기대하므로 (`components.json` 의 `utils` alias)
 * 시그니처를 바꾸지 않는다.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
