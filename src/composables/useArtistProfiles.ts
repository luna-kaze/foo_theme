import { reactive } from 'vue'
import { fb } from 'foo-webview-sdk'
import type { DisplayTrack } from '../types/music'
import { playablePath } from '../utils/track'
import { pickImageFile } from '../utils/imagePicker'
import { appleArtistLink, artistServiceSettings, downloadArtistImage, fetchAppleArtist, fetchLastFmArtist, loadArtistServiceSettings, type AppleArtistCandidate } from '../utils/artistProviders'

export interface ArtistCandidate {
  id: string; name: string; country?: string; type?: string; disambiguation?: string; score?: number
  aliases?: Array<{ name: string }>
}
export interface ArtistProfile {
  name: string
  picturePreference: 'auto' | 'manual' | 'local' | 'apple' | 'wikimedia'
  infoPreference: 'auto' | 'lastfm' | 'wiki' | 'apple'
  searchName: string
  status: 'idle' | 'loading' | 'ready' | 'ambiguous' | 'error'
  localImage: string; onlineImage: string; manualImage: string
  mbid: string; manualIdentity: boolean; canonicalName: string
  localIdentityMismatch: boolean
  biography: string; country: string; type: string; years: string; genres: string[]
  sourceUrl: string; imageSourceUrl: string; imageCredit: string; imageLicense: string
  candidates: ArtistCandidate[]; message: string; updatedAt: number; revision: number
  failedImages: string[]
  photoStatus: 'idle' | 'loading' | 'ready' | 'missing' | 'ambiguous' | 'error'
  photoMessage: string; photoCheckedAt: number
  appleImage: string; appleId: string; appleUrl: string; appleName: string; appleBiography: string; appleManual: boolean; appleCandidates: AppleArtistCandidate[]
  lastfmStatus: 'idle' | 'loading' | 'ready' | 'error'
  lastfmMessage: string; lastfmBiography: string; lastfmLanguage: string; lastfmTags: string[]
  lastfmSimilar: Array<{ name: string; url: string }>; lastfmListeners: number; lastfmPlaycount: number; lastfmUrl: string
}

type Context = { connected: () => boolean; tracks: () => DisplayTrack[] }
const profiles = reactive(new Map<string, ArtistProfile>())
const localRequests = new Map<string, Promise<ArtistProfile>>()
const onlineRequests = new Map<string, Promise<ArtistProfile>>()
const mbRequests = new Map<string, Promise<ArtistProfile>>()
const portraitRequests = new Map<string, Promise<ArtistProfile>>()
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
    name, picturePreference: 'auto', infoPreference: 'auto', searchName: '', status: 'idle', localImage: '', onlineImage: '', manualImage: '', mbid: '', manualIdentity: false,
    localIdentityMismatch: false,
    canonicalName: '', biography: '', country: '', type: '', years: '', genres: [],
    sourceUrl: '', imageSourceUrl: '', imageCredit: '', imageLicense: '', candidates: [], message: '', updatedAt: 0, revision: 0,
    failedImages: [], photoStatus: 'idle', photoMessage: '', photoCheckedAt: 0,
    appleImage: '', appleId: '', appleUrl: '', appleName: '', appleBiography: '', appleManual: false, appleCandidates: [],
    lastfmStatus: 'idle', lastfmMessage: '', lastfmBiography: '', lastfmLanguage: '', lastfmTags: [], lastfmSimilar: [], lastfmListeners: 0, lastfmPlaycount: 0, lastfmUrl: '',
  })
  return profiles.get(key)!
}
export function artistPortraitChoices(profile: ArtistProfile) {
  const choices = [
    { provider: 'manual', url: profile.manualImage, source: '手动照片', link: '' },
    { provider: 'local', url: profile.localIdentityMismatch ? '' : profile.localImage, source: '本地艺术家图片', link: '' },
    { provider: 'apple', url: profile.appleImage, source: 'Apple Music', link: profile.appleUrl },
    { provider: 'wikimedia', url: profile.onlineImage, source: 'Wikimedia Commons', link: profile.imageSourceUrl },
  ]
  return [...choices.filter((image) => image.provider === profile.picturePreference), ...choices.filter((image) => image.provider !== profile.picturePreference)].filter((image) => image.url && !profile.failedImages.includes(image.url))
}
export function artistPortraitUrl(profile: ArtistProfile) { return artistPortraitChoices(profile)[0]?.url ?? '' }
export function artistPortraitSource(profile: ArtistProfile) {
  return artistPortraitChoices(profile)[0]?.source ?? '尚无艺术家照片'
}
export function artistPortraitLink(profile: ArtistProfile) { return artistPortraitChoices(profile)[0]?.link ?? '' }
export function artistBiography(profile: ArtistProfile) {
  if (profile.infoPreference === 'lastfm' && profile.lastfmBiography) return { text: profile.lastfmBiography, source: 'Last.fm', url: profile.lastfmUrl }
  if (profile.infoPreference === 'wiki' && profile.biography) return { text: profile.biography, source: 'Wikipedia / Wikidata', url: profile.sourceUrl }
  if (profile.infoPreference === 'apple' && profile.appleBiography) return { text: profile.appleBiography, source: 'Apple Music', url: profile.appleUrl }
  if (profile.lastfmBiography && profile.lastfmLanguage === 'zh') return { text: profile.lastfmBiography, source: 'Last.fm', url: profile.lastfmUrl }
  if (profile.biography) return { text: profile.biography, source: 'Wikipedia / Wikidata', url: profile.sourceUrl }
  if (profile.lastfmBiography) return { text: profile.lastfmBiography, source: 'Last.fm', url: profile.lastfmUrl }
  return { text: profile.appleBiography, source: 'Apple Music', url: profile.appleUrl }
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
    const { status: _status, revision: _revision, failedImages: _failed, ...record } = profile
    await fb.file.write(await cachePath(profile.name), JSON.stringify({ version: 2, ...record }), { encoding: 'utf-8' })
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
          if ((saved.version === 1 || saved.version === 2) && saved.name && artistKey(saved.name) === key) {
            for (const field of ['onlineImage', 'manualImage', 'canonicalName', 'biography', 'country', 'type', 'years', 'sourceUrl', 'imageSourceUrl', 'imageCredit', 'imageLicense', 'appleImage', 'appleId', 'appleUrl', 'appleName', 'appleBiography', 'lastfmBiography', 'lastfmLanguage', 'lastfmUrl', 'searchName'] as const) {
              if (typeof saved[field] === 'string') profile[field] = saved[field]!
            }
            if (saved.mbid && uuid.test(saved.mbid)) profile.mbid = saved.mbid
            profile.manualIdentity = saved.manualIdentity === true
            if (['auto', 'manual', 'local', 'apple', 'wikimedia'].includes(saved.picturePreference ?? '')) profile.picturePreference = saved.picturePreference!
            if (['auto', 'lastfm', 'wiki', 'apple'].includes(saved.infoPreference ?? '')) profile.infoPreference = saved.infoPreference!
            // v1 conflated missing tags with conflicting tags. Recompute below.
            profile.localIdentityMismatch = false
            profile.appleManual = saved.appleManual === true
            profile.photoCheckedAt = Number(saved.photoCheckedAt) || 0
            profile.lastfmListeners = Number(saved.lastfmListeners) || 0
            profile.lastfmPlaycount = Number(saved.lastfmPlaycount) || 0
            profile.lastfmTags = Array.isArray(saved.lastfmTags) ? saved.lastfmTags.filter((tag) => typeof tag === 'string') : []
            profile.lastfmSimilar = Array.isArray(saved.lastfmSimilar) ? saved.lastfmSimilar.filter((item) => typeof item?.name === 'string' && typeof item?.url === 'string') : []
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
    const tagged = await taggedArtistIds(name)
    profile.localIdentityMismatch = Boolean(profile.mbid && tagged.length && !tagged.includes(profile.mbid))
    localChecked.add(key)
    profile.photoStatus = artistPortraitUrl(profile) ? 'ready' : profile.photoCheckedAt ? 'missing' : 'idle'
    if (profile.lastfmUrl) profile.lastfmStatus = 'ready'
    profile.revision += 1
    await saveProfile(profile)
    return profile
  })().finally(() => localRequests.delete(key))
  localRequests.set(key, request)
  return request
}

let photoQueue: Promise<unknown> = Promise.resolve()
export function ensureArtistPortrait(name: string, options: { force?: boolean; appleUrl?: string } = {}): Promise<ArtistProfile> {
  const key = artistKey(name)
  const current = portraitRequests.get(key)
  if (current) return current
  const profile = getArtistProfile(name)
  const request = (async () => {
    await ensureLocalArtistProfile(name)
    if (!artistProfilesConnected()) return profile
    await loadArtistServiceSettings()
    if (!options.force && (artistPortraitUrl(profile) || !artistServiceSettings.autoApple || Date.now() - profile.photoCheckedAt < 24 * 60 * 60 * 1000)) return profile
    profile.photoStatus = 'loading'
    profile.photoMessage = '正在查找艺术家照片…'
    // One active page resolver at a time, with additional iTunes rate limiting.
    const job = photoQueue.catch(() => {}).then(async () => {
      try {
        const result = await fetchAppleArtist([profile.searchName || name, profile.canonicalName].filter(Boolean), options.appleUrl || profile.appleUrl)
        profile.appleCandidates = result.candidates
        profile.photoCheckedAt = Date.now()
        if (result.status === 'ambiguous') {
          profile.photoStatus = 'ambiguous'
          profile.photoMessage = '请选择正确的 Apple Music 艺术家，角色名与本人可能是不同条目。'
        } else if (!result.image) {
          profile.photoStatus = artistPortraitUrl(profile) ? 'ready' : 'missing'
          profile.photoMessage = '此资料源未提供可用的艺术家照片，可选择本地照片或绑定其他艺人页面。'
        } else {
          profile.appleImage = await downloadArtistImage(result.image)
          profile.appleId = result.id
          profile.appleUrl = result.url
          profile.appleName = result.name
          profile.appleBiography = result.biography
          if (options.appleUrl) profile.appleManual = true
          profile.failedImages = profile.failedImages.filter((url) => url !== profile.appleImage)
          profile.photoStatus = 'ready'
          profile.photoMessage = ''
        }
      } catch (error) {
        profile.photoStatus = 'error'
        profile.photoMessage = error instanceof Error ? error.message : '艺术家照片暂不可用。'
        // Short retry suppression for network failures; no permanent missing flag.
        profile.photoCheckedAt = Date.now() - 23.5 * 60 * 60 * 1000
      }
      profile.revision += 1
      await saveProfile(profile)
      return profile
    })
    photoQueue = job
    return job
  })().finally(() => portraitRequests.delete(key))
  portraitRequests.set(key, request)
  return request
}
export function reportArtistPortraitFailure(name: string, url: string) {
  const profile = getArtistProfile(name)
  if (url && !profile.failedImages.includes(url)) profile.failedImages.push(url)
  if (!artistPortraitUrl(profile)) {
    profile.photoMessage = profile.appleImage && profile.failedImages.includes(profile.appleImage) ? '图片显示失败，可点击重新获取照片重试。' : '图片显示失败，正在尝试其他来源。'
    void ensureArtistPortrait(name)
  }
}
export async function bindAppleArtist(name: string, url: string) {
  if (!appleArtistLink(url)) throw new Error('请输入 Apple Music 艺术家页面链接，不是专辑链接。')
  const profile = getArtistProfile(name)
  await ensureLocalArtistProfile(name)
  const pending = portraitRequests.get(artistKey(name))
  if (pending) await pending
  // Explicit user binding bypasses the name search, but still checks page ID.
  profile.photoCheckedAt = 0
  profile.failedImages = profile.failedImages.filter((image) => image !== profile.appleImage)
  return ensureArtistPortrait(name, { force: true, appleUrl: url })
}

async function loadLastFmProfile(profile: ArtistProfile) {
  await loadArtistServiceSettings()
  if (!artistServiceSettings.lastfmApiKey) return
  profile.lastfmStatus = 'loading'
  profile.lastfmMessage = ''
  try {
    const info = await fetchLastFmArtist(profile.canonicalName || profile.searchName || profile.name, profile.mbid, artistServiceSettings.lastfmApiKey)
    profile.lastfmBiography = info.biography
    profile.lastfmLanguage = info.language
    profile.lastfmTags = info.tags
    profile.lastfmSimilar = info.similar
    profile.lastfmListeners = info.listeners
    profile.lastfmPlaycount = info.playcount
    profile.lastfmUrl = info.url
    profile.lastfmStatus = 'ready'
  } catch (error) {
    profile.lastfmStatus = 'error'
    profile.lastfmMessage = error instanceof Error ? error.message : 'Last.fm 资料暂不可用。'
  }
}

export function loadOnlineArtistProfile(name: string, selectedId?: string, matchByName = false): Promise<ArtistProfile> {
  const key = artistKey(name)
  if (onlineRequests.has(key)) return onlineRequests.get(key)!
  const request = (async () => {
    const profile = await loadMusicBrainzProfile(name, selectedId, matchByName)
    if (!artistProfilesConnected() || matchByName) return profile
    const identityStatus = profile.status
    profile.status = 'loading'
    await Promise.allSettled([ensureArtistPortrait(name, { force: true }), loadLastFmProfile(profile)])
    profile.status = identityStatus === 'ambiguous' ? 'ambiguous'
      : identityStatus !== 'error' || profile.lastfmStatus === 'ready' || profile.photoStatus === 'ready' ? 'ready' : 'error'
    await saveProfile(profile)
    return profile
  })().finally(() => onlineRequests.delete(key))
  onlineRequests.set(key, request)
  return request
}

export async function setArtistSourcePreferences(name: string, picture: ArtistProfile['picturePreference'], info: ArtistProfile['infoPreference']) {
  const profile = await ensureLocalArtistProfile(name)
  profile.picturePreference = picture
  profile.infoPreference = info
  await saveProfile(profile)
}

export async function searchArtistByName(name: string, query: string) {
  const lookup = query.trim()
  if (!lookup || lookup.length > 200) throw new Error('请输入不超过 200 个字符的艺术家名字。')
  const key = artistKey(name)
  const pending = [onlineRequests.get(key), mbRequests.get(key), portraitRequests.get(key)].filter((request): request is Promise<ArtistProfile> => Boolean(request))
  if (pending.length) await Promise.allSettled(pending)
  const profile = await ensureLocalArtistProfile(name)
  profile.searchName = artistKey(lookup) === key ? '' : lookup
  profile.message = ''; profile.photoMessage = ''
  profile.candidates = []; profile.appleCandidates = []
  profile.mbid = ''; profile.manualIdentity = false; profile.canonicalName = ''; profile.localIdentityMismatch = false
  profile.biography = ''; profile.sourceUrl = ''; profile.country = ''; profile.type = ''; profile.years = ''; profile.genres = []
  profile.lastfmBiography = ''; profile.lastfmUrl = ''; profile.lastfmTags = []; profile.lastfmSimilar = []; profile.lastfmListeners = 0; profile.lastfmPlaycount = 0
  profile.lastfmStatus = 'idle'; profile.lastfmMessage = ''; profile.updatedAt = 0
  profile.appleId = ''; profile.appleUrl = ''; profile.appleImage = ''; profile.appleName = ''; profile.appleBiography = ''; profile.appleManual = false
  profile.onlineImage = ''; profile.imageSourceUrl = ''; profile.imageCredit = ''; profile.imageLicense = ''; profile.photoCheckedAt = 0
  profile.photoStatus = 'idle'
  profile.failedImages = profile.failedImages.filter((url) => url === profile.manualImage || url === profile.localImage)
  await saveProfile(profile)
  return loadOnlineArtistProfile(name)
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

function loadMusicBrainzProfile(name: string, selectedId?: string, matchByName = false): Promise<ArtistProfile> {
  const key = artistKey(name)
  if (mbRequests.has(key)) return mbRequests.get(key)!
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
      const tagged = profile.searchName ? [] : await taggedArtistIds(name)
      const lookupName = profile.searchName || name
      let id = matchByName ? '' : selectedId && uuid.test(selectedId) ? selectedId : profile.manualIdentity ? profile.mbid : tagged.length === 1 ? tagged[0] : profile.mbid
      if (!selectedId && !profile.manualIdentity && tagged.length > 1) id = ''
      if (!id) {
        const query = new URLSearchParams({ query: `artist:"${lookupName.replace(/[\\"]/g, '\\$&')}"`, fmt: 'json', limit: '8' })
        const result = await musicBrainz<{ artists?: ArtistCandidate[] }>(`artist/?${query}`)
        const candidates = (Array.isArray(result.artists) ? result.artists : []).filter((artist) => uuid.test(artist.id))
        const exact = candidates.filter((artist) => Number(artist.score) >= 95 && (artistKey(artist.name) === artistKey(lookupName) || artist.aliases?.some((alias) => artistKey(alias.name) === artistKey(lookupName))))
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
        profile.lastfmBiography = ''; profile.lastfmUrl = ''; profile.lastfmTags = []; profile.lastfmSimilar = []
        if (!profile.appleManual) { profile.appleImage = ''; profile.appleId = ''; profile.appleUrl = ''; profile.appleBiography = ''; profile.photoCheckedAt = 0 }
      }
      profile.mbid = id
      if (selectedId) profile.manualIdentity = true
      profile.localIdentityMismatch = tagged.length > 0 && !tagged.includes(id)
      profile.canonicalName = record.name
      profile.country = record.area?.name || record.country || ''
      profile.type = ({ Person: '个人', Group: '乐队 / 组合', Orchestra: '乐团', Choir: '合唱团' } as Record<string, string>)[record.type ?? ''] || record.type || ''
      const life = record['life-span']
      profile.years = life?.begin ? `${life.begin.slice(0, 4)} — ${life.end?.slice(0, 4) || '至今'}` : ''
      profile.genres = record.genres?.map((genre) => genre.name).slice(0, 6) ?? []
      profile.sourceUrl = `https://musicbrainz.org/artist/${id}`
      if (!profile.appleManual && !profile.appleUrl) {
        const apple = record.relations?.map((relation) => relation.url?.resource).find((url) => url && appleArtistLink(url))
        if (apple) { profile.appleUrl = apple; profile.appleId = appleArtistLink(apple)!.id }
      }
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
  })().finally(() => mbRequests.delete(key))
  mbRequests.set(key, request)
  return request
}

export async function chooseArtistPhoto(name: string) {
  if (!artistProfilesConnected()) return
  await ensureLocalArtistProfile(name)
  const picked = await pickImageFile(`选择“${name}”的艺术家照片`)
  if (!picked) return
  const { path, bytes } = picked
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
  profile.failedImages = []
  profile.revision += 1
  await saveProfile(profile)
}
export async function openArtistSource(url: string) {
  if (/^https:\/\/(musicbrainz\.org|(?:zh|en)\.wikipedia\.org|commons\.wikimedia\.org|music\.apple\.com|www\.last\.fm)\//.test(url)) await fb.shell.openExternal(url)
}
