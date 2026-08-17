/**
 * 생성된 엔드포인트 모듈을 모아 src/generated/endpoints/index.ts 를 만든다.
 *
 * orval 은 tags-split 모드에서 엔드포인트 barrel 을 만들어 주지 않는다. 이걸 손으로
 * 관리하면 FastAPI 에 새 태그가 생길 때마다 조용히 빠진다 — 실제로 auth·workspace 태그가
 * 그렇게 빠져서 프론트가 useListProjects 를 import 할 수 없었다.
 *
 * 열거를 사람이 하지 않게 만드는 것이 이 스크립트의 목적이다.
 */
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ENDPOINTS = new URL('../src/generated/endpoints/', import.meta.url).pathname

const tags = readdirSync(ENDPOINTS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const body = [
  '// 이 파일은 생성물이다. scripts/write-barrel.mjs 가 만든다. 손으로 고치지 않는다.',
  ...tags.map((tag) => `export * from './${tag}/${tag}'`),
  '',
].join('\n')

writeFileSync(join(ENDPOINTS, 'index.ts'), body)
console.log(`endpoints barrel: ${tags.length} tags (${tags.join(', ')})`)
