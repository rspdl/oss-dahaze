import { declaredElements, isContainer, type ContainerLayout, type DeclaredElement, type DesignNode, type ElementAppearance, type LayoutNode, type NodeStyle } from './layout-tree'
import type { MockupElement, ScreenMockup } from './screen-layouts'

/**
 * 배치 트리를 Jetpack Compose 코드로 옮긴다.
 *
 * 요소와 이름은 문서에 선언된 것만 쓴다. 값이나 동작은 지어내지 않고 빈 람다와 주석으로 남긴다.
 * 디자인 전용 노드는 줄 끝에 `// 디자인 전용` 을 붙여 문서에서 온 것과 구분한다.
 * 같은 트리는 늘 같은 코드를 낸다.
 */
export function composeCode(screen: ScreenMockup, root: LayoutNode): string {
  const declared = declaredElements(screen)
  const lines: string[] = [
    '@Composable',
    `fun ${functionName(screen)}() {`,
  ]
  emit(root, null, 1, declared, lines)
  lines.push('}')
  return lines.join('\n')
}

function functionName(screen: ScreenMockup): string {
  const last = screen.screenId.split('.').at(-1) ?? 'screen'
  const pascal = last.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join('')
  const base = /^[A-Za-z]/.test(pascal) ? pascal : `Screen${pascal}`
  return base.endsWith('Screen') ? base : `${base}Screen`
}

const indent = (depth: number) => '    '.repeat(depth)
const quote = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`

function modifier(style: NodeStyle, parent: ContainerLayout | null, layout?: ContainerLayout): string {
  const parts: string[] = []
  if (style.width === 'fill') parts.push(parent?.direction === 'row' ? 'weight(1f)' : 'fillMaxWidth()')
  else if (typeof style.width === 'number') parts.push(`width(${style.width}.dp)`)
  if (style.height === 'fill') parts.push(parent?.direction === 'column' ? 'weight(1f)' : 'fillMaxHeight()')
  else if (typeof style.height === 'number') parts.push(`height(${style.height}.dp)`)
  const fillWidth = parts.indexOf('fillMaxWidth()')
  const fillHeight = parts.indexOf('fillMaxHeight()')
  if (fillWidth !== -1 && fillHeight !== -1) parts.splice(0, parts.length, 'fillMaxSize()', ...parts.filter((part) => part !== 'fillMaxWidth()' && part !== 'fillMaxHeight()'))
  const shape = style.radius > 0 ? `RoundedCornerShape(${style.radius}.dp)` : null
  if (style.fill !== 'none') {
    const color = style.fill === 'surface' ? 'surface' : style.fill === 'raised' ? 'surfaceVariant' : style.fill === 'gray' ? 'outlineVariant' : 'outline'
    parts.push(`background(MaterialTheme.colorScheme.${color}${shape === null ? '' : `, ${shape}`})`)
  }
  if (style.border) parts.push(`border(1.dp, MaterialTheme.colorScheme.outlineVariant${shape === null ? '' : `, ${shape}`})`)
  if (layout !== undefined && (layout.paddingX > 0 || layout.paddingY > 0)) {
    parts.push(layout.paddingX === layout.paddingY ? `padding(${layout.paddingX}.dp)` : `padding(horizontal = ${layout.paddingX}.dp, vertical = ${layout.paddingY}.dp)`)
  }
  return parts.length === 0 ? 'Modifier' : `Modifier.${parts.join('.')}`
}

function arrangement(layout: ContainerLayout): string | null {
  const vertical = layout.direction === 'column'
  if (layout.main === 'space-between') return 'Arrangement.SpaceBetween'
  const align = layout.main === 'start' ? null : vertical ? (layout.main === 'center' ? 'Alignment.CenterVertically' : 'Alignment.Bottom') : (layout.main === 'center' ? 'Alignment.CenterHorizontally' : 'Alignment.End')
  if (layout.gap === 0 && align === null) return null
  return align === null ? `Arrangement.spacedBy(${layout.gap}.dp)` : `Arrangement.spacedBy(${layout.gap}.dp, ${align})`
}

function crossAlignment(layout: ContainerLayout): string | null {
  if (layout.cross === 'start') return null
  if (layout.direction === 'column') return layout.cross === 'center' ? 'Alignment.CenterHorizontally' : 'Alignment.End'
  return layout.cross === 'center' ? 'Alignment.CenterVertically' : 'Alignment.Bottom'
}

function boxAlignment(layout: ContainerLayout): string | null {
  const vertical = layout.main === 'center' ? 'Center' : layout.main === 'end' ? 'Bottom' : 'Top'
  const horizontal = layout.cross === 'center' ? 'Center' : layout.cross === 'end' ? 'End' : 'Start'
  if (vertical === 'Top' && horizontal === 'Start') return null
  if (vertical === 'Center' && horizontal === 'Center') return 'Alignment.Center'
  return `Alignment.${vertical}${horizontal}`
}

function emit(node: LayoutNode, parent: ContainerLayout | null, depth: number, declared: Map<string, DeclaredElement>, lines: string[]): void {
  const pad = indent(depth)
  const entry = node.type === 'element' ? declared.get(node.ref) : undefined
  if (isContainer(node)) {
    const layout = node.layout
    const name = layout.direction === 'column' ? 'Column' : layout.direction === 'row' ? 'Row' : 'Box'
    const args = [`modifier = ${modifier(node.style, parent, layout)}`]
    if (layout.direction === 'box') {
      const align = boxAlignment(layout)
      if (align !== null) args.push(`contentAlignment = ${align}`)
    } else {
      const main = arrangement(layout)
      const cross = crossAlignment(layout)
      if (main !== null) args.push(`${layout.direction === 'column' ? 'verticalArrangement' : 'horizontalArrangement'} = ${main}`)
      if (cross !== null) args.push(`${layout.direction === 'column' ? 'horizontalAlignment' : 'verticalAlignment'} = ${cross}`)
    }
    if (entry !== undefined) lines.push(`${pad}// ${entry.element.kind === 'header' ? '머리글' : entry.element.kind === 'form' ? '입력 그룹' : '영역'}`)
    lines.push(`${pad}${name}(`)
    for (const arg of args) lines.push(`${pad}    ${arg},`)
    lines.push(`${pad}) {`)
    for (const child of node.children) emit(child, layout, depth + 1, declared, lines)
    lines.push(`${pad}}`)
    return
  }
  if (node.type === 'design') {
    for (const line of design(node, modifier(node.style, parent), parent)) lines.push(`${pad}${line}`)
    return
  }
  if (entry === undefined) return
  for (const line of leaf(entry.element, modifier(node.style, parent), node.appearance)) lines.push(`${pad}${line}`)
}

function leaf(element: MockupElement, mod: string, appearance?: ElementAppearance): string[] {
  const withModifier = mod === 'Modifier' ? '' : `, modifier = ${mod}`
  switch (element.kind) {
    case 'heading':
      return [`Text(${quote(element.text)}, style = MaterialTheme.typography.titleMedium${withModifier})`]
    case 'button': {
      const variant = appearance === 'primary' || appearance === 'secondary' || appearance === 'ghost' || appearance === 'link' ? appearance : element.actionId === null ? 'secondary' : 'primary'
      const name = variant === 'secondary' ? 'OutlinedButton' : variant === 'primary' ? 'Button' : 'TextButton'
      return [`${name}(onClick = { /* ${element.actionId ?? '행동 미선언'} */ }${withModifier}) {`, `    Text(${quote(element.name)})`, '}']
    }
    case 'input': {
      const field = element.field
      const label = `${field.name}${field.required ? ' *' : ''}`
      if (field.control === 'checkbox') return [`Row(${mod === 'Modifier' ? '' : `modifier = ${mod}, `}verticalAlignment = Alignment.CenterVertically) {`, '    Checkbox(checked = false, onCheckedChange = {})', `    Text(${quote(label)})`, '}']
      const lines = [`OutlinedTextField(value = "", onValueChange = {}, label = { Text(${quote(label)}) }${withModifier})`]
      if (field.control === 'select' && field.options !== null && field.options.length > 0) lines.unshift(`// 선택지: ${field.options.join(', ')}`)
      return lines
    }
    case 'list':
      if (appearance === 'cards') {
        return [
          `// ${element.modelName} 목록 · 카드`,
          `LazyVerticalGrid(columns = GridCells.Adaptive(200.dp)${withModifier}) {`,
          `    items(${element.modelId.split('.').at(-1) ?? 'items'}) { item ->`,
          '        Card { Column(Modifier.padding(16.dp)) {',
          ...element.fields.map((field, index) => `            Text(item.${field.id.split('.').at(-1)}.toString()${index === 0 ? ', style = MaterialTheme.typography.titleMedium' : ''}) // ${field.name}`),
          '        } }',
          '    }',
          '}',
        ]
      }
      if (appearance === 'list') {
        return [
          `// ${element.modelName} 목록`,
          `LazyColumn(${mod === 'Modifier' ? '' : `modifier = ${mod}`}) {`,
          `    items(${element.modelId.split('.').at(-1) ?? 'items'}) { item ->`,
          `        ListItem(headlineContent = { Text(item.${element.fields[0]?.id.split('.').at(-1) ?? 'id'}.toString()) }${element.fields.length > 1 ? `, supportingContent = { Text(item.${element.fields[1]!.id.split('.').at(-1)}.toString()) }` : ''})`,
          '    }',
          '}',
        ]
      }
      return [
        `// ${element.modelName} 목록`,
        `LazyColumn(${mod === 'Modifier' ? '' : `modifier = ${mod}`}) {`,
        `    items(${element.modelId.split('.').at(-1) ?? 'items'}) { item ->`,
        '        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {',
        ...element.fields.map((field) => `            Text(item.${field.id.split('.').at(-1)}.toString()) // ${field.name}`),
        '        }',
        '    }',
        '}',
      ]
    case 'placeholder':
      return [`Box(${mod === 'Modifier' ? 'modifier = Modifier.height(80.dp)' : `modifier = ${mod}`}, contentAlignment = Alignment.Center) {`, `    Text(${quote(element.text)})`, '}']
    case 'unrecognized':
      return [`// 지원하지 않는 요소: ${element.rawKind}`]
    default:
      return []
  }
}

const TEXT_STYLE = { display: 'displaySmall', title: 'titleMedium', body: 'bodyMedium', caption: 'bodySmall' } as const
const TEXT_COLOR = { strong: 'onSurface', default: 'onSurfaceVariant', muted: 'outline' } as const

function design(node: DesignNode, mod: string, parent: ContainerLayout | null): string[] {
  const withModifier = mod === 'Modifier' ? '' : `, modifier = ${mod}`
  const mark = ' // 디자인 전용'
  switch (node.design) {
    case 'text':
      return [`Text(${quote(node.text ?? '')}, style = MaterialTheme.typography.${TEXT_STYLE[node.textStyle ?? 'body']}, color = MaterialTheme.colorScheme.${TEXT_COLOR[node.tone ?? 'default']}${withModifier})${mark}`]
    case 'rectangle':
      return [`Box(modifier = ${mod})${mark}`]
    case 'divider':
      return [parent?.direction === 'row' ? `VerticalDivider()${mark}` : `HorizontalDivider(${mod === 'Modifier' || mod === 'Modifier.fillMaxWidth()' ? '' : `modifier = ${mod}`})${mark}`]
    case 'spacer':
      return [`Spacer(modifier = ${mod})${mark}`]
    case 'image':
      return [`// ${node.text ?? '이미지'}`, `Box(modifier = ${mod === 'Modifier' ? 'Modifier.fillMaxWidth().height(200.dp)' : mod}.background(MaterialTheme.colorScheme.surfaceVariant))${mark}`]
    case 'button': {
      const name = node.variant === 'secondary' ? 'OutlinedButton' : node.variant === 'ghost' ? 'TextButton' : 'Button'
      return [`${name}(onClick = {}${withModifier}) { Text(${quote(node.text ?? '')}) }${mark}`]
    }
    case 'badge':
      return [`SuggestionChip(onClick = {}, label = { Text(${quote(node.text ?? '')}) }${withModifier})${mark}`]
    case 'avatar':
      return [`Box(modifier = ${mod === 'Modifier' ? 'Modifier.size(40.dp)' : mod}.clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) { Text(${quote((node.text ?? '').slice(0, 2))}) }${mark}`]
    case 'icon':
      return [`Icon(Icons.Outlined.Image, contentDescription = ${quote(node.text ?? '')}${withModifier})${mark}`]
    case 'stat':
      return [`Card(${mod === 'Modifier' ? '' : `modifier = ${mod}`}) {${mark}`, '    Column(Modifier.padding(16.dp)) {', `        Text(${quote(node.text ?? '')}, style = MaterialTheme.typography.labelMedium)`, `        Text(${quote(node.value ?? '')}, style = MaterialTheme.typography.headlineSmall)`, '    }', '}']
    case 'tabs': {
      const tabs = (node.text ?? '').split(',').map((tab) => tab.trim()).filter(Boolean)
      return [`TabRow(selectedTabIndex = 0${withModifier}) {${mark}`, ...tabs.map((tab, index) => `    Tab(selected = ${index === 0}, onClick = {}, text = { Text(${quote(tab)}) })`), '}']
    }
    case 'progress':
      return [`LinearProgressIndicator(progress = { ${(Number(node.value) || 0) / 100}f }${withModifier})${mark}`]
    case 'search':
      return [`OutlinedTextField(value = "", onValueChange = {}, placeholder = { Text(${quote(node.text ?? '')}) }, leadingIcon = { Icon(Icons.Default.Search, null) }${withModifier})${mark}`]
  }
}
