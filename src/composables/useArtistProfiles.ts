import { reactive } from 'vue'
import { fb } from 'foo-webview-sdk'
import type { DisplayTrack } from '../types/music'
import { playablePath } from '../utils/track'

export interface ArtistCandidate {
  id: string; name: string; country?: string; type?: string; disambiguation?: string; score?: number
  aliases?: Array<{ name: string }>
}
export interface ArtistProfile {
  name: string
  status: 'idle' | 'loading' | 'ready' | 'ambiguous' | 'error'
  localImage: string; onlineImage: string; manualImage: string
  mbid: string; manualIdentity: boolean; canonicalName: string
  localIdentityMismatch: boolean
  biography: string; country: string; type: string; years: string; genres: string[]
  sourceUrl: string; imageSourceUrl: string; imageCredit: string; imageLicense: string
  candidates: ArtistCandidate[]; message: string; updatedAt: number; revision: number
}

type Context = { connected: () => boolean; tracks: () => DisplayTrack[] }
const profiles = reactive(new Map<string, ArtistProfile>())
const localRequests = new Map<string, Promise<ArtistProfile>>()
const onlineRequests = new Map<string, Promise<ArtistProfile>>()
const localChecked = new Set<string>()
let context: Context | null = null
let cacheDirectory: Promise<string> | null = null
let indexedTracks: DisplayTrack[] | null = null
let samples = new Map<string, DisplayTrack[]>()
let mbQueue: Promise<unknown> = Promise.resolve()
let nextMbRequest = 0

export function configureArtistProfiles(next: Context) { context = next }
export function artistProfilesConnected() { return context?.connected() ?? false }
function artistKey(name: string) { return name.normalize('NFKC').trim().toLocaleLowerCase() }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function getArtistProfile(name: string): ArtistProfile {
  const key = artistKey(name)
  if (!profiles.has(key)) profiles.set(key, {
    name, status: 'idle', localImage: '', onlineImage: '', manualImage: '', mbid: '', manualIdentity: false,
    localIdentityMismatch: false,
    canonicalName: '', biography: '', country: '', type: '', years: '', genres: [],
    sourceUrl: '', imageSourceUrl: '', imageCredit: '', imageLicense: '', candidates: [], message: '', updatedAt: 0, revision: 0,
  })
  return profiles.get(key)!
}
export function artistPortraitUrl(profile: ArtistProfile) { return profile.manualImage || (!profile.localIdentityMismatch && profile.localImage) || profile.onlineImage }
export function artistPortraitSource(profile: ArtistProfile) {
  return profile.manualImage ? '手动照片' : !profile.localIdentityMismatch && profile.localImage ? '本地艺术家图片' : profile.onlineImage ? 'Wikimedia Commons' : '尚无艺术家照片'
}

function sampleTracks(name: string) {
  const tracks = context?.tracks() ?? []
  if (tracks !== indexedTracks) {
    indexedTracks = tracks
    samples = new Map()
    for (const track of tracks) {
      for (const label of new Set([track.artist, track.albumArtist].filter(Boolean))) {
        const key = artistKey(label!)
        const existing = samples.get(key) ?? []
        if (existing.length < 3 && !existing.some((item) => item.album === track.album && item.albumArtist === track.albumArtist)) {
          existing.push(track)
          samples.set(key, existing)
        }
      }
    }
  }
  return samples.get(artistKey(name)) ?? []
}

function filename(name: string) {
  let a = 2166136261, b = 0x9e3779b9
  for (const char of artistKey(name)) {
    a = Math.imul(a ^ char.codePointAt(0)!, 16777619)
    b = Math.imul(b ^ char.codePointAt(0)!, 2246822519)
  }
  return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}.json`
}
async function cachePath(name: string) {
  cacheDirectory ??= (async () => {
    const { path } = await fb.misc.getProfilePath()
    const root = `${path.replace(/[\\/]+$/, '')}\\foo-theme`
    if (!(await fb.file.exists(root)).exists) await fb.file.mkdir(root)
    const directory = `${root}\\artist-cache`
    if (!(await fb.file.exists(directory)).exists) await fb.file.mkdir(directory)
    return directory
  })().catch((error) => { cacheDirectory = null; throw error })
  return `${await cacheDirectory}\\${filename(name)}`
}
async function saveProfile(profile: ArtistProfile) {
  if (!artistProfilesConnected()) return
  try {
    const { status: _status, revision: _revision, ...record } = profile
    await fb.file.write(await cachePath(profile.name), JSON.stringify({ version: 1, ...record }), { encoding: 'utf-8' })
  } catch { /* Optional disk cache must not prevent artwork or metadata display. */ }
}

export function ensureLocalArtistProfile(name: string, force = false): Promise<ArtistProfile> {
  const profile = getArtistProfile(name)
  const key = artistKey(name)
  if (!artistProfilesConnected() || localChecked.has(key) && !force) return Promise.resolve(profile)
  const pending = localRequests.get(key)
  if (pending) return pending
  const request = (async () => {
    if (!localChecked.has(key)) {
      try {
        const path = await cachePath(name)
        if ((await fb.file.exists(path)).exists) {
          const saved = JSON.parse((await fb.file.read(path, { encoding: 'utf-8' })).content) as Partial<ArtistProfile> & { version?: number }
          if (saved.version === 1 && saved.name && artistKey(saved.name) === key) {
            for (const field of ['onlineImage', 'manualImage', 'canonicalName', 'biography', 'country', 'type', 'years', 'sourceUrl', 'imageSourceUrl', 'imageCredit', 'imageLicense'] as const) {
              if (typeof saved[field] === 'string') profile[field] = saved[field]!
            }
            if (saved.mbid && uuid.test(saved.mbid)) profile.mbid = saved.mbid
            profile.manualIdentity = saved.manualIdentity === true
            profile.localIdentityMismatch = saved.localIdentityMismatch === true
            profile.updatedAt = Number(saved.updatedAt) || 0
            profile.genres = Array.isArray(saved.genres) ? saved.genres.filter((item) => typeof item === 'string') : []
          }
        }
      } catch { /* First use or damaged cache: resolve locally again. */ }
    }
    const tracks = sampleTracks(name)
    if (tracks.length) {
      try {
        const result = await fb.artwork.getFb2kUrlByPathBatch(tracks.map(playablePath), { type: 'artist', maxSize: 512 })
        profile.localImage = result.artworks.find((image) => image.available && image.dataUrl)?.dataUrl ?? ''
      } catch { profile.localImage = '' }
    }
    localChecked.add(key)
    profile.revision += 1
    return profile
  })().finally(() => localRequests.delete(key))
  localRequests.set(key, request)
  return request
}

async function jsonRequest<T>(url: string): Promise<T> {
  const response = await fb.http.request(url, { timeout: 9000, headers: { Accept: 'application/json', 'User-Agent': 'foo-theme/0.1.0 (foobar2000 artist metadata)' } })
  if (response.success === false || !response.status || response.status < 200 || response.status >= 300 || !response.body) {
    throw new Error(response.status === 429 || response.status === 503 ? '资料服务繁忙，请稍后重试。' : '无法获取在线资料，请检查网络后重试。')
  }
  return JSON.parse(response.body) as T
}
function musicBrainz<T>(path: string) {
  const request = mbQueue.catch(() => {}).then(async () => {
    const delay = Math.max(0, nextMbRequest - Date.now())
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    nextMbRequest = Date.now() + 1100
    return jsonRequest<T>(`https://musicbrainz.org/ws/2/${path}`)
  })
  mbQueue = request
  return request
}
function plainText(value: string) {
  const text = document.createElement('textarea')
  text.innerHTML = value.replace(/<[^>]*>/g, '')
  return text.value.trim()
}

async function taggedArtistIds(name: string) {
  const tracks = sampleTracks(name)
  if (!tracks.length) return []
  try {
    const fields = await fb.titleformat.evalFieldsBatch(tracks.map(playablePath), {
      artistId: '$meta(musicbrainz_artistid)', albumArtistId: '$meta(musicbrainz_albumartistid)',
    })
    const ids = new Set<string>()
    fields.results.forEach((result, index) => {
      const track = tracks[index]
      const value = track && artistKey(track.artist || '') === artistKey(name) ? result.artistId : result.albumArtistId
      if (typeof value === 'string') value.split(/[;,\s]+/).filter((id) => uuid.test(id)).forEach((id) => ids.add(id))
    })
    return [...ids]
  } catch { return [] }
}

interface ArtistRecord extends ArtistCandidate {
  area?: { name: string }; genres?: Array<{ name: string }>
  'life-span'?: { begin?: string; end?: string; ended?: boolean }
  relations?: Array<{ type: string; url?: { resource: string } }>
}
interface WikiEntity {
  claims?: { P18?: Array<{ rank: string; mainsnak: { datavalue?: { value: string } } }> }
  descriptions?: Record<string, { value: string }>
  sitelinks?: Record<string, { title: string }>
}

async function enrichWikimedia(profile: ArtistProfile, record: ArtistRecord) {
  const link = record.relations?.find((relation) => relation.type === 'wikidata')?.url?.resource
  const id = link?.match(/wikidata\.org\/wiki\/(Q\d+)/)?.[1]
  if (!id) return
  const entityResult = await jsonRequest<{ entities: Record<string, WikiEntity> }>(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=claims%7Cdescriptions%7Csitelinks&languages=zh%7Cen&format=json`)
  const entity = entityResult.entities?.[id]
  if (!entity) return
  profile.biography = entity.descriptions?.zh?.value || entity.descriptions?.en?.value || ''
  const language = entity.sitelinks?.zhwiki ? 'zh' : 'en'
  const title = entity.sitelinks?.[`${language}wiki`]?.title
  if (title) {
    try {
      const query = new URLSearchParams({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exchars: '2200', titles: title, format: 'json', formatversion: '2' })
      const wiki = await jsonRequest<{ query?: { pages?: Array<{ extract?: string }> } }>(`https://${language}.wikipedia.org/w/api.php?${query}`)
      const extract = wiki.query?.pages?.[0]?.extract
      if (extract) profile.biography = extract.trim()
      profile.sourceUrl = `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`
    } catch { /* Structured description remains available if Wikipedia is blocked. */ }
  }
  const images = entity.claims?.P18?.filter((claim) => claim.rank !== 'deprecated') ?? []
  const file = (images.find((claim) => claim.rank === 'preferred') ?? images[0])?.mainsnak.datavalue?.value
  if (!file || typeof file !== 'string') return
  try {
    const query = new URLSearchParams({ action: 'query', prop: 'imageinfo', titles: `File:${file}`, iiprop: 'url|mime|extmetadata', iiurlwidth: '512', format: 'json', formatversion: '2' })
    const response = await jsonRequest<{ query?: { pages?: Array<{ imageinfo?: Array<{ thumburl?: string; url: string; descriptionurl?: string; mime: string; extmetadata?: Record<string, { value: string }> }> }> } }>(`https://commons.wikimedia.org/w/api.php?${query}`)
    const image = response.query?.pages?.[0]?.imageinfo?.[0]
    const url = image?.thumburl || image?.url
    if (!image || !url || new URL(url).hostname !== 'upload.wikimedia.org') return
    const downloaded = await fb.http.request(url, { responseType: 'base64', timeout: 9000 })
    const header = Object.entries(downloaded.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1]?.split(';')[0]
    const mime = header || image.mime
    if (downloaded.status !== 200 || !downloaded.body || !/^image\/(jpeg|png|webp|avif)$/.test(mime) || downloaded.body.length > 5_000_000) return
    profile.onlineImage = `data:${mime};base64,${downloaded.body}`
    profile.imageSourceUrl = image.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`
    profile.imageCredit = plainText(image.extmetadata?.Artist?.value ?? '')
    profile.imageLicense = plainText(image.extmetadata?.LicenseShortName?.value ?? '')
  } catch { /* Biography/identity do not depend on a photograph being available. */ }
}

export function loadOnlineArtistProfile(name: string, selectedId?: string, matchByName = false): Promise<ArtistProfile> {
  const key = artistKey(name)
  if (onlineRequests.has(key)) return onlineRequests.get(key)!
  const profile = getArtistProfile(name)
  const request = (async () => {
    await ensureLocalArtistProfile(name)
    if (!artistProfilesConnected()) { profile.message = '请在 foobar2000 中获取在线资料。'; return profile }
    if (!selectedId && ['unknown artist', 'various artists', '未知艺术家', '未知艺人', '群星', '合集'].includes(key)) {
      profile.message = '此名称不对应单一艺术家，可手动选择照片或完善音乐文件标签。'
      profile.status = 'ready'
      return profile
    }
    profile.status = 'loading'
    profile.message = ''
    try {
      const tagged = await taggedArtistIds(name)
      let id = matchByName ? '' : selectedId && uuid.test(selectedId) ? selectedId : profile.manualIdentity ? profile.mbid : tagged.length === 1 ? tagged[0] : profile.mbid
      if (!selectedId && !profile.manualIdentity && tagged.length > 1) id = ''
      if (!id) {
        const query = new URLSearchParams({ query: `artist:"${name.replace(/[\\"]/g, '\\$&')}"`, fmt: 'json', limit: '8' })
        const result = await musicBrainz<{ artists?: ArtistCandidate[] }>(`artist/?${query}`)
        const candidates = (Array.isArray(result.artists) ? result.artists : []).filter((artist) => uuid.test(artist.id))
        const exact = candidates.filter((artist) => Number(artist.score) >= 95 && (artistKey(artist.name) === key || artist.aliases?.some((alias) => artistKey(alias.name) === key)))
        if (matchByName || exact.length !== 1 || tagged.length > 1) {
          profile.candidates = candidates
          profile.status = candidates.length ? 'ambiguous' : 'ready'
          profile.message = candidates.length ? '请选择与音乐库一致的艺术家身份。' : '未找到可靠匹配，可先选择本地照片。'
          return profile
        }
        id = exact[0].id
      }
      const record = await musicBrainz<ArtistRecord>(`artist/${id}?inc=url-rels%2Baliases%2Bgenres&fmt=json`)
      if (profile.mbid !== id) {
        profile.onlineImage = ''; profile.biography = ''; profile.imageSourceUrl = ''; profile.imageCredit = ''; profile.imageLicense = ''
      }
      profile.mbid = id
      if (selectedId) profile.manualIdentity = true
      profile.localIdentityMismatch = profile.manualIdentity && (tagged.length !== 1 || tagged[0] !== id)
      profile.canonicalName = record.name
      profile.country = record.area?.name || record.country || ''
      profile.type = ({ Person: '个人', Group: '乐队 / 组合', Orchestra: '乐团', Choir: '合唱团' } as Record<string, string>)[record.type ?? ''] || record.type || ''
      const life = record['life-span']
      profile.years = life?.begin ? `${life.begin.slice(0, 4)} — ${life.end?.slice(0, 4) || '至今'}` : ''
      profile.genres = record.genres?.map((genre) => genre.name).slice(0, 6) ?? []
      profile.sourceUrl = `https://musicbrainz.org/artist/${id}`
      try { await enrichWikimedia(profile, record) } catch { profile.message = '已确认身份，百科资料暂不可用。' }
      profile.candidates = []
      profile.status = 'ready'
      profile.updatedAt = Date.now()
      if (tagged.length > 1) profile.message = '已匹配资料身份；音乐库同名曲目仍按原标签汇总。'
      profile.revision += 1
      await saveProfile(profile)
    } catch (error) {
      profile.status = 'error'
      profile.message = error instanceof Error ? error.message : '在线资料暂不可用。'
    }
    return profile
  })().finally(() => onlineRequests.delete(key))
  onlineRequests.set(key, request)
  return request
}

export async function chooseArtistPhoto(name: string) {
  if (!artistProfilesConnected()) return
  await ensureLocalArtistProfile(name)
  const picked = await fb.dialog.openFile({ title: `选择“${name}”的艺术家照片`, multiple: false, filters: ['图片文件|*.jpg;*.jpeg;*.png;*.webp'] })
  const path = picked.filePaths?.[0]
  if (picked.canceled || !path) return
  const bytes = await fb.file.readBinary(path)
  if (bytes.length > 8_000_000) throw new Error('请选择小于 8MB 的照片。')
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  const extension = path.split('.').at(-1)?.toLowerCase()
  const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'
  const profile = getArtistProfile(name)
  profile.manualImage = `data:${mime};base64,${btoa(binary)}`
  profile.revision += 1
  await saveProfile(profile)
}
export async function resetArtistPhoto(name: string) {
  const profile = await ensureLocalArtistProfile(name, true)
  profile.manualImage = ''
  profile.revision += 1
  await saveProfile(profile)
}
export async function openArtistSource(url: string) {
  if (/^https:\/\/(musicbrainz\.org|(?:zh|en)\.wikipedia\.org|commons\.wikimedia\.org)\//.test(url)) await fb.shell.openExternal(url)
}
