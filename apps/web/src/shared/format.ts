/**
 * 서버가 주는 시각은 ISO 8601 UTC 문자열이다. 사용자에게는 자기 시간대로 보여야 한다.
 *
 * `Intl` 을 쓰되 로케일을 `ko-KR` 로 고정한다. 브라우저 로케일을 따르면 서버 렌더와 클라이언트
 * 렌더가 달라져 하이드레이션이 어긋난다 — 시간대까지는 어쩔 수 없지만 형식은 고정할 수 있다.
 */
const DATE_TIME = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return DATE_TIME.format(date)
}
