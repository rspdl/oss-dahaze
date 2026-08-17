#!/usr/bin/env node
/**
 * 프론트엔드 패키지 경계를 검사한다.
 *
 * ADR-0006 이 정한 규칙이 주석으로만 있으면 무너진다. `check_boundaries.py` 가 API 쪽에서
 * 하는 일을 여기서 한다.
 *
 * 규칙:
 *
 * 1. `packages/ui` 와 `packages/rspdl-editor` 는 `@dahaze/api-client` 를 import 하지 않는다.
 *    공용 컴포넌트가 서버 계약을 알면 재사용이 불가능해지고, 계약이 바뀔 때 함께 깨진다.
 *    데이터는 props 로 받는다.
 * 2. zustand 스토어는 `@dahaze/api-client` 를 import 하지 않는다. 서버 상태는 TanStack Query
 *    가 소유한다. 같은 데이터가 두 곳에 있으면 어느 쪽이 진실인지 알 수 없게 된다.
 * 3. `apps/web/src/app` 은 얇게 유지한다. 라우트 파일에서 직접 데이터를 가져오지 않는다.
 *
 * 사용:
 *     node scripts/check_web_boundaries.mjs
 */

import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const API_CLIENT = '@dahaze/api-client'

/** 검사 대상. `dir` 아래의 소스에 `forbidden` 이 나타나면 위반. */
const RULES = [
  {
    dir: 'packages/ui/src',
    forbidden: [API_CLIENT],
    why: '공용 컴포넌트는 서버 계약을 몰라야 한다. 데이터는 props 로 받는다 (ADR-0006).',
  },
  {
    dir: 'packages/rspdl-editor/src',
    forbidden: [API_CLIENT],
    why: '에디터는 문서를 가져오지 않는다. 텍스트와 진단을 props 로 받는다 (ADR-0006).',
  },
]

/** 파일 이름이 스토어임을 드러내는 경우 규칙 2를 적용한다. */
const STORE_PATTERN = /(^|[.\-/])store\.tsx?$|-store\.tsx?$|\/stores\//

const SOURCE_PATTERN = /\.(ts|tsx)$/
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'generated', '.turbo'])

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // 아직 만들어지지 않은 디렉터리는 위반이 아니다.
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full)
    } else if (SOURCE_PATTERN.test(entry.name)) {
      yield full
    }
  }
}

/** import 문에 나타나는 모듈 지정자만 뽑는다. 문자열 리터럴 전부를 보면 오탐이 난다. */
function importedModules(source) {
  const found = []
  const patterns = [
    /import\s[^'"]*from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      found.push(match[1])
    }
  }
  return found
}

function violatesForbidden(specifier, forbidden) {
  return forbidden.some((f) => specifier === f || specifier.startsWith(`${f}/`))
}

async function main() {
  const violations = []
  let checked = 0

  for (const rule of RULES) {
    for await (const file of walk(join(ROOT, rule.dir))) {
      checked += 1
      const source = readFileSync(file, 'utf8')
      for (const specifier of importedModules(source)) {
        if (violatesForbidden(specifier, rule.forbidden)) {
          violations.push(`${relative(ROOT, file)}: \`${specifier}\` — ${rule.why}`)
        }
      }
    }
  }

  // 규칙 2 — 어디에 있든 스토어 파일이면 검사한다.
  for await (const file of walk(join(ROOT, 'apps/web/src'))) {
    checked += 1
    const relativePath = relative(ROOT, file)
    if (!STORE_PATTERN.test(relativePath)) continue
    const source = readFileSync(file, 'utf8')
    for (const specifier of importedModules(source)) {
      if (violatesForbidden(specifier, [API_CLIENT])) {
        violations.push(
          `${relativePath}: \`${specifier}\` — 서버 상태는 TanStack Query 가 소유한다. ` +
            'zustand 에 복사하면 진실이 둘로 갈린다 (ADR-0006).',
        )
      }
    }
  }

  if (violations.length > 0) {
    console.error(`프론트 경계 위반 ${violations.length}건:\n`)
    for (const violation of violations) console.error(`  ${violation}`)
    console.error('\n규칙은 docs/adr/0006-frontend-architecture.md 에 있다.')
    process.exit(1)
  }

  console.log(`프론트 경계 검사 통과 (${checked}개 파일)`)
}

await main()
