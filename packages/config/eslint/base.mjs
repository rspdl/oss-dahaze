import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * 워크스페이스 공통 lint 규칙.
 *
 * 여기 있는 규칙은 **자동으로 고칠 수 없는 실수**만 잡는 것을 목표로 한다. 포매팅은
 * 다투지 않는다 — 리뷰에서 사람의 주의를 쓰기에 아까운 대상이다.
 */
export const base = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_` 로 시작하면 의도적으로 쓰지 않는 것으로 본다.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // any 는 타입 시스템을 끄는 것이다. 정말 필요하면 이유를 주석으로 남기고 끈다.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/generated/**'],
  },
]

export default base
