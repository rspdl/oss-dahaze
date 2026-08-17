/**
 * Tailwind v4 는 PostCSS 플러그인 하나로 동작한다. tailwind.config.js 는 없다 —
 * 테마는 packages/design-system/src/theme.css 가 소유한다 (ADR-0006).
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
