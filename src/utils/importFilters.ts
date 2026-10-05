import { reactive } from 'vue'
import fb from 'foo-webview-sdk'

export const defaultImportExclusions = 'lrc srt ass ssa vtt lyrics txt nfo log ini db jpg jpeg png webp gif bmp tif tiff ico avif heic pdf url lnk'
const descriptorSuffixes = new Set(['cue', 'm3u', 'm3u8', 'pls', 'fpl', 'asx'])
const fallbackAudio = new Set('aac ac3 aif aiff alac amr ape au dff dsf dts flac m4a m4b m4p mp1 mp2 mp3 mp4 mpc oga ogg opus ofr ofs spx tak tta wav wave wma wv mod xm it s3m mid midi'.split(' '))
const configKey = 'foo-theme.import-filters.v1'
export function parseImportExclusions(input: string | string[]) {
  const tokens = (Array.isArray(input) ? input.join(' ') : input).split(/[\s,;，；]+/).filter(Boolean)
  const normalized = tokens.map(token => token.trim().toLowerCase().replace(/^\*?\./, ''))
  if (normalized.some(token => !/^[a-z0-9][a-z0-9_+-]*$/.test(token))) throw new Error('后缀请使用 lrc、.lrc 或 *.lrc 格式，以空格、逗号或分号分隔。')
  return [...new Set(normalized)]
}
export const importFilterSettings = reactive({ excluded: parseImportExclusions(defaultImportExclusions) })
let loaded = false, loading: Promise<void> | null = null
let formats: Promise<string[]> | null = null
export async function loadImportFilters(connected = true) {
  if (loaded) return
  if (loading) return loading
  loading = (async () => {
    let value: unknown
    try { value = JSON.parse(globalThis.localStorage?.getItem(configKey) || 'null') } catch { /* Host config is authoritative. */ }
    if (connected) { const result = await fb.config.get(configKey); if (result.value != null) value = result.value }
    const saved = value && typeof value === 'object' ? (value as { excluded?: unknown }).excluded : null
    if (Array.isArray(saved) && saved.every(item => typeof item === 'string')) importFilterSettings.excluded = parseImportExclusions(saved)
    loaded = true
  })().finally(() => { loading = null })
  return loading
}
export async function saveImportFilters(text: string) {
  const excluded = parseImportExclusions(text)
  const result = await fb.config.set(configKey, { excluded })
  if (!result.success) throw new Error(result.error || '无法保存导入过滤设置。')
  importFilterSettings.excluded = excluded; loaded = true
  try { globalThis.localStorage?.setItem(configKey, JSON.stringify({ excluded })) } catch { /* Saved in host config. */ }
}
export function importSuffix(path: string) {
  const plain = path.replace(/\|subsong:\d+$/i, '').split(/[?#]/)[0]!.replaceAll('\\', '/')
  return plain.split('/').at(-1)?.match(/\.([^.]+)$/)?.[1]?.toLowerCase() || ''
}
export function isExcludedImport(path: string) { return importFilterSettings.excluded.includes(importSuffix(path)) }

async function inputMasks() {
  formats ??= (async () => {
    try {
      const result = await fb.discovery?.getInputFormats()
      return result?.fileTypes?.flatMap(type => type.mask.split(/[;|,]+/).map(mask => mask.trim().toLowerCase())) ?? []
    } catch { return [] }
  })()
  return formats
}
/** Reject sidecars BEFORE native path parsing can create metadata handles for them. */
export async function filterImportCandidates(paths: string[]) {
  await loadImportFilters()
  const masks = await inputMasks()
  const audioSuffixes = new Set(masks.flatMap(mask => mask.match(/^\*\.([a-z0-9_+-]+)$/)?.[1] ?? []))
  return paths.filter(path => {
    if (isExcludedImport(path)) return false
    const suffix = importSuffix(path)
    return descriptorSuffixes.has(suffix) || (audioSuffixes.size ? audioSuffixes.has(suffix) : fallbackAudio.has(suffix))
  })
}
