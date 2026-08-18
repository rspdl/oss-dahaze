'use client'

import { useEffect, useState } from 'react'

/**
 * 값이 `delayMs` 동안 조용해진 뒤에야 따라오는 사본.
 *
 * 편집기 자동 컴파일 때문에 있다. 서버에서 진짜 solver 가 도는 작업이라 타자 한 번마다
 * 부르면 안 된다 — 사용자는 느려진 것만 느끼고, 그 사이 요청 대부분은 다음 타자 때문에
 * 쓸모없어진다.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
