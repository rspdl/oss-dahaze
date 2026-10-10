import { declaredElements, isContainer, type ContainerLayout, type DeclaredElement, type DesignNode, type ElementAppearance, type LayoutNode, type NodeStyle } from './layout-tree'
import type { MockupElement, MockupField, ScreenMockup } from './screen-layouts'

/**
 * 배치 트리를 React + Tailwind + shadcn/ui 코드로 옮긴다.
 *
 * `compose-code.ts` 와 같은 규칙을 따른다: 요소와 이름은 문서에 선언된 것만 쓰고, 값이나 동작은
 * 지어내지 않는다. 디자인 전용 노드에는 `{/* 디자인 전용 *\/}` 을 붙인다. 같은 트리는 늘 같은 코드를
 * 낸다. 컴포넌트는 shadcn/ui 의 기본 경로(`@/components/ui/*`)에서 가져온다고 본다.
 */
export function reactCode(screen: ScreenMockup, root: LayoutNode): string {
  const declared = declaredElements(screen)
  const used = new Set<string>()
  const body: string[] = []
  emit(root, null, 2, declared, body, used)
  const imports = IMPORTS.filter(([component]) => used.has(component)).map(([, line]) => line)
  return [
    ...imports,
    ...(imports.length === 0 ? [] : ['']),
    `export function ${componentName(screen)}() {`,
    '  return (',
    ...body,
    '  )',
    '}',
  ].join('\n')
}

const IMPORTS: [string, string][] = [
  ['Avatar', "import { Avatar, AvatarFallback } from '@/components/ui/avatar'"],
  ['Badge', "import { Badge } from '@/components/ui/badge'"],
  ['Button', "import { Button } from '@/components/ui/button'"],
  ['Card', "import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'"],
  ['Input', "import { Input } from '@/components/ui/input'"],
  ['Label', "import { Label } from '@/components/ui/label'"],
  ['Progress', "import { Progress } from '@/components/ui/progress'"],
  ['Select', "import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'"],
  ['Switch', "import { Switch } from '@/components/ui/switch'"],
  ['Table', "import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'"],
  ['Tabs', "import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'"],
]

function componentName(screen: ScreenMockup): string {
  const last = screen.screenId.split('.').at(-1) ?? 'screen'
  const pascal = last.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join('')
  const base = /^[A-Za-z]/.test(pascal) ? pascal : `Screen${pascal}`
  return base.endsWith('Screen') ? base : `${base}Screen`
}

const indent = (depth: number) => '  '.repeat(depth)
const text = (value: string) => value.replace(/[{}<>]/g, (char) => `{'${char}'}`)
const attr = (value: string) => JSON.stringify(value)

const JUSTIFY = { start: 'justify-start', center: 'justify-center', end: 'justify-end', 'space-between': 'justify-between' } as const
const ITEMS = { start: 'items-start', center: 'items-center', end: 'items-end' } as const
const FILL = { none: null, surface: 'bg-background', raised: 'bg-muted', gray: 'bg-muted-foreground/20', strong: 'bg-muted-foreground/40' } as const

/** Tailwind 간격은 4px 단위다. 나누어떨어지지 않으면 임의 값으로 쓴다. */
const space = (prefix: string, px: number) => (px === 0 ? null : px % 4 === 0 ? `${prefix}-${px / 4}` : `${prefix}-[${px}px]`)

function sizeClasses(style: NodeStyle, parent: ContainerLayout | null): string[] {
  const classes: string[] = []
  const row = parent?.direction === 'row'
  if (style.width === 'fill') classes.push(row ? 'flex-1' : 'w-full')
  else if (typeof style.width === 'number') classes.push(`w-[${style.width}px]`, 'shrink-0')
  if (style.height === 'fill') classes.push(row ? 'self-stretch' : 'flex-1')
  else if (typeof style.height === 'number') classes.push(`h-[${style.height}px]`)
  const fill = FILL[style.fill]
  if (fill !== null) classes.push(fill)
  if (style.border) classes.push('border', 'shadow-sm')
  if (style.radius > 0) classes.push(style.radius >= 12 ? 'rounded-xl' : style.radius >= 8 ? 'rounded-lg' : 'rounded-md')
  return classes
}

function layoutClasses(layout: ContainerLayout): string[] {
  const padding = layout.paddingX === layout.paddingY ? [space('p', layout.paddingX)] : [space('px', layout.paddingX), space('py', layout.paddingY)]
  if (layout.direction === 'box') return ['grid', '[&>*]:[grid-area:1/1]', ...padding].filter((value): value is string => value !== null)
  return [
    'flex',
    layout.direction === 'column' ? 'flex-col' : 'flex-row',
    layout.main === 'space-between' ? null : space('gap', layout.gap),
    layout.main === 'start' ? null : JUSTIFY[layout.main],
    layout.cross === 'start' ? null : ITEMS[layout.cross],
    ...padding,
  ].filter((value): value is string => value !== null)
}

const cls = (classes: string[]) => (classes.length === 0 ? '' : ` className=${attr(classes.join(' '))}`)

function emit(node: LayoutNode, parent: ContainerLayout | null, depth: number, declared: Map<string, DeclaredElement>, lines: string[], used: Set<string>): void {
  const pad = indent(depth)
  const entry = node.type === 'element' ? declared.get(node.ref) : undefined
  if (isContainer(node)) {
    const classes = [...sizeClasses(node.style, parent), ...layoutClasses(node.layout)]
    if (entry?.element.kind === 'form') {
      used.add('Card')
      lines.push(`${pad}<Card${cls(sizeClasses(node.style, parent).filter((value) => value !== 'border' && value !== 'shadow-sm'))}>`)
      lines.push(`${pad}  <CardContent${cls(layoutClasses(node.layout))}>`)
      for (const child of node.children) emit(child, node.layout, depth + 2, declared, lines, used)
      lines.push(`${pad}  </CardContent>`)
      lines.push(`${pad}</Card>`)
      return
    }
    const tag = entry?.element.kind === 'header' ? 'header' : entry?.element.kind === 'section' ? 'section' : 'div'
    lines.push(`${pad}<${tag}${cls(classes)}>`)
    for (const child of node.children) emit(child, node.layout, depth + 1, declared, lines, used)
    lines.push(`${pad}</${tag}>`)
    return
  }
  if (node.type === 'design') {
    for (const line of design(node, sizeClasses(node.style, parent), used)) lines.push(`${pad}${line}`)
    return
  }
  if (entry === undefined) return
  for (const line of leaf(entry.element, sizeClasses(node.style, parent), used, node.appearance)) lines.push(`${pad}${line}`)
}

const INPUT_TYPE = { text: 'text', number: 'number', date: 'date', time: 'time', datetime: 'datetime-local', select: 'text', checkbox: 'checkbox' } as const

function field(input: MockupField, id: string, classes: string[], used: Set<string>): string[] {
  used.add('Label')
  const label = `<Label htmlFor=${attr(id)}>${text(input.name)}${input.required ? ' *' : ''}</Label>`
  if (input.control === 'checkbox') {
    used.add('Switch')
    return [`<div${cls(['flex', 'items-center', 'gap-2', ...classes])}>`, `  <Switch id=${attr(id)} />`, `  ${label}`, '</div>']
  }
  if (input.control === 'select') {
    used.add('Select')
    return [
      `<div${cls(['grid', 'gap-2', ...classes])}>`,
      `  ${label}`,
      '  <Select>',
      `    <SelectTrigger id=${attr(id)}><SelectValue placeholder="선택하세요" /></SelectTrigger>`,
      '    <SelectContent>',
      ...(input.options ?? []).map((option) => `      <SelectItem value=${attr(option)}>${text(option)}</SelectItem>`),
      '    </SelectContent>',
      '  </Select>',
      '</div>',
    ]
  }
  used.add('Input')
  return [`<div${cls(['grid', 'gap-2', ...classes])}>`, `  ${label}`, `  <Input id=${attr(id)} type=${attr(INPUT_TYPE[input.control])}${input.required ? ' required' : ''} />`, '</div>']
}

const BUTTON_VARIANT = { primary: '', secondary: ' variant="outline"', ghost: ' variant="ghost"', link: ' variant="link"' } as const

function leaf(element: MockupElement, classes: string[], used: Set<string>, appearance?: ElementAppearance): string[] {
  switch (element.kind) {
    case 'heading':
      return [`<h2${cls(['text-xl', 'font-semibold', 'tracking-tight', ...classes])}>${text(element.text)}</h2>`]
    case 'button':
      used.add('Button')
      // 행동을 선언한 버튼이 주 버튼이다. 동작은 지어내지 않는다.
      return [`<Button${BUTTON_VARIANT[appearance === 'primary' || appearance === 'secondary' || appearance === 'ghost' || appearance === 'link' ? appearance : element.actionId === null ? 'secondary' : 'primary']}${cls(classes)}>${text(element.name)}</Button>${element.actionId === null ? '' : ` {/* ${element.actionId} */}`}`]
    case 'input':
      return field(element.field, element.id ?? element.field.id.split('.').at(-1) ?? 'field', classes, used)
    case 'list': {
      const rows = element.modelId.split('.').at(-1) ?? 'rows'
      const prop = (entry: MockupField) => `row.${entry.id.split('.').at(-1)}`
      const title = element.fields.find((entry) => entry.control === 'text') ?? element.fields[0]
      const rest = element.fields.filter((entry) => entry !== title)
      if (appearance === 'cards' && title !== undefined) {
        used.add('Card')
        return [
          `{/* ${element.modelName} 목록 · 카드 */}`,
          `<div${cls(['grid', 'gap-4', 'sm:grid-cols-2', 'lg:grid-cols-3', ...classes])}>`,
          `  {${rows}.map((row) => (`,
          '    <Card key={row.id}>',
          '      <CardHeader>',
          `        <CardTitle>{${prop(title)}}</CardTitle>`,
          '      </CardHeader>',
          '      <CardContent className="grid gap-1 text-sm">',
          ...rest.map((entry) => `        <div className="flex justify-between gap-4"><span className="text-muted-foreground">${text(entry.name)}</span><span>{${prop(entry)}}</span></div>`),
          '      </CardContent>',
          '    </Card>',
          '  ))}',
          '</div>',
        ]
      }
      if (appearance === 'list' && title !== undefined) {
        return [
          `{/* ${element.modelName} 목록 */}`,
          `<ul${cls(['divide-y', 'rounded-lg', 'border', ...classes])}>`,
          `  {${rows}.map((row) => (`,
          '    <li key={row.id} className="flex items-center gap-3 px-4 py-3">',
          `      <div className="flex-1"><p className="text-sm font-medium">{${prop(title)}}</p>${rest.length === 0 ? '' : `<p className="text-sm text-muted-foreground">${rest.map((entry) => `{${prop(entry)}}`).join(' · ')}</p>`}</div>`,
          '    </li>',
          '  ))}',
          '</ul>',
        ]
      }
      used.add('Table')
      return [
        `{/* ${element.modelName} 목록 */}`,
        `<Table${cls(classes)}>`,
        '  <TableHeader>',
        '    <TableRow>',
        ...element.fields.map((entry) => `      <TableHead${entry.control === 'number' ? ' className="text-right"' : ''}>${text(entry.name)}</TableHead>`),
        '    </TableRow>',
        '  </TableHeader>',
        '  <TableBody>',
        `    {${element.modelId.split('.').at(-1) ?? 'rows'}.map((row) => (`,
        '      <TableRow key={row.id}>',
        ...element.fields.map((entry) => `        <TableCell${entry.control === 'number' ? ' className="text-right"' : ''}>{row.${entry.id.split('.').at(-1)}}</TableCell>`),
        '      </TableRow>',
        '    ))}',
        '  </TableBody>',
        '</Table>',
      ]
    }
    case 'placeholder':
      return [`<div${cls(['flex', 'min-h-20', 'items-center', 'justify-center', 'rounded-lg', 'border', 'border-dashed', 'text-sm', 'text-muted-foreground', ...classes])}>${text(element.text)}</div>`]
    case 'unrecognized':
      return [`{/* 지원하지 않는 요소: ${element.rawKind} */}`]
    default:
      return []
  }
}

const TEXT = {
  display: ['text-4xl', 'font-bold', 'tracking-tight'],
  title: ['text-lg', 'font-semibold'],
  body: ['text-sm'],
  caption: ['text-xs'],
} as const
const TONE = { strong: 'text-foreground', default: 'text-foreground/80', muted: 'text-muted-foreground' } as const
const MARK = ' {/* 디자인 전용 */}'

function design(node: DesignNode, classes: string[], used: Set<string>): string[] {
  switch (node.design) {
    case 'text': {
      const tag = node.textStyle === 'display' ? 'h1' : node.textStyle === 'title' ? 'h3' : 'p'
      return [`<${tag}${cls([...TEXT[node.textStyle ?? 'body'], TONE[node.tone ?? 'default'], ...classes])}>${text(node.text ?? '')}</${tag}>${MARK}`]
    }
    case 'button':
      used.add('Button')
      return [`<Button${node.variant === 'secondary' ? ' variant="outline"' : node.variant === 'ghost' ? ' variant="ghost"' : ''}${cls(classes)}>${text(node.text ?? '')}</Button>${MARK}`]
    case 'image':
      return [`<div${cls(['bg-muted', ...classes])} aria-label=${attr(node.text ?? '이미지')} />${MARK}`]
    case 'rectangle':
      return [`<div${cls(classes)} />${MARK}`]
    case 'divider':
      return [`<hr${cls(['border-border', ...classes])} />${MARK}`]
    case 'spacer':
      return [`<div${cls(classes)} aria-hidden />${MARK}`]
    case 'badge':
      used.add('Badge')
      return [`<Badge${node.variant === 'primary' ? '' : node.variant === 'ghost' ? ' variant="outline"' : ' variant="secondary"'}${cls(classes)}>${text(node.text ?? '')}</Badge>${MARK}`]
    case 'avatar':
      used.add('Avatar')
      return [`<Avatar${cls(classes)}><AvatarFallback>${text((node.text ?? '').slice(0, 2))}</AvatarFallback></Avatar>${MARK}`]
    case 'icon':
      return [`<div${cls(['rounded-md', 'bg-muted', ...classes])} aria-label=${attr(node.text ?? '아이콘')} />${MARK}`]
    case 'stat':
      used.add('Card')
      return [
        `<Card${cls(classes.filter((value) => value !== 'border' && value !== 'shadow-sm'))}>${MARK}`,
        '  <CardHeader>',
        `    <CardDescription>${text(node.text ?? '')}</CardDescription>`,
        `    <CardTitle className="text-2xl">${text(node.value ?? '')}</CardTitle>`,
        '  </CardHeader>',
        '</Card>',
      ]
    case 'tabs': {
      used.add('Tabs')
      const tabs = (node.text ?? '').split(',').map((tab) => tab.trim()).filter(Boolean)
      return [
        `<Tabs defaultValue=${attr(tabs[0] ?? 'tab')}${cls(classes)}>${MARK}`,
        '  <TabsList>',
        ...tabs.map((tab) => `    <TabsTrigger value=${attr(tab)}>${text(tab)}</TabsTrigger>`),
        '  </TabsList>',
        '</Tabs>',
      ]
    }
    case 'progress':
      used.add('Progress')
      return [`<Progress value={${Number(node.value) || 0}}${cls(classes)} aria-label=${attr(node.text ?? '')} />${MARK}`]
    case 'search':
      used.add('Input')
      return [`<Input type="search" placeholder=${attr(node.text ?? '')}${cls(classes)} />${MARK}`]
  }
}
