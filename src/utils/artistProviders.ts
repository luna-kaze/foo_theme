import { reactive } from 'vue'
import { fb } from 'foo-webview-sdk'

const configKey = 'foo-theme.artist-services.v1'
export const artistServiceSettings = reactive({ autoApple: true, storefront: 'cn', lastfmApiKey: '', loaded: false })
let settingsRequest: Promise<void> | null = null
export function loadArtistServiceSettings() {
  if (artistServiceSettings.loaded) return Promise.resolve()
  if (settingsRequest) return settingsRequest
  settingsRequest = (async () => {
    try {
      const response = await fb.config.get(configKey)
      const value = response.value as { autoApple?: boolean; storefront?: string; lastfmApiKey?: string } | null
      if (value && typeof value === 'object') {
        if (typeof value.autoApple === 'boolean') artistServiceSettings.autoApple = value.autoApple
        if (['cn', 'jp', 'us', 'gb', 'hk', 'tw'].includes(value.storefront ?? '')) artistServiceSettings.storefront = value.storefront!
        if (typeof value.lastfmApiKey === 'string') artistServiceSettings.lastfmApiKey = value.lastfmApiKey
      }
    } catch { /* Optional settings are independent of native portraits. */ }
    artistServiceSettings.loaded = true
  })().finally(() => { settingsRequest = null })
  return settingsRequest
}
export async function saveArtistServiceSettings(settings: { autoApple: boolean; storefront: string; lastfmApiKey: string }) {
  const key = settings.lastfmApiKey.trim()
  if (key && !/^[a-f0-9]{32}$/i.test(key)) throw new Error('Last.fm API key 应为 32 位十六进制字符。')
  const saved = await fb.config.set(configKey, { autoApple: settings.autoApple, storefront: settings.storefront, lastfmApiKey: key })
  if (saved.success === false) throw new Error('未能保存资料源设置。')
  Object.assign(artistServiceSettings, settings, { lastfmApiKey: key, loaded: true })
}

async function responseBody(url: string, accept: string) {
  const response = await fb.http.request(url, { timeout: 9000, headers: { Accept: accept, 'User-Agent': 'foo-theme/0.1.0 (artist information)' } })
  if (response.success === false || response.status !== 200 || !response.body) throw new Error('资料源暂不可用，请稍后重试。')
  return response.body
}
function text(value: string) {
  const element = document.createElement('textarea')
  element.innerHTML = value.replace(/<[^>]*>/g, '')
  return element.value.trim()
}
function nameKey(value: string) { return value.normalize('NFKC').trim().toLocaleLowerCase() }
export function cleanArtistBiography(value: string) {
  const content = text(value).replace(/Read more on Last\.fm[\s\S]*$/i, '').trim()
  if (!content || content.length < 500 && /(?:在\s*Apple\s*Music.*(?:畅听|聆听|收听|暢聽|聆聽|收聽)|(?:listen to|listen|discover|explore).*\bon apple music\b|查找.*热门歌曲.*专辑|apple\s*music(?:で|の|に).*(?:聴|聞|人気|アルバム))/i.test(content)) return ''
  return content
}

export interface AppleArtistCandidate { id: string; name: string; url: string; genre: string; storefront: string }
export interface AppleArtistResult {
  status: 'ready' | 'missing' | 'ambiguous'
  id: string; name: string; url: string; image: string; biography: string; storefront: string
  candidates: AppleArtistCandidate[]
}

export function appleArtistLink(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !['music.apple.com', 'itunes.apple.com'].includes(parsed.hostname)) return null
    const id = parsed.pathname.match(/\/artist\/(?:[^/]+\/)?(?:id)?(\d+)(?:\/|$)/)?.[1]
    const country = parsed.pathname.split('/')[1]
    if (!id || !/^[a-z]{2}$/.test(country)) return null
    return { id, storefront: country, url: `https://music.apple.com/${country}/artist/${id}` }
  } catch { return null }
}
export function parseAppleArtistPage(html: string, id: string) {
  // Parse data only. Never execute page scripts or import their player token.
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      const data = JSON.parse(match[1])
      const records = Array.isArray(data) ? data : Array.isArray(data?.['@graph']) ? data['@graph'] : [data]
      for (const record of records) {
        if (!['MusicGroup', 'Person'].includes(record?.['@type']) || typeof record.name !== 'string') continue
        const linked = typeof record.url === 'string' ? appleArtistLink(record.url) : null
        if (linked?.id !== id) continue
        const image = typeof record.image === 'string' ? record.image : record.image?.url
        if (typeof image !== 'string') continue
        const parsed = new URL(image)
        if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.mzstatic.com')) continue
        return { name: record.name as string, image, biography: typeof record.description === 'string' ? cleanArtistBiography(record.description) : '' }
      }
    } catch { /* Ignore unrelated structured-data blocks. */ }
  }
  return null
}

let searchQueue: Promise<unknown> = Promise.resolve()
let nextSearch = 0
function searchApple(name: string, storefront: string) {
  const task = searchQueue.catch(() => {}).then(async () => {
    const delay = Math.max(0, nextSearch - Date.now())
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    nextSearch = Date.now() + 3100
    const query = new URLSearchParams({ term: name, media: 'music', entity: 'musicArtist', country: storefront, limit: '12' })
    const response = JSON.parse(await responseBody(`https://itunes.apple.com/search?${query}`, 'application/json')) as { results?: Array<{ artistId?: number; artistName?: string; artistLinkUrl?: string; primaryGenreName?: string }> }
    return (Array.isArray(response.results) ? response.results : []).flatMap((artist): AppleArtistCandidate[] => {
      if (!artist.artistId || !artist.artistName) return []
      return [{ id: String(artist.artistId), name: artist.artistName, url: `https://music.apple.com/${storefront}/artist/${artist.artistId}`, genre: artist.primaryGenreName ?? '', storefront }]
    })
  })
  searchQueue = task
  return task
}
export async function fetchAppleArtist(names: string[], explicitUrl = ''): Promise<AppleArtistResult> {
  const empty: AppleArtistResult = { status: 'missing', id: '', name: '', url: '', image: '', biography: '', storefront: '', candidates: [] }
  let linked = explicitUrl ? appleArtistLink(explicitUrl) : null
  if (explicitUrl && !linked) throw new Error('请输入 Apple Music 的艺术家页面链接。')
  if (!linked) {
    const countries = [...new Set([artistServiceSettings.storefront, 'jp', 'us'])]
    const matches = new Set(names.filter(Boolean).map(nameKey))
    let encountered: AppleArtistCandidate[] = []
    for (const country of countries) {
      const artists = await searchApple(names[0], country)
      const exact = artists.filter((artist) => matches.has(nameKey(artist.name)))
      if (exact.length > 1) return { ...empty, status: 'ambiguous', candidates: exact }
      if (exact.length === 1) { linked = appleArtistLink(exact[0].url); break }
      if (!encountered.length) encountered = artists
    }
    if (!linked) return { ...empty, status: encountered.length ? 'ambiguous' : 'missing', candidates: encountered.slice(0, 8) }
  }
  if (!linked) return empty
  let reachedPage = false
  let failure: unknown
  for (const country of [...new Set([linked.storefront, 'jp', 'us'])]) {
    const url = `https://music.apple.com/${country}/artist/${linked.id}`
    try {
      const html = await responseBody(url, 'text/html')
      reachedPage = true
      const record = parseAppleArtistPage(html, linked.id)
      if (record) return { status: 'ready', ...record, id: linked.id, url, storefront: country, candidates: [] }
    } catch (error) { failure = error }
  }
  if (!reachedPage && failure) throw failure
  return { ...empty, id: linked.id, url: linked.url, storefront: linked.storefront }
}

export async function searchAppleArtistCandidates(name: string) {
  const found = new Map<string, AppleArtistCandidate>()
  let failure: unknown
  for (const country of [...new Set([artistServiceSettings.storefront, 'jp', 'us'])]) {
    try { for (const candidate of await searchApple(name, country)) if (!found.has(candidate.id)) found.set(candidate.id, candidate) }
    catch (error) { failure = error }
    if (found.size >= 8) break
  }
  if (!found.size && failure) throw failure
  return [...found.values()].sort((a, b) => Number(nameKey(b.name) === nameKey(name)) - Number(nameKey(a.name) === nameKey(name))).slice(0, 12)
}

export async function downloadArtistImage(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !(parsed.hostname.endsWith('.mzstatic.com') || parsed.hostname === 'upload.wikimedia.org')) throw new Error('图片地址不属于支持的艺术家图片源。')
  const response = await fb.http.request(url, { responseType: 'base64', timeout: 9000 })
  const mime = Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1]?.split(';')[0]?.trim()
  if (response.status !== 200 || !response.body || !mime || !/^image\/(jpeg|png|webp|avif)$/.test(mime) || response.body.length > 5_000_000) throw new Error('艺术家图片下载失败或格式不支持。')
  return `data:${mime};base64,${response.body}`
}

export interface LastFmArtistResult { biography: string; language: string; tags: string[]; similar: Array<{ name: string; url: string }>; listeners: number; playcount: number; url: string }
export async function fetchLastFmArtist(name: string, mbid: string, apiKey: string): Promise<LastFmArtistResult> {
  let result: LastFmArtistResult = { biography: '', language: '', tags: [], similar: [], listeners: 0, playcount: 0, url: '' }
  for (const language of ['zh', 'en']) {
    const query = new URLSearchParams({ method: 'artist.getInfo', api_key: apiKey, format: 'json', lang: language, autocorrect: '0' })
    query.set(mbid ? 'mbid' : 'artist', mbid || name)
    const response = JSON.parse(await responseBody(`https://ws.audioscrobbler.com/2.0/?${query}`, 'application/json')) as {
      error?: number; artist?: { name?: string; mbid?: string; url?: string; bio?: { content?: string; summary?: string }; tags?: { tag?: Array<{ name: string }> }; similar?: { artist?: Array<{ name: string; url: string }> }; stats?: { listeners?: string; playcount?: string } }
    }
    if (response.error) throw new Error(response.error === 10 || response.error === 26 ? 'Last.fm API key 无效或已停用。' : 'Last.fm 资料暂不可用。')
    const artist = response.artist
    if (!artist || (mbid && artist.mbid && artist.mbid !== mbid) || (!mbid && nameKey(artist.name ?? '') !== nameKey(name))) throw new Error('Last.fm 返回的艺术家身份不匹配。')
    const biography = cleanArtistBiography(artist.bio?.content || artist.bio?.summary || '')
    const safeUrl = artist.url?.startsWith('https://www.last.fm/music/') ? artist.url : `https://www.last.fm/music/${encodeURIComponent(artist.name || name)}`
    result = {
      biography, language,
      tags: artist.tags?.tag?.map((tag) => tag.name).filter(Boolean).slice(0, 8) ?? [],
      similar: artist.similar?.artist?.filter((item) => typeof item.name === 'string').map((item) => ({ name: item.name, url: `https://www.last.fm/music/${encodeURIComponent(item.name)}` })).slice(0, 8) ?? [],
      listeners: Number(artist.stats?.listeners) || 0, playcount: Number(artist.stats?.playcount) || 0, url: safeUrl,
    }
    if (biography) break
  }
  return result
}
