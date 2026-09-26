import type { TreeEntryResponse, TreeFileResponse } from '@dahaze/api-client'

/**
 * 작업 트리 목록(`GET /tree`)은 전체 경로를 가진 평평한 목록이다. 화면은 폴더 안에 자식이
 * 들어간 트리로 그린다. 그 변환과 경로 계산을 여기 모은다.
 *
 * 경로는 `/` 로 시작하고 `/` 로 구분한다. 서버가 정한 규칙이고 여기서 정규화하지 않는다.
 */

export type ChangeKind = 'add' | 'modify' | 'move' | 'delete'

export interface TreeNode {
  path: string
  name: string
  kind: 'folder' | 'file'
  change: ChangeKind | null
  lockedBy: string | null
  /** 폴더만. 폴더가 먼저, 같은 종류끼리는 이름 순. */
  children: TreeNode[]
}

export function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

/** 부모 폴더 경로. 루트 바로 아래 항목의 부모는 `/` 다. */
export function parentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

export function joinPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`
}

/** `path` 가 `folder` 자신이거나 그 아래에 있는지. */
export function isWithin(path: string, folder: string): boolean {
  if (folder === '/') return true
  return path === folder || path.startsWith(`${folder}/`)
}

const collator = new Intl.Collator('ko-KR', { numeric: true })

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return collator.compare(a.name, b.name)
  })
  for (const node of nodes) sortNodes(node.children)
}

/**
 * 평평한 목록을 트리로 바꾼다.
 *
 * 목록에 부모 폴더가 빠진 항목이 와도 버리지 않는다. 중간 폴더를 만들어 붙인다 — 화면에서
 * 파일이 사라지는 것보다 폴더가 하나 더 보이는 편이 덜 해롭다.
 */
export function buildTree(entries: readonly TreeEntryResponse[]): TreeNode[] {
  const byPath = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  const ensureFolder = (path: string): TreeNode | null => {
    if (path === '/') return null
    const existing = byPath.get(path)
    if (existing !== undefined) return existing
    const node: TreeNode = {
      path,
      name: basename(path),
      kind: 'folder',
      change: null,
      lockedBy: null,
      children: [],
    }
    byPath.set(path, node)
    attach(node)
    return node
  }

  const attach = (node: TreeNode) => {
    const parent = ensureFolder(parentPath(node.path))
    if (parent === null) roots.push(node)
    else parent.children.push(node)
  }

  // 폴더를 먼저 넣어야 파일이 붙을 자리가 중간 폴더로 대신 만들어지지 않는다.
  const ordered = [...entries].sort((a, b) =>
    a.kind === b.kind ? a.path.length - b.path.length : a.kind === 'folder' ? -1 : 1,
  )

  for (const entry of ordered) {
    if (entry.path === '/' || byPath.has(entry.path)) continue
    const node: TreeNode = {
      path: entry.path,
      name: basename(entry.path),
      kind: entry.kind,
      change: entry.change ?? null,
      lockedBy: entry.locked_by ?? null,
      children: [],
    }
    byPath.set(entry.path, node)
    attach(node)
  }

  sortNodes(roots)
  return roots
}

/** 트리를 위에서부터 펼친 순서. 키보드 이동과 "모두 펼치기" 에 쓴다. */
export function flattenVisible(
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
): { node: TreeNode; depth: number }[] {
  const rows: { node: TreeNode; depth: number }[] = []
  for (const node of nodes) {
    rows.push({ node, depth })
    if (node.kind === 'folder' && expanded.has(node.path)) {
      rows.push(...flattenVisible(node.children, expanded, depth + 1))
    }
  }
  return rows
}

/** 변경 종류를 한 글자와 사람이 읽을 이름으로. 색만으로 구분하지 않게 글자를 함께 쓴다. */
export const CHANGE_LABEL: Record<ChangeKind, { letter: string; label: string }> = {
  add: { letter: 'A', label: '새 파일' },
  modify: { letter: 'M', label: '수정' },
  move: { letter: 'R', label: '이동' },
  delete: { letter: 'D', label: '삭제' },
}

/**
 * 잠금 보유자 문자열을 사람이 읽을 말로. 서버 형식은 `session:<id>`(앱 AI 대화)와
 * `mcp:<userId>`(외부 MCP 클라이언트)다. 모르는 형식은 그대로 보여준다.
 */
export function describeHolder(holder: string): string {
  if (holder.startsWith('session:')) return 'AI 대화'
  if (holder.startsWith('mcp:')) return 'MCP 클라이언트'
  return holder
}

/** 잠금 보유자가 이 앱 AI 대화 세션인지. */
export function holderSessionId(holder: string): string | null {
  return holder.startsWith('session:') ? holder.slice('session:'.length) : null
}

/**
 * commit 할 때 넘길 경로. 옮기거나 지운 파일은 서버가 옛 경로로도 받지만, 목록에서 보이는
 * 경로(작업 트리 경로)를 그대로 쓴다. 지운 파일의 작업 트리 경로는 옛 경로다.
 */
export function changeDisplayPath(file: TreeFileResponse): string {
  return file.change === 'delete' ? (file.committed_path ?? file.path) : file.path
}
