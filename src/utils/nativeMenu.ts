export type NativeMenuNode = {
  type?: string
  label?: string
  displayLabel?: string
  path?: string
  displayPath?: string
  commandId?: number
  guid?: string
  enabled?: boolean
  children?: NativeMenuNode[]
}

export type NativeMenuCommand = { commandId?: number; command?: string }
export type NativeMenuCommandKind = 'properties' | 'duplicates' | 'invalid'

function commandText(item: NativeMenuNode) {
  return [item.path, item.displayPath, item.label, item.displayLabel].filter(Boolean).join(' ').replaceAll('&', '').replace(/\.{3}|…/g, '').toLocaleLowerCase()
}

function matches(kind: NativeMenuCommandKind, text: string) {
  if (kind === 'properties') return !/raw\s+properties/.test(text) && /(?:\bproperties\b|属性)/.test(text)
  if (kind === 'duplicates') return /(?:remove|delete)\s+duplicates|(?:移除|删除).*重复/.test(text)
  return /(?:remove|delete)\s+(?:dead|invalid)|(?:移除|删除).*(?:无效|失效)/.test(text)
}

/** Resolves host commands by their localized labels, but dispatches their stable IDs. */
export function findNativeMenuCommand(items: readonly NativeMenuNode[] | undefined, kind: NativeMenuCommandKind): NativeMenuCommand | null {
  let nestedCandidate: NativeMenuCommand | null = null
  for (const item of items ?? []) {
    if (item.type === 'submenu') {
      const nested = findNativeMenuCommand(item.children, kind)
      if (!nestedCandidate) nestedCandidate = nested
      continue
    }
    const matched = kind === 'properties'
      ? [item.label, item.displayLabel].some(label => /^(?:properties|属性)$/.test((label ?? '').split('\t')[0]!.replaceAll('&', '').replace(/\.{3}|…/g, '').trim().toLocaleLowerCase()))
      : matches(kind, commandText(item))
    if (item.type !== 'command' || item.enabled === false || !matched) continue
    if (kind === 'properties' && item.commandId != null) return { commandId: item.commandId }
    if (kind !== 'properties' && (item.guid || item.path)) return { command: item.guid || item.path }
  }
  return nestedCandidate
}

export function findNativeTools(items: readonly NativeMenuNode[] | undefined): NativeMenuNode[] {
  for (const item of items ?? []) {
    if (item.type !== 'submenu') continue
    if ([item.label, item.displayLabel].some(label => /^(?:tools|utilities|工具|实用工具)$/i.test((label ?? '').replaceAll('&', '').trim()))) return item.children ?? []
    const nested = findNativeTools(item.children)
    if (nested.length) return nested
  }
  return []
}
