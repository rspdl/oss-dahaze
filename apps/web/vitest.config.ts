import { defineConfig } from 'vitest/config'

export default defineConfig({
  // tsconfig 의 `jsx: "preserve"` 는 JSX 변환을 Next 에 맡기는 설정이다. vitest 가 이 값을 읽으면
  // classic 변환(React.createElement)을 써서 `React is not defined` 로 실패하므로, 테스트에서는
  // automatic 런타임으로 변환한다.
  esbuild: { jsx: 'automatic' },
})
