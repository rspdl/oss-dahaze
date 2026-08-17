import { base } from '@dahaze/config/eslint/base.mjs'
import next from 'eslint-config-next'

// eslint-config-next 는 flat config 배열을 그대로 내보낸다. 함수로 호출하지 않는다.
export default [
  ...base,
  ...next,
  {
    settings: {
      // pnpm 은 node_modules 를 격리하므로 eslint-plugin-react 가 React 버전을
      // 자동으로 찾지 못하고 죽는다. 버전을 직접 알려준다.
      react: { version: '19.2' },
    },
  },
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
]
