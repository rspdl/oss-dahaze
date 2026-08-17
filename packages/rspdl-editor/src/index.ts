/**
 * RSPDL 편집기 패키지.
 *
 * 소유하는 것: CodeMirror RSPDL 언어 모드, 진단 표시, 그리고 **바이트 오프셋 변환**.
 * 소유하지 않는 것: 문서 저장·불러오기, API 호출, 진단의 해석 (ADR-0006).
 *
 * `spanToRange` 계열을 밖으로 내보내는 이유는 하나다. 진단 목록·패널도 같은 변환이
 * 필요한데, `apps/web` 이 자기 버전을 다시 쓰기 시작하면 두 곳이 서로 다르게 틀린다.
 * 변환은 이 패키지 하나가 소유한다.
 */

export { RspdlEditor, type RspdlEditorProps } from './editor'

export {
  highestSeverity,
  toCodeMirrorDiagnostics,
  type RspdlDiagnostic,
  type RspdlSeverity,
  type ToCodeMirrorOptions,
} from './diagnostics'

export {
  rspdl,
  rspdlHighlightStyle,
  rspdlLanguage,
  rspdlStreamParser,
} from './language'

export {
  byteOffsetToIndex,
  spanToLineColumn,
  spanToRange,
  type ByteSpan,
  type TextRange,
} from './offsets'
