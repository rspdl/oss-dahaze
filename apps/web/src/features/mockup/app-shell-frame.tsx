'use client'

import type { ReactNode } from 'react'
import { cn } from '@dahaze/ui'

import type { AppShellGroup, AppShellItem, AppShellModel } from './app-shell'

/**
 * 화면 내용을 관리 도구 같은 앱 틀 안에 그린다: 왼쪽 메뉴, 위쪽 경로·주소, 사용 역할.
 *
 * 화면은 PC 화면만 그리므로 왼쪽 메뉴를 늘 펼친다. `popup` 화면은
 * 앱을 흐리게 깔고 그 위에 창으로 띄운다. 체험 모드에서는 메뉴 항목을 눌러 그 화면으로 간다.
 *
 * 틀은 편집 대상이 아니다. 배치 편집기의 노드 표시(`data-node-key`)는 내용 쪽에만 있다.
 */
export function AppShellFrame({
  shell,
  interactive,
  onNavigate,
  children,
}: {
  shell: AppShellModel
  interactive: boolean
  onNavigate?: (screenKey: string) => void
  children: ReactNode
}) {
  const popup = shell.kind === 'popup'
  const navigate = interactive ? onNavigate : undefined
  const content = popup ? (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 p-6">
      <div role="dialog" aria-label={shell.breadcrumb.at(-1)} className="flex max-h-full w-full max-w-xl flex-col overflow-hidden border" style={{ borderColor: 'var(--wf-border-strong)', background: 'var(--wf-background)', borderRadius: 'var(--wf-radius-lg)', boxShadow: 'var(--wf-shadow-lg)' }}>
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4" style={{ borderColor: 'var(--wf-border)' }}>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{shell.breadcrumb.at(-1)}</span>
          <span aria-hidden className="text-sm" style={{ color: 'var(--wf-subtle-foreground)' }}>×</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
      </div>
    </div>
  ) : children

  return (
    <div className="flex size-full min-h-0" style={{ background: 'var(--wf-background)', color: 'var(--wf-foreground)' }}>
      {(
        <aside aria-label="앱 메뉴" className="flex w-52 shrink-0 flex-col border-r" style={{ borderColor: 'var(--wf-border)', background: 'color-mix(in srgb, var(--wf-muted) 50%, transparent)' }}>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4" style={{ borderColor: 'var(--wf-border)' }}>
            <span aria-hidden className="flex size-6 items-center justify-center rounded text-[10px] font-bold" style={{ background: 'var(--wf-primary)', color: 'var(--wf-primary-foreground)' }}>{shell.appName.slice(0, 1)}</span>
            <span className="min-w-0 truncate text-[13px] font-semibold">{shell.appName}</span>
          </div>
          <nav className="min-h-0 flex-1 overflow-hidden px-2 py-3">
            {shell.items.length === 0 ? null : <ul className="mb-3 space-y-0.5">{shell.items.map((item) => <NavItem key={item.screenKey} item={item} onNavigate={navigate} />)}</ul>}
            {shell.groups.map((group) => <NavGroup key={group.key} group={group} depth={0} onNavigate={navigate} />)}
          </nav>
          {shell.roleNames.length === 0 ? null : (
            <div className="flex h-12 shrink-0 items-center gap-2 border-t px-4" style={{ borderColor: 'var(--wf-border)' }}>
              <span aria-hidden className="size-6 shrink-0 rounded-full" style={{ background: 'var(--wf-border-strong)' }} />
              <span className="min-w-0 truncate text-[11px]" style={{ color: 'var(--wf-muted-foreground)' }}>{shell.roleNames.join(' · ')}</span>
            </div>
          )}
        </aside>
      )}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4" style={{ borderColor: 'var(--wf-border)', background: 'var(--wf-background)' }}>
          <ol aria-label="위치" className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px]" style={{ color: 'var(--wf-subtle-foreground)' }}>
            {shell.breadcrumb.map((name, index, all) => (
              <li key={`${index}:${name}`} className={cn('flex min-w-0 items-center gap-1.5', index === all.length - 1 && 'font-semibold')} style={index === all.length - 1 ? { color: 'var(--wf-foreground)' } : undefined}>
                {index === 0 ? null : <span aria-hidden>/</span>}
                <span className="truncate">{name}</span>
              </li>
            ))}
          </ol>
          {<span className="max-w-[45%] shrink-0 truncate rounded border px-2 py-0.5 font-mono text-[10px]" style={{ borderColor: 'var(--wf-border)', background: 'var(--wf-muted)', color: 'var(--wf-subtle-foreground)' }}>{shell.route}</span>}
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">{content}</div>
      </div>
    </div>
  )
}

function NavGroup({ group, depth, onNavigate }: { group: AppShellGroup; depth: number; onNavigate?: (screenKey: string) => void }) {
  return (
    <div className={cn(depth === 0 ? 'mb-3' : 'mt-1 ml-2')}>
      <p style={{ color: 'var(--wf-subtle-foreground)' }} className={cn('truncate px-2 pb-1', depth === 0 ? 'text-[10px] font-semibold tracking-wide' : 'text-[10px]')}>{group.name}</p>
      <ul className="space-y-0.5">
        {group.items.map((item) => <NavItem key={item.screenKey} item={item} onNavigate={onNavigate} />)}
      </ul>
      {group.groups.map((child) => <NavGroup key={child.key} group={child} depth={depth + 1} onNavigate={onNavigate} />)}
    </div>
  )
}

function NavItem({ item, onNavigate }: { item: AppShellItem; onNavigate?: (screenKey: string) => void }) {
  const className = cn(
    'flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[12px]',
    item.current && 'font-semibold',
    onNavigate !== undefined && !item.current && 'hover:opacity-80',
  )
  const active = !item.current ? { color: 'var(--wf-muted-foreground)' } : { background: 'var(--wf-accent)', color: 'var(--wf-accent-foreground)', borderRadius: 'var(--wf-radius-md)' }
  const label = <><span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: item.current ? 'currentColor' : 'var(--wf-border-strong)' }} /><span className="min-w-0 truncate">{item.name}</span></>
  return (
    <li>
      {onNavigate === undefined
        ? <span className={className} style={active} aria-current={item.current ? 'page' : undefined}>{label}</span>
        : <button type="button" className={className} style={active} aria-current={item.current ? 'page' : undefined} title={item.route} onClick={(event) => { event.stopPropagation(); onNavigate(item.screenKey) }}>{label}</button>}
    </li>
  )
}
