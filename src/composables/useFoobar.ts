import { computed, reactive } from 'vue'
import fb, {
  type AlbumInfo,
  type ArtistInfo,
  type MenuItem,
  type PlaybackTrackChangedPayload,
  type PlaylistInfo,
  type TrackInfo,
} from 'foo-webview-sdk'
import { mockAlbums, mockLyrics, mockPlaylists, mockQueue, mockTracks } from '../data/mock'
import type {
  AlbumCard,
  DisplayQueueItem,
  DisplayTrack,
  LibraryFilterField,
  LibraryFilterMatchMode,
  LibraryFilterRule,
  LibraryFolderCard,
  ParsedLyric,
  PlayerUiState,
  TrackDetails,
  ViewId,
  ViewRoute,
} from '../types/music'
import { albumKey, isSameTrack, localFilePath, playablePath, trackKey, trackSubsong } from '../utils/track'

const state = reactive<PlayerUiState>({
  connected: false,
  loading: true,
  view: 'home',
  route: { view: 'home' },
  search: '',
  albums: [],
  artists: [],
  libraryFolders: [],
  libraryStats: { totalTracks: 0, totalAlbums: 0, totalArtists: 0, totalDuration: 0, totalSize: 0 },
  tracks: [],
  recentTracks: [],
  viewTracks: [],
  visibleTracks: [],
  playlists: [],
  activePlaylist: null,
  browsingPlaylist: null,
  selectedAlbum: null,
  queue: [],
  currentTrack: null,
  playbackTracks: [],
  playbackTrackIndex: -1,
  playingPlaylistIndex: -1,
  currentArtwork: '',
  lyrics: [],
  lyricsSynced: false,
  isPlaying: false,
  playbackState: 'stopped',
  canSeek: false,
  position: 0,
  duration: 0,
  volume: 64,
  muted: false,
  playbackOrder: 0,
  nowPlayingOpen: false,
  isFullscreen: false,
  nowPlayingTab: 'lyrics',
  canGoBack: false,
  canGoForward: false,
  dialog: null,
  toast: null,
  error: '',
  searchLoading: false,
  dndSupported: false,
  importing: false,
  libraryFilters: { artist: '', albumArtist: '', genre: '', folder: '', playState: 'all', matchMode: 'all', rules: [{ id: 'primary', field: 'all', operator: 'contains', value: '' }] },
  libraryStatus: { initialized: false, scanning: null, itemCount: 0 },
  customColumn: { label: '', pattern: '' },
})

let initPromise: Promise<void> | null = null
let subscriptions: Array<() => void> = []
let toastTimer: ReturnType<typeof setTimeout> | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null
let libraryReloadTimer: ReturnType<typeof setTimeout> | null = null
let mediaRequest = 0
let lifecycleGeneration = 0
let routeGeneration = 0
let searchGeneration = 0
let libraryGeneration = 0
let playlistGeneration = 0
let queueGeneration = 0
let playbackSequenceGeneration = 0
let radioNonce = 0
let ownedPlaylistPromise: Promise<{ index: number; name: string }> | null = null
let ownerIdPromise: Promise<string> | null = null
let libraryStatusTimer: ReturnType<typeof setTimeout> | null = null
let noDragResizeTimer: ReturnType<typeof setTimeout> | null = null
let playcountLibraryGeneration = -1
const priorFavouriteRatings = new Map<string, number>()
let desktopLyricsCommand: { guid: string; subGuid?: string } | null = null
let miniPlayerWindowId = ''
const history: ViewRoute[] = [{ view: 'home' }]
let historyIndex = 0
const ownershipConfigKey = 'foo-theme.owned-playlists.v1'
const runtimeParams = new URLSearchParams(window.location.search)
const parentWindowId = runtimeParams.get('mainWindowId') ?? ''
const playbackOrders = [
  { index: 0, mode: 'default' as const, label: '默认播放顺序' },
  { index: 1, mode: 'repeat-playlist' as const, label: '循环播放列表' },
  { index: 2, mode: 'repeat-track' as const, label: '单曲循环' },
  { index: 3, mode: 'random' as const, label: '随机播放' },
  { index: 4, mode: 'shuffle-tracks' as const, label: '随机音轨' },
  { index: 5, mode: 'shuffle-albums' as const, label: '随机专辑' },
  { index: 6, mode: 'shuffle-folders' as const, label: '随机文件夹' },
]
const customColumnValues = new Map<string, string>()
let exactAlbumArtwork = new Map<string, string>()
let namedAlbumArtwork = new Map<string, string | null>()

export type PluginId = 'converter' | 'freedb' | 'dop'
export type PluginContextAction = { commandId: number; label: string }
export type IpodMainAction = 'devicePanel' | 'loadLibrary' | 'rewriteDatabase' | 'recoverOrphans' | 'synchronise' | 'sendPlaylists' | 'manageContents' | 'fileSystemExplorer' | 'properties' | 'rawProperties' | 'systemLog' | 'eject'
export type IpodDeviceStatus = 'unavailable' | 'unknown' | 'connected' | 'disconnected'
const ipodCommandQueries: Record<IpodMainAction, string[]> = {
  devicePanel: ['iPod Manager', 'iPod'],
  loadLibrary: ['Load library'],
  rewriteDatabase: ['Rewrite database'],
  recoverOrphans: ['Recover orphaned tracks'],
  synchronise: ['Synchronise', 'Synchronize'],
  sendPlaylists: ['Send playlists'],
  manageContents: ['Manage contents'],
  fileSystemExplorer: ['File system explorer'],
  properties: ['Properties'],
  rawProperties: ['Raw properties'],
  systemLog: ['System log viewer'],
  eject: ['Eject'],
}
const pluginIntegrations = reactive<Record<PluginId, { installed: boolean; name: string; version: string }>>({
  converter: { installed: false, name: 'Converter', version: '' },
  freedb: { installed: false, name: 'freedb', version: '' },
  dop: { installed: false, name: 'iPod Manager', version: '' },
})
const ipodDevice = reactive<{ status: IpodDeviceStatus; probing: boolean }>({ status: 'unknown', probing: false })
const ipodCommands = reactive<Record<IpodMainAction, boolean>>({
  devicePanel: false, loadLibrary: false, rewriteDatabase: false, recoverOrphans: false,
  synchronise: false, sendPlaylists: false, manageContents: false, fileSystemExplorer: false,
  properties: false, rawProperties: false, systemLog: false, eject: false,
})
const ipodCommandCache = new Map<IpodMainAction, { guid: string; subGuid?: string }>()

const normalizeTrack = (track: TrackInfo | PlaybackTrackChangedPayload): DisplayTrack => {
  const fullPath = 'fullPath' in track ? track.fullPath : undefined
  return {
    ...track,
    path: fullPath || track.path || track.absolutePath || '',
    duration: Number(track.duration || 0),
  }
}

function parseLyrics(raw = '', duration = 0): { lines: ParsedLyric[]; synced: boolean } {
  const offsetMs = Number(raw.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0)
  const lrcTimestamp = /\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g
  const timed = raw
    .split(/\r?\n/)
    .flatMap((line) => {
      const matches = [...line.matchAll(lrcTimestamp)]
      const text = line
        .replace(lrcTimestamp, '')
        .replace(/<\d{1,3}:[0-5]?\d(?:[.:]\d{1,3})?>/g, '')
        .trim()
      return matches.map((match) => {
        const fraction = match[3] ? Number(match[3]) / 10 ** match[3].length : 0
        return {
          time: Math.max(0, Number(match[1]) * 60 + Number(match[2]) + fraction + offsetMs / 1000),
          text,
        }
      })
    })
    .filter((line) => line.text)

  const srt = raw
    .split(/\r?\n\s*\r?\n/)
    .flatMap((block) => {
      const match = block.match(/(?:^|\n)(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->/)
      if (!match) return []
      const text = block
        .split(/\r?\n/)
        .filter((line) => !/^\d+$/.test(line.trim()) && !/-->/.test(line))
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .trim()
      if (!text) return []
      return [{
        time: Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 10 ** match[4].length,
        text,
      }]
    })

  const syncedLines = [...timed, ...srt].sort((a, b) => a.time - b.time)
  if (syncedLines.length) return { lines: syncedLines, synced: true }

  const plainLines = raw
    .split(/\r?\n/)
    .map((text) => text.replace(/^\[(?:ar|al|ti|by|offset|re|ve):.*\]$/i, '').trim())
    .filter(Boolean)
  const interval = duration > 0 && plainLines.length ? duration / plainLines.length : 6
  return {
    lines: plainLines.map((text, index) => ({ time: index * interval, text, estimated: true })),
    synced: false,
  }
}

function notify(message: string, tone: 'info' | 'success' | 'error' = 'info') {
  state.toast = { message, tone }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    state.toast = null
  }, 3200)
}

function refreshSafely(action: () => Promise<unknown>) {
  void Promise.resolve().then(action).catch((error) => {
    state.error = error instanceof Error ? error.message : '后台数据同步失败。'
  })
}

async function runAction<T>(action: () => Promise<T>, successMessage?: string): Promise<T | null> {
  try {
    const result = await action()
    if (
      result &&
      typeof result === 'object' &&
      'success' in result &&
      (result as { success?: boolean }).success === false
    ) {
      const message = 'error' in result && typeof result.error === 'string'
        ? result.error
        : '操作失败。'
      throw new Error(message)
    }
    if (successMessage) notify(successMessage, 'success')
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : '操作失败。'
    state.error = message
    notify(message, 'error')
    return null
  }
}

function rebuildAlbumArtworkIndex(albums: AlbumCard[]) {
  exactAlbumArtwork = new Map()
  namedAlbumArtwork = new Map()
  albums.forEach((album) => {
    exactAlbumArtwork.set(albumKey(album), album.artworkUrl)
    const name = album.name.trim().toLocaleLowerCase()
    namedAlbumArtwork.set(name, namedAlbumArtwork.has(name) ? null : album.artworkUrl)
  })
}

function attachArtwork(tracks: DisplayTrack[]): DisplayTrack[] {
  return tracks.map((track) => {
    const artworkUrl = exactAlbumArtwork.get(albumKey({ name: track.album, artist: track.albumArtist || track.artist }))
      ?? namedAlbumArtwork.get(track.album.trim().toLocaleLowerCase())
    return artworkUrl ? { ...track, artworkUrl } : track
  })
}

function patchTrackCopies(track: DisplayTrack, patch: Partial<DisplayTrack>) {
  const key = trackKey(track)
  for (const collection of [state.tracks, state.recentTracks, state.viewTracks, state.visibleTracks, state.queue, state.playbackTracks]) {
    collection.forEach((item) => {
      if (trackKey(item) === key) Object.assign(item, patch)
    })
  }
  if (trackKey(state.currentTrack) === key) Object.assign(state.currentTrack!, patch)
}

async function evaluateCustomColumn(tracks: DisplayTrack[], pattern: string) {
  const result = await runAction(() => fb.titleformat.evalFieldsBatch(tracks.map(playablePath), { customValue: pattern }))
  if (!result) return false
  result.results.forEach((item, index) => {
    if (!tracks[index] || !item.success) return
    tracks[index].customValue = typeof item.customValue === 'string' ? item.customValue : ''
    customColumnValues.set(trackKey(tracks[index]), tracks[index].customValue ?? '')
  })
  return true
}

async function setViewTracks(tracks: DisplayTrack[]) {
  const nextTracks = attachArtwork(tracks).map((track) => ({ ...track, customValue: customColumnValues.get(trackKey(track)) }))
  state.viewTracks = nextTracks
  state.visibleTracks = nextTracks.slice()
  if (!state.connected || !state.customColumn.pattern || !nextTracks.length) return
  await evaluateCustomColumn(nextTracks, state.customColumn.pattern)
  if (state.viewTracks === nextTracks) state.visibleTracks = nextTracks.slice()
}

function updateHistoryState() {
  state.canGoBack = historyIndex > 0
  state.canGoForward = historyIndex < history.length - 1
}

function useDemoData() {
  state.albums = mockAlbums.map((album) => ({ ...album }))
  state.tracks = mockTracks.map((track) => ({ ...track }))
  state.recentTracks = state.tracks.slice()
  state.playlists = mockPlaylists.map((playlist) => ({ ...playlist }))
  state.activePlaylist = state.playlists[0] ?? null
  state.queue = mockQueue.map((item, sourceIndex) => ({ ...item, queueSource: 'explicit', sourceIndex }))
  state.currentTrack = state.tracks[0] ?? null
  state.playbackTracks = state.tracks.slice(0, 61).map((track, sourceIndex) => ({ ...track, sourceIndex }))
  state.playbackTrackIndex = state.currentTrack ? 0 : -1
  state.playingPlaylistIndex = -1
  state.currentArtwork = state.currentTrack?.artworkUrl ?? ''
  state.duration = state.currentTrack?.duration ?? 0
  state.lyrics = mockLyrics.slice()
  state.lyricsSynced = true
  state.playbackState = state.currentTrack ? 'paused' : 'stopped'
  void setViewTracks(state.recentTracks)
}

async function loadAllTracks() {
  const countResult = await fb.library.getCount()
  const total = Math.max(0, countResult.count ?? 0)
  const tracks: TrackInfo[] = []
  const pageSize = 1000
  for (let offset = 0; offset < total; offset += pageSize) {
    const page = await fb.library.getAll(offset, Math.min(pageSize, total - offset))
    tracks.push(...(page.tracks ?? []))
  }
  return tracks
}

async function loadAllAlbums() {
  const albums: AlbumInfo[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const page = await fb.library.getAlbums({ offset, limit: pageSize })
    albums.push(...(page.albums ?? []))
    if (!page.hasMore || !page.albums?.length) break
  }
  return albums
}

async function loadAlbumArtwork(albums: AlbumCard[]) {
  const byPath = new Map(albums.filter((album) => album.firstTrackPath).map((album) => [album.firstTrackPath!, album]))
  const paths = [...byPath.keys()]
  for (let start = 0; start < paths.length; start += 100) {
    const batch = paths.slice(start, start + 100)
    try {
      const result = await fb.artwork.getFb2kUrlByPathBatch(batch, { type: 'front', maxSize: 520 })
      result.artworks?.forEach((art, index) => {
        if (art.available && art.dataUrl) {
          const album = byPath.get(batch[index])
          if (album) album.artworkUrl = art.dataUrl
        }
      })
    } catch {
      // Artwork is optional; metadata remains usable when a batch fails.
    }
  }
}

async function loadLibrary() {
  const generation = ++libraryGeneration
  const [albumResult, recentResult, trackResult] = await Promise.allSettled([
    loadAllAlbums(),
    fb.library.getRecentlyAdded(100, 'modified'),
    loadAllTracks(),
  ])
  if (generation !== libraryGeneration) return
  if (albumResult.status === 'rejected') throw albumResult.reason
  if (trackResult.status === 'rejected') throw trackResult.reason

  const albums: AlbumCard[] = albumResult.value.map((album: AlbumInfo) => ({
    ...album,
    id: albumKey(album),
    artworkUrl: album.coverDataUrl ?? '',
  }))
  await loadAlbumArtwork(albums)
  if (generation !== libraryGeneration) return
  state.albums = albums
  rebuildAlbumArtworkIndex(albums)
  state.tracks = attachArtwork(trackResult.value.map(normalizeTrack))
  if (recentResult.status === 'fulfilled' && recentResult.value.success !== false) state.recentTracks = attachArtwork((recentResult.value.tracks ?? []).map(normalizeTrack))
}

async function loadPlaylists() {
  const generation = ++playlistGeneration
  const [allPlaylists, active, ownerId] = await Promise.all([fb.playlist.getAll(), fb.playlist.getActive(), getOwnerId()])
  if (generation !== playlistGeneration) return
  const internalName = `正在播放 [foo-theme:${ownerId}]`
  const playlists = allPlaylists.filter((playlist) => playlist.name !== internalName && playlist.name !== '[WebView Queue]')
  state.playlists = playlists
  state.activePlaylist = active && playlists.some((playlist) => playlist.index === active.index) ? active : null
  const route = state.route
  if (route.view === 'playlist') {
    state.browsingPlaylist = playlists.find((item) => item.index === route.playlistIndex) ?? null
  }
}

async function loadQueue() {
  const generation = ++queueGeneration
  const result = await fb.queue.get()
  const artworkByAlbum = new Map(state.albums.map((album) => [albumKey(album), album.artworkUrl]))
  const explicit: DisplayQueueItem[] = (result.items ?? []).map((item, sourceIndex) => ({
    ...item,
    queueSource: 'explicit',
    sourceIndex,
    artworkUrl: artworkByAlbum.get(albumKey({ name: item.album, artist: item.albumArtist || item.artist })) || '',
  }))
  let upcoming: DisplayQueueItem[] = []
  try {
    const [playing, current] = await Promise.all([
      fb.player.getPlayingPlaylist(),
      fb.player.getCurrentTrackIndex(),
    ])
    const playlistIndex = playing.playlist
    const currentIndex = current.index
    if (![2, 3, 4, 5, 6].includes(state.playbackOrder) && playlistIndex != null && currentIndex != null && playlistIndex >= 0 && currentIndex >= 0) {
      const count = (await fb.playlist.getCount(playlistIndex)).count
      const remaining = await fb.playlist.getTracks(playlistIndex, currentIndex + 1, Math.min(100, Math.max(0, count - currentIndex - 1)))
      const wrapped = state.playbackOrder === 1 && remaining.length < 100
        ? await fb.playlist.getTracks(playlistIndex, 0, Math.min(currentIndex + 1, 100 - remaining.length))
        : []
      const tracks = [...remaining, ...wrapped]
      upcoming = tracks.map((track, offset) => ({
        ...track,
        playlist: playlistIndex,
        playlistItem: offset < remaining.length ? currentIndex + 1 + offset : offset - remaining.length,
        queueSource: 'playlist',
        sourceIndex: offset < remaining.length ? currentIndex + 1 + offset : offset - remaining.length,
        artworkUrl: artworkByAlbum.get(albumKey({ name: track.album, artist: track.albumArtist || track.artist })) || '',
      }))
    }
  } catch {
    // Explicit queue entries remain useful when no playing playlist is available.
  }
  if (generation === queueGeneration) state.queue = [...explicit, ...upcoming]
}

function setPlaybackWindow(tracks: DisplayTrack[], currentIndex: number, playlistIndex: number) {
  const start = Math.max(0, currentIndex - 30)
  state.playbackTracks = tracks.slice(start, start + 61).map((track, offset) => ({ ...track, sourceIndex: start + offset }))
  state.playbackTrackIndex = currentIndex - start
  state.playingPlaylistIndex = playlistIndex
}

async function loadPlaybackSequence() {
  const generation = ++playbackSequenceGeneration
  const [playing, current] = await Promise.all([fb.player.getPlayingPlaylist(), fb.player.getCurrentTrackIndex(true)])
  if (generation !== playbackSequenceGeneration) return
  const playlistIndex = playing.playlist
  const currentIndex = current.index
  if (playlistIndex == null || currentIndex == null || playlistIndex < 0 || currentIndex < 0) {
    state.playbackTracks = state.currentTrack ? [{ ...state.currentTrack, sourceIndex: 0 }] : []
    state.playbackTrackIndex = state.currentTrack ? 0 : -1
    state.playingPlaylistIndex = -1
    return
  }
  if (state.playingPlaylistIndex === playlistIndex) {
    const existingIndex = state.playbackTracks.findIndex((track) => track.sourceIndex === currentIndex)
    if (existingIndex >= 0 && (!current.track || isSameTrack(state.playbackTracks[existingIndex], normalizeTrack(current.track)))) {
      state.playbackTrackIndex = existingIndex
      return
    }
  }
  const count = (await fb.playlist.getCount(playlistIndex)).count
  const start = Math.max(0, Math.min(currentIndex - 30, Math.max(0, count - 61)))
  const tracks = await fb.playlist.getTracks(playlistIndex, start, Math.min(61, count - start))
  if (generation !== playbackSequenceGeneration) return
  state.playbackTracks = attachArtwork(tracks.map((track, offset) => ({ ...normalizeTrack(track), sourceIndex: start + offset })))
  state.playbackTrackIndex = currentIndex - start
  state.playingPlaylistIndex = playlistIndex
}

async function loadCurrentArtwork(request: number, key: string, path: string) {
  try {
    const art = await fb.artwork.getFb2kUrlByPath(path, 'front', { maxSize: 1000 })
    if (request === mediaRequest && trackKey(state.currentTrack) === key) {
      state.currentArtwork = art.available ? art.dataUrl ?? '' : ''
    }
  } catch {
    if (request === mediaRequest) state.currentArtwork = ''
  }
}

async function loadLyrics(request: number, key: string, path: string) {
  try {
    const result = await fb.lyrics.get(path)
    if (request !== mediaRequest || trackKey(state.currentTrack) !== key) return
    const parsed = result.available ? parseLyrics(result.lyrics, state.duration) : { lines: [], synced: false }
    state.lyrics = parsed.lines
    state.lyricsSynced = Boolean(result.synced ?? parsed.synced)
  } catch {
    if (request === mediaRequest) {
      state.lyrics = []
      state.lyricsSynced = false
    }
  }
}

async function syncCurrentTrack(track?: TrackInfo | PlaybackTrackChangedPayload | null) {
  const request = ++mediaRequest
  const nextTrack = track === undefined ? await fb.player.getCurrentTrack() : track
  if (request !== mediaRequest) return
  const normalized = nextTrack ? attachArtwork([normalizeTrack(nextTrack)])[0] : null
  state.currentTrack = normalized
  state.duration = state.currentTrack?.duration ?? 0
  state.currentArtwork = ''
  state.lyrics = []
  state.lyricsSynced = false
  const current = state.currentTrack
  const key = trackKey(current)
  const path = current ? playablePath(current) : ''
  if (state.connected && current && path) {
    try {
      const result = await fb.rating.get(path)
      if (request === mediaRequest && trackKey(state.currentTrack) === key) state.currentTrack!.rating = result.rating
    } catch {
      // Ratings remain optional when no writable backend is installed.
    }
  }
  if (path) await Promise.all([loadCurrentArtwork(request, key, path), loadLyrics(request, key, path)])
}

function bindEvents() {
  if (subscriptions.length) return
  const scheduleLibraryReload = () => {
    if (libraryReloadTimer) clearTimeout(libraryReloadTimer)
    libraryReloadTimer = setTimeout(() => refreshSafely(async () => {
      await loadLibrary()
      if (['home', 'songs', 'albums', 'album', 'search', 'favourites'].includes(state.route.view)) await navigate(state.route, 'none')
    }), 450)
  }
  const onPlaylistItemsChanged = (event: { playlist: number }) => {
    if (state.route.view === 'playlist' && state.route.playlistIndex === event.playlist) refreshSafely(refreshActivePlaylist)
    if (state.playingPlaylistIndex === event.playlist) refreshSafely(loadPlaybackSequence)
    refreshSafely(loadPlaylists)
    refreshSafely(loadQueue)
  }
  const reloadPlaylistStructure = async () => {
    await loadPlaylists()
    const route = state.route
    if (route.view === 'playlist') {
      const matches = state.playlists.filter((playlist) => playlist.name === route.playlistName)
      if (matches.length === 1) await navigate({ ...route, playlistIndex: matches[0].index }, 'none')
      else await navigate({ view: 'home' }, 'replace')
    }
  }
  subscriptions = [
    fb.on('playback:trackChanged', (track) => {
      state.position = 0
      refreshSafely(() => syncCurrentTrack(track))
      refreshSafely(loadQueue)
      refreshSafely(loadPlaybackSequence)
      refreshSafely(syncPlaybackCapabilities)
    }),
    fb.on('playback:stateChanged', (event) => {
      state.playbackState = event.state
      state.isPlaying = event.state === 'playing'
      if (event.position != null) state.position = event.position
      if (event.duration != null) state.duration = event.duration
    }),
    fb.on('playback:paused', (event) => {
      state.playbackState = event.paused ? 'paused' : 'playing'
      state.isPlaying = !event.paused
    }),
    fb.on('playback:stopped', (event) => {
      if (event.reason === 'starting_another') return
      state.playbackState = 'stopped'
      state.isPlaying = false
      state.position = 0
      state.duration = 0
      mediaRequest += 1
      state.currentTrack = null
      state.currentArtwork = ''
      state.lyrics = []
      state.lyricsSynced = false
      refreshSafely(loadQueue)
    }),
    fb.on('playback:timeHighRes', (event) => {
      state.position = event.position
    }),
    fb.on('playback:seeked', (event) => {
      state.position = event.position
    }),
    fb.on('playback:volumeChanged', (event) => {
      state.volume = event.volume
      state.muted = event.muted
    }),
    fb.on('playback:orderChanged', (event) => {
      state.playbackOrder = event.order
      refreshSafely(loadQueue)
    }),
    fb.on('playback:queueChanged', () => refreshSafely(loadQueue)),
    fb.on('playlist:activated', (event) => {
      state.activePlaylist = state.playlists.find((playlist) => playlist.index === event.newIndex) ?? null
      refreshSafely(loadPlaylists)
    }),
    fb.on('playlist:itemsAdded', onPlaylistItemsChanged),
    fb.on('playlist:itemsRemoved', onPlaylistItemsChanged),
    fb.on('playlist:itemsReordered', onPlaylistItemsChanged),
    fb.on('playlist:itemsReplaced', onPlaylistItemsChanged),
    fb.on('playlist:addComplete', (event) => {
      if (!event.success) return
      refreshSafely(loadPlaylists)
      refreshSafely(loadQueue)
    }),
    fb.on('playlist:created', () => refreshSafely(loadPlaylists)),
    fb.on('playlist:removed', () => refreshSafely(reloadPlaylistStructure)),
    fb.on('playlist:renamed', (event) => refreshSafely(async () => {
      history.forEach((route, index) => {
        if (route.view === 'playlist' && route.playlistIndex === event.index) history[index] = { ...route, playlistName: event.name }
      })
      if (state.route.view === 'playlist' && state.route.playlistIndex === event.index) {
        state.route = { ...state.route, playlistName: event.name }
        history[historyIndex] = state.route
      }
      await loadPlaylists()
    })),
    fb.on('playlist:lockChanged', () => refreshSafely(loadPlaylists)),
    fb.on('playlist:reordered', () => {
      refreshSafely(reloadPlaylistStructure)
      refreshSafely(loadPlaybackSequence)
    }),
    fb.on('metadb:changed', (event) => {
      event.tracks.forEach((changed) => {
        const normalized = normalizeTrack(changed as TrackInfo)
        const patch = Object.fromEntries(Object.entries(changed).filter(([, value]) => value !== undefined)) as Partial<DisplayTrack>
        patchTrackCopies(normalized, patch)
      })
      if (state.route.view === 'favourites' || state.route.view === 'songs') refreshSafely(() => navigate(state.route, 'none'))
    }),
    fb.on('playback:edited', (track) => refreshSafely(() => syncCurrentTrack(track))),
    fb.on('playback:dynamicInfoTrack', (event) => {
      if (!state.currentTrack) return
      if (event.artist != null) state.currentTrack.artist = event.artist
      if (event.title != null) state.currentTrack.title = event.title
    }),
    fb.on('library:itemsAdded', scheduleLibraryReload),
    fb.on('library:itemsRemoved', scheduleLibraryReload),
    fb.on('library:itemsModified', scheduleLibraryReload),
    fb.on('library:initialized', scheduleLibraryReload),
    fb.on('dnd:capabilitiesChanged', (capabilities) => {
      state.dndSupported = capabilities.paths
    }),
    fb.on('dnd:drop', (event) => {
      if (event.paths.length) refreshSafely(() => importPaths(event.paths))
      else refreshSafely(importDroppedPaths)
    }),
    fb.on('window:message', (event) => {
      if (event.message.type === 'restore-main') refreshSafely(restoreCurrentWindow)
    }),
    fb.on('window:popupClosed', (event) => {
      if (event.windowId !== miniPlayerWindowId) return
      miniPlayerWindowId = ''
      refreshSafely(restoreCurrentWindow)
    }),
    fb.on('window:stateChanged', (event) => {
      state.isFullscreen = event.isFullscreen
    }),
  ]
}

function syncBrowserFullscreen() {
  if (!state.connected) state.isFullscreen = Boolean(document.fullscreenElement)
}

async function syncNoDragRegion() {
  if (!state.connected) return
  // A non-empty, unreachable custom region disables the host's default 32px
  // titlebar fallback, whose native double-click handler toggles maximization.
  await fb.ui.setDragRegions([{ x: -10000, y: -10000, width: 1, height: 1 }])
  await fb.ui.setNoDragRegions([{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }])
}

async function recoverMiniPlayerWindow() {
  if (parentWindowId || runtimeParams.get('mode') === 'mini') return
  try {
    const windows = await fb.ui.getAllWindows()
    const miniPlayer = windows.items.find((item) => !item.isMain && (item.profile === 'miniPlayer' || item.url.includes('mode=mini')))
    miniPlayerWindowId = miniPlayer?.windowId ?? ''
  } catch {
    miniPlayerWindowId = ''
  }
}

function scheduleNoDragRegion() {
  if (noDragResizeTimer) clearTimeout(noDragResizeTimer)
  noDragResizeTimer = setTimeout(() => void syncNoDragRegion().catch(() => undefined), 80)
}

async function initialize() {
  if (initPromise) return initPromise
  const generation = ++lifecycleGeneration
  initPromise = (async () => {
    state.loading = true
    const webViewDetected = Boolean((window as Window & { chrome?: { webview?: unknown } }).chrome?.webview)
    if (!webViewDetected && !fb.isAvailable()) {
      useDemoData()
      document.addEventListener('fullscreenchange', syncBrowserFullscreen)
      state.loading = false
      return
    }
    try {
      await Promise.race([
        fb.ready(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('等待 foobar2000 宿主连接超时。')), 5500)),
      ])
      if (generation !== lifecycleGeneration) return
      state.connected = fb.isAvailable()
      if (!state.connected) throw new Error('foobar2000 宿主桥接不可用。')
      bindEvents()
      await syncNoDragRegion()
      await recoverMiniPlayerWindow()
      window.addEventListener('resize', scheduleNoDragRegion)
      const [library, playlists, capabilities, , windowState] = await Promise.allSettled([
        loadLibrary(),
        loadPlaylists(),
        fb.dnd.getCapabilities(),
        loadPluginIntegrations(),
        fb.ui.getState(),
      ])
      await loadLibraryStatus()
      await refreshIpodCommands()
      if (generation !== lifecycleGeneration) return
      state.dndSupported = capabilities.status === 'fulfilled' && capabilities.value.success && capabilities.value.paths
      state.isFullscreen = windowState.status === 'fulfilled' && windowState.value.isFullscreen
      const [playback, position, volume, order] = await Promise.all([
        fb.player.getState(),
        fb.player.getPosition(),
        fb.player.getVolume(),
        fb.player.getOrder(),
      ])
      if (generation !== lifecycleGeneration) return
      state.playbackState = playback.state
      state.canSeek = playback.canSeek
      state.isPlaying = playback.state === 'playing'
      state.position = position.position ?? 0
      state.duration = position.duration ?? 0
      state.volume = volume.volume
      state.muted = volume.muted
      state.playbackOrder = order.order
      await Promise.allSettled([loadQueue(), syncCurrentTrack(), loadPlaybackSequence(), navigate(state.route, 'none')])
      if (library.status === 'rejected' || playlists.status === 'rejected') notify('部分 foobar2000 数据无法加载。', 'error')
      state.error = ''
      void fb.ui.setTitle('foobar2000').catch(() => undefined)
    } catch (error) {
      if (generation !== lifecycleGeneration) return
      window.removeEventListener('resize', scheduleNoDragRegion)
      state.error = error instanceof Error ? error.message : '无法连接到 foobar2000。'
      notify(state.error, 'error')
      subscriptions.forEach((unsubscribe) => unsubscribe())
      subscriptions = []
      initPromise = null
    } finally {
      if (generation === lifecycleGeneration) state.loading = false
    }
  })()
  return initPromise
}

function routeKey(route: ViewRoute) {
  if (route.view === 'album') return `album:${route.albumName}\u0000${route.albumArtist}`
  if (route.view === 'artist') return `artist:${route.artist}`
  if (route.view === 'folder') return `folder:${route.rootId}\u0000${route.pathId}`
  if (route.view === 'playlist') return `playlist:${route.playlistIndex}:${route.playlistName}`
  if (route.view === 'search') return `search:${route.query}`
  if (route.view === 'radio') return `radio:${route.nonce}`
  return route.view
}

async function loadSearchTracks(query: string) {
  if (!state.connected) {
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
    return state.tracks.filter((track) => terms.every((term) =>
      [track.title, track.artist, track.album, track.albumArtist ?? '', track.genre ?? ''].some((field) => field.toLocaleLowerCase().includes(term)),
    ))
  }
  const tracks: DisplayTrack[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const result = await fb.library.search(buildLibraryQuery(query), pageSize, { offset })
    if (result.success === false) throw new Error(result.error || '搜索音乐库失败。')
    tracks.push(...(result.tracks ?? []).map(normalizeTrack))
    if (!result.hasMore || !result.tracks?.length) break
  }
  return tracks
}

async function materializeRoute(route: ViewRoute): Promise<DisplayTrack[]> {
  if (route.view === 'home') return state.recentTracks
  if (route.view === 'overview') {
    await loadLibraryOverview()
    return state.recentTracks
  }
  if (route.view === 'artists') {
    await loadLibraryArtists()
    return []
  }
  if (route.view === 'artist') {
    if (!state.connected) return state.tracks.filter((track) => track.artist === route.artist || track.albumArtist === route.artist)
    const result = await fb.library.getArtistTracks(route.artist, 100000)
    return result.tracks.map(normalizeTrack)
  }
  if (route.view === 'albums') return []
  if (route.view === 'songs') {
    await enrichLibraryPlaycounts()
    return filterLibraryTracks(state.tracks)
  }
  if (route.view === 'playlist') return state.connected
    ? getAllPlaylistTracks(route.playlistIndex)
    : [...state.tracks].reverse()
  if (route.view === 'album') {
    if (!state.connected) return state.tracks.filter((track) => albumKey({ name: track.album, artist: track.albumArtist || track.artist }) === albumKey({ name: route.albumName, artist: route.albumArtist }))
    const result = await fb.library.getAlbumTracks(route.albumName, route.albumArtist)
    return result.tracks.map(normalizeTrack)
  }
  if (route.view === 'folders') {
    await loadLibraryRoots()
    return []
  }
  if (route.view === 'ipod') return []
  if (route.view === 'folder') {
    if (!state.connected) {
      state.libraryFolders = []
      return state.tracks.filter((track) => track.path.replaceAll('\\', '/').toLocaleLowerCase().startsWith(route.rootId.toLocaleLowerCase()))
    }
    const result = await fb.library.browseTree({ rootId: route.rootId, pathId: route.pathId, includeFiles: true, recursiveFiles: true })
    if (!result.success) throw new Error(result.error || '无法浏览媒体库文件夹。')
    state.libraryFolders = result.directories.map((folder): LibraryFolderCard => ({
      rootId: folder.rootId,
      pathId: folder.pathId,
      name: folder.displayName || folder.name,
      absolutePath: folder.absolutePath,
      trackCount: folder.trackCount,
      hasChildren: folder.hasChildren,
    }))
    return result.files.map(normalizeTrack)
  }
  if (route.view === 'search') return loadSearchTracks(route.query)
  if (route.view === 'favourites') {
    if (!state.connected) return state.tracks.filter((track) => Number(track.rating ?? 0) === 5)
    const tracks: DisplayTrack[] = []
    for (let offset = 0; ; offset += 1000) {
      const result = await fb.library.search('rating IS 5', 1000, { offset })
      if (result.success === false) throw new Error(result.error || '无法加载收藏。')
      tracks.push(...result.tracks.map(normalizeTrack))
      if (!result.hasMore || !result.tracks.length) break
    }
    return tracks
  }
  if (route.snapshot) return route.snapshot
  if (!state.connected) return [...state.tracks].sort(() => Math.random() - 0.5).slice(0, 30)
  const result = await fb.library.getRandomTracks(50)
  if (result.success === false) throw new Error(result.error || '无法加载电台。')
  return result.tracks.map(normalizeTrack)
}

async function loadLibraryOverview() {
  if (!state.connected) {
    state.libraryStats = {
      totalTracks: state.tracks.length,
      totalAlbums: state.albums.length,
      totalArtists: new Set(state.tracks.map((track) => track.artist).filter(Boolean)).size,
      totalDuration: state.tracks.reduce((total, track) => total + Number(track.duration || 0), 0),
      totalSize: 0,
    }
    return
  }
  state.libraryStats = await fb.library.getStats()
}

async function loadLibraryArtists() {
  if (!state.connected) {
    const artists = new Map<string, { tracks: number; albums: Set<string>; duration: number }>()
    state.tracks.forEach((track) => {
      const name = track.artist || '未知艺术家'
      const current = artists.get(name) ?? { tracks: 0, albums: new Set<string>(), duration: 0 }
      current.tracks += 1
      if (track.album) current.albums.add(track.album)
      current.duration += Number(track.duration || 0)
      artists.set(name, current)
    })
    state.artists = [...artists].map(([name, value]): ArtistInfo => ({ name, trackCount: value.tracks, albumCount: value.albums.size, duration: value.duration }))
    return
  }
  const result = await fb.library.getArtists(100000)
  if (!result.success) throw new Error(result.error || '无法加载艺术家。')
  state.artists = result.items
}

async function loadLibraryRoots() {
  if (!state.connected) {
    const folders = new Map<string, number>()
    state.tracks.forEach((track) => {
      const path = track.path.replaceAll('\\', '/')
      const folder = path.slice(0, Math.max(0, path.lastIndexOf('/') + 1))
      if (folder) folders.set(folder, (folders.get(folder) ?? 0) + 1)
    })
    state.libraryFolders = [...folders].map(([path, trackCount]) => ({ rootId: path, pathId: '', name: path.replace(/\/$/, '').split('/').pop() || path, absolutePath: path, trackCount, hasChildren: false }))
    return
  }
  const result = await fb.library.getRoots()
  if (!result.success) throw new Error(result.error || '无法加载媒体库文件夹。')
  state.libraryFolders = result.roots.map((root) => ({ rootId: root.id, pathId: '', name: root.displayName, absolutePath: root.absolutePath, trackCount: root.trackCount, hasChildren: true }))
}

async function enrichLibraryPlaycounts() {
  if (!state.connected || playcountLibraryGeneration === libraryGeneration) return
  const generation = libraryGeneration
  for (let start = 0; start < state.tracks.length; start += 500) {
    const batch = state.tracks.slice(start, start + 500)
    const result = await fb.playcount.getBatch(batch.map(playablePath))
    if (generation !== libraryGeneration) return
    result.results.forEach((item, index) => {
      if (!batch[index]) return
      batch[index].playCount = item.playCount ?? 0
      batch[index].lastPlayed = item.lastPlayed ?? ''
      if (item.rating != null) batch[index].rating = item.rating
    })
  }
  playcountLibraryGeneration = generation
}

function matchesLibraryRule(track: DisplayTrack, rule: LibraryFilterRule) {
  const query = rule.value.trim().toLocaleLowerCase()
  if (!query) return true
  const fields = rule.field === 'all'
    ? [track.title, track.artist, track.albumArtist || track.artist, track.album, track.genre || '', track.path]
    : [rule.field === 'albumArtist' ? track.albumArtist || track.artist : String(track[rule.field as Exclude<LibraryFilterField, 'all'>] || '')]
  if (rule.field === 'genre' && rule.operator === 'equals') {
    return fields[0].split(/[;,]/).some((value) => value.trim().toLocaleLowerCase() === query)
  }
  return fields.some((field) => {
    const value = field.toLocaleLowerCase()
    if (rule.operator === 'equals') return value === query
    if (rule.operator === 'startsWith') return value.startsWith(query)
    return value.includes(query)
  })
}

function filterLibraryTracks(tracks: DisplayTrack[]) {
  const filters = state.libraryFilters
  const activeRules = filters.rules.filter((rule) => rule.value.trim())
  const filtered = tracks.filter((track) => {
    if (filters.artist && track.artist.toLocaleLowerCase() !== filters.artist.toLocaleLowerCase()) return false
    if (filters.albumArtist && (track.albumArtist || track.artist).toLocaleLowerCase() !== filters.albumArtist.toLocaleLowerCase()) return false
    if (filters.genre && !String(track.genre || '').split(/[;,]/).some((value) => value.trim().toLocaleLowerCase() === filters.genre.toLocaleLowerCase())) return false
    if (filters.folder && !track.path.replaceAll('\\', '/').toLocaleLowerCase().startsWith(filters.folder.toLocaleLowerCase())) return false
    if (filters.playState === 'played' && !track.playCount) return false
    if (filters.playState === 'unplayed' && track.playCount) return false
    if (!activeRules.length) return true
    return filters.matchMode === 'all'
      ? activeRules.every((rule) => matchesLibraryRule(track, rule))
      : activeRules.some((rule) => matchesLibraryRule(track, rule))
  })
  return filters.playState === 'recent'
    ? filtered.filter((track) => track.lastPlayed).sort((a, b) => String(b.lastPlayed).localeCompare(String(a.lastPlayed)))
    : filtered
}

async function refreshLibraryFilters() {
  if (state.route.view === 'songs') await navigate(state.route, 'none')
}

async function setLibraryFilterFacet(key: 'artist' | 'albumArtist' | 'genre' | 'folder' | 'playState', value: string) {
  Object.assign(state.libraryFilters, { [key]: value })
  await refreshLibraryFilters()
}

async function addLibraryFilterRule() {
  state.libraryFilters.rules.push({ id: crypto.randomUUID(), field: 'all', operator: 'contains', value: '' })
}

async function updateLibraryFilterRule(id: string, patch: Partial<Pick<LibraryFilterRule, 'field' | 'operator' | 'value'>>) {
  const rule = state.libraryFilters.rules.find((item) => item.id === id)
  if (!rule) return
  Object.assign(rule, patch)
  await refreshLibraryFilters()
}

async function removeLibraryFilterRule(id: string) {
  if (state.libraryFilters.rules.length === 1) Object.assign(state.libraryFilters.rules[0], { field: 'all', operator: 'contains', value: '' })
  else state.libraryFilters.rules = state.libraryFilters.rules.filter((rule) => rule.id !== id)
  await refreshLibraryFilters()
}

async function setLibraryFilterMatchMode(mode: LibraryFilterMatchMode) {
  state.libraryFilters.matchMode = mode
  await refreshLibraryFilters()
}

async function clearLibraryFilters() {
  Object.assign(state.libraryFilters, { artist: '', albumArtist: '', genre: '', folder: '', playState: 'all', matchMode: 'all', rules: [{ id: 'primary', field: 'all', operator: 'contains', value: '' }] })
  await refreshLibraryFilters()
}

async function applyCustomColumn(label: string, pattern: string) {
  const trimmedPattern = pattern.trim()
  if (!trimmedPattern) {
    state.customColumn = { label: '', pattern: '' }
    customColumnValues.clear()
    state.viewTracks.forEach((track) => { track.customValue = undefined })
    state.visibleTracks = state.viewTracks.slice()
    return
  }
  const tracks = state.visibleTracks
  if (!await evaluateCustomColumn(tracks, trimmedPattern)) return
  state.customColumn = { label: label.trim() || '自定义', pattern: trimmedPattern }
}

async function navigate(route: ViewRoute, historyMode: 'push' | 'replace' | 'none' = 'push') {
  if (route.view === 'ipod' && !pluginIntegrations.dop.installed) route = { view: 'home' }
  if (route.view === 'playlist') {
    const playlistRoute = route
    const indexed = state.playlists.find((playlist) => playlist.index === playlistRoute.playlistIndex)
    if (indexed?.name !== playlistRoute.playlistName) {
      const matches = state.playlists.filter((playlist) => playlist.name === playlistRoute.playlistName)
      if (matches.length === 1) route = { ...playlistRoute, playlistIndex: matches[0].index }
      else route = { view: 'home' }
    }
  }
  const generation = ++routeGeneration
  const routeChanged = routeKey(route) !== routeKey(state.route)
  if (historyMode !== 'none') {
    state.nowPlayingOpen = false
    state.dialog = null
  }
  if (searchTimer && routeChanged) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
  if (historyMode === 'push' && routeKey(route) !== routeKey(state.route)) {
    history.splice(historyIndex + 1)
    history.push(route)
    historyIndex = history.length - 1
  } else if (historyMode === 'replace') {
    history[historyIndex] = route
  }
  state.route = route
  state.view = route.view
  if (route.view === 'search') state.search = route.query
  state.selectedAlbum = route.view === 'album'
    ? state.albums.find((album) => albumKey(album) === albumKey({ name: route.albumName, artist: route.albumArtist })) ?? null
    : null
  state.browsingPlaylist = route.view === 'playlist'
    ? state.playlists.find((playlist) => playlist.index === route.playlistIndex) ?? null
    : null
  state.searchLoading = route.view === 'search'
  updateHistoryState()
  try {
    const tracks = await materializeRoute(route)
    if (generation !== routeGeneration || routeKey(state.route) !== routeKey(route)) return
    if (route.view === 'radio' && !route.snapshot) {
      const snapshotRoute: ViewRoute = { ...route, snapshot: tracks }
      state.route = snapshotRoute
      history[historyIndex] = snapshotRoute
    }
    await setViewTracks(tracks)
  } catch (error) {
    if (generation !== routeGeneration) return
    await setViewTracks([])
    const message = error instanceof Error ? error.message : '无法加载当前页面。'
    state.error = message
    notify(message, 'error')
  } finally {
    if (generation === routeGeneration) state.searchLoading = false
  }
}

async function setView(view: ViewId, pushHistory = true) {
  if (view === 'radio') return navigate({ view: 'radio', nonce: ++radioNonce }, pushHistory ? 'push' : 'none')
  if (view === 'album' && state.selectedAlbum) return selectAlbum(state.selectedAlbum, pushHistory)
  if (view === 'playlist' && state.browsingPlaylist) return selectActivePlaylist(state.browsingPlaylist.index, pushHistory)
  if (view === 'search' && state.search.trim()) return navigate({ view: 'search', query: state.search.trim() }, pushHistory ? 'push' : 'none')
  if (view === 'album' || view === 'artist' || view === 'folder' || view === 'playlist' || view === 'search') return
  return navigate({ view }, pushHistory ? 'push' : 'none')
}

async function goBack() {
  if (!state.canGoBack) return
  state.nowPlayingOpen = false
  state.dialog = null
  historyIndex -= 1
  updateHistoryState()
  await navigate(history[historyIndex], 'none')
}

async function goForward() {
  if (!state.canGoForward) return
  state.nowPlayingOpen = false
  state.dialog = null
  historyIndex += 1
  updateHistoryState()
  await navigate(history[historyIndex], 'none')
}

function setSearch(value: string) {
  const generation = ++searchGeneration
  state.search = value
  if (state.view === 'search') routeGeneration += 1
  if (searchTimer) clearTimeout(searchTimer)
  if (!value.trim()) {
    searchTimer = null
    if (state.view === 'search') void clearSearch()
    return
  }
  const query = value.trim()
  searchTimer = setTimeout(() => {
    if (generation === searchGeneration && state.search.trim() === query) void navigate({ view: 'search', query }, state.view === 'search' ? 'replace' : 'push')
  }, 240)
}

function buildLibraryQuery(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => {
      const escaped = term.replaceAll('"', '""')
      return `(title HAS "${escaped}" OR artist HAS "${escaped}" OR album HAS "${escaped}" OR genre HAS "${escaped}")`
    })
    .join(' AND ')
}

async function submitSearch() {
  const query = state.search.trim()
  if (!query) return
  searchGeneration += 1
  await navigate({ view: 'search', query }, state.view === 'search' ? 'replace' : 'push')
}

async function clearSearch() {
  searchGeneration += 1
  state.search = ''
  state.searchLoading = false
  if (state.view === 'search') {
    if (state.canGoBack) await goBack()
    else await navigate({ view: 'home' }, 'replace')
  }
}

async function selectActivePlaylist(index?: number, pushHistory = true) {
  const selected = state.playlists.find((playlist) => playlist.index === index) ?? state.activePlaylist ?? state.playlists[0]
  if (!selected) return
  if (state.connected && index != null) {
    const result = await runAction(() => fb.playlist.setActive(index))
    if (!result) return
    state.activePlaylist = state.playlists.find((playlist) => playlist.index === index) ?? selected
  }
  await navigate({ view: 'playlist', playlistIndex: selected.index, playlistName: selected.name }, pushHistory ? 'push' : 'none')
}

async function refreshActivePlaylist() {
  if (state.route.view !== 'playlist') return
  await navigate(state.route, 'none')
}

async function selectAlbum(album: AlbumCard, pushHistory = true) {
  await navigate({ view: 'album', albumName: album.name, albumArtist: album.artist }, pushHistory ? 'push' : 'none')
}

async function selectArtist(artist: string, pushHistory = true) {
  await navigate({ view: 'artist', artist }, pushHistory ? 'push' : 'none')
}

async function getArtistTracks(artist: string) {
  if (!state.connected) return state.tracks.filter((track) => track.artist === artist || track.albumArtist === artist)
  const result = await runAction(() => fb.library.getArtistTracks(artist, 100000))
  return result ? attachArtwork(result.items.map(normalizeTrack)) : []
}

async function selectLibraryFolder(folder: LibraryFolderCard, pushHistory = true) {
  await navigate({ view: 'folder', rootId: folder.rootId, pathId: folder.pathId, name: folder.name }, pushHistory ? 'push' : 'none')
}

async function loadFavourites(pushHistory = true) {
  await navigate({ view: 'favourites' }, pushHistory ? 'push' : 'none')
}

async function loadRadio(pushHistory = true) {
  await navigate({ view: 'radio', nonce: ++radioNonce }, pushHistory ? 'push' : 'none')
}

async function playTrack(track: DisplayTrack, index?: number) {
  if (!track) return
  if (isSameTrack(track, state.currentTrack) && state.playbackState !== 'stopped') {
    await togglePlayback()
    return
  }
  if (!state.connected) {
    const collection = state.visibleTracks.length ? state.visibleTracks : [track]
    const currentIndex = collection.findIndex((item) => isSameTrack(item, track))
    setPlaybackWindow(collection, Math.max(0, currentIndex), -1)
    state.currentTrack = track
    state.currentArtwork = track.artworkUrl ?? state.albums.find((album) => album.name === track.album)?.artworkUrl ?? ''
    state.duration = track.duration
    state.position = 0
    state.isPlaying = true
    state.playbackState = 'playing'
    return
  }

  const route = state.route
  if (route.view === 'playlist') {
    const resolvedIndex = await resolvePlaylistTrackIndex(route.playlistIndex, track, track.sourceIndex ?? index)
    if (resolvedIndex == null) return
    const result = await runAction(() => fb.playlist.playTrack(route.playlistIndex, resolvedIndex))
    if (result) setPlaybackWindow(state.visibleTracks, resolvedIndex, route.playlistIndex)
    return
  }
  const collection = state.visibleTracks.length ? state.visibleTracks : [track]
  const startIndex = collection.findIndex((item) => isSameTrack(item, track))
  await playGeneratedCollection(startIndex >= 0 ? collection : [track], Math.max(0, startIndex))
}

async function getOwnerId() {
  if (ownerIdPromise) return ownerIdPromise
  ownerIdPromise = (async () => {
    const existing = await fb.config.get(ownershipConfigKey)
    const stored = existing.value as { ownerId?: unknown } | null
    if (stored && typeof stored.ownerId === 'string' && /^[0-9a-f-]{36}$/i.test(stored.ownerId)) return stored.ownerId
    const ownerId = crypto.randomUUID()
    const saved = await fb.config.set(ownershipConfigKey, { ownerId })
    if (!saved.success) throw new Error(saved.error || '无法保存主题播放上下文标识。')
    return ownerId
  })()
  try {
    return await ownerIdPromise
  } catch (error) {
    ownerIdPromise = null
    throw error
  }
}

async function ensureOwnedPlaybackPlaylist() {
  if (ownedPlaylistPromise) return ownedPlaylistPromise
  ownedPlaylistPromise = (async () => {
    const ownerId = await getOwnerId()
    const name = `正在播放 [foo-theme:${ownerId}]`
    const playlists = await fb.playlist.getAll()
    const matches = playlists.filter((playlist) => playlist.name === name)
    if (matches.length > 1) throw new Error('检测到重复的主题播放上下文，已停止以保护播放列表。')
    const existing = matches[0]
    if (existing) {
      if (existing.isLocked || existing.isAutoplaylist) throw new Error('主题播放上下文不可写，已停止以保护播放列表。')
      return { index: existing.index, name }
    }
    const created = await fb.playlist.create(name)
    if (!Number.isInteger(created.index) || created.index < 0) throw new Error('无法创建主题播放上下文。')
    await loadPlaylists()
    return { index: created.index, name }
  })()
  try {
    return await ownedPlaylistPromise
  } finally {
    ownedPlaylistPromise = null
  }
}

async function playGeneratedCollection(tracks: DisplayTrack[], playIndex = 0, random = false, message?: string) {
  const requestedIndex = Number.isInteger(playIndex) ? playIndex : 0
  const entries = tracks.map((track, originalIndex) => ({ originalIndex, path: playablePath(track) })).filter((item) => item.path)
  const mappedPlayIndex = entries.findIndex((item) => item.originalIndex === requestedIndex)
  return runAction(async () => {
    if (!entries.length) throw new Error('没有可播放的曲目。')
    if (mappedPlayIndex < 0) throw new Error('所选曲目没有可播放路径。')
    const context = await ensureOwnedPlaybackPlaylist()
    const playlists = await fb.playlist.getAll()
    const latest = playlists.find((playlist) => playlist.name === context.name)
    const matches = playlists.filter((playlist) => playlist.name === context.name)
    if (!latest || matches.length !== 1 || latest.isLocked || latest.isAutoplaylist) throw new Error('主题播放上下文已变化，已停止以保护播放列表。')
    const previousOrder = random ? await fb.player.getOrder() : null
    let orderChanged = false
    try {
      if (random) {
        const order = await fb.player.setOrder('random')
        if (!order.success) throw new Error(order.error || '无法启用随机播放。')
        orderChanged = true
      }
      const result = await fb.playlist.replaceAllAndPlay({ playlist: latest.index, paths: entries.map((item) => item.path), playIndex: mappedPlayIndex })
      if (result.success === false) throw new Error(result.error || '无法播放所选集合。')
      setPlaybackWindow(entries.map((entry) => tracks[entry.originalIndex]), mappedPlayIndex, latest.index)
      if (random) state.playbackOrder = 3
      return result
    } catch (error) {
      if (orderChanged && previousOrder) {
        await fb.player.setOrder(previousOrder.order)
        state.playbackOrder = previousOrder.order
      }
      throw error
    }
  }, message)
}

async function playTrackCollection(tracks: DisplayTrack[], random = false) {
  if (!tracks.length) {
    notify('所选文件夹没有可播放的曲目。', 'info')
    return
  }
  await playGeneratedCollection(tracks, random ? Math.floor(Math.random() * tracks.length) : 0, random, random ? '已随机播放所选文件夹' : undefined)
}

async function resolvePlaylistTrackIndex(playlistIndex: number, track: DisplayTrack, hintedIndex?: number) {
  if (hintedIndex != null && hintedIndex >= 0) {
    const candidate = await fb.playlist.getTracks(playlistIndex, hintedIndex, 1)
    if (candidate[0] && trackKey(candidate[0]) === trackKey(track)) return hintedIndex
  }
  const tracks = await getAllPlaylistTracks(playlistIndex)
  const matches = tracks.filter((item) => isSameTrack(item, track))
  if (matches.length === 1) return matches[0].sourceIndex ?? null
  notify('播放列表已变化，无法安全定位曲目。', 'error')
  if (state.route.view === 'playlist' && state.route.playlistIndex === playlistIndex) await refreshActivePlaylist()
  return null
}

async function getAllPlaylistTracks(playlistIndex: number) {
  const { count } = await fb.playlist.getCount(playlistIndex)
  const tracks: DisplayTrack[] = []
  for (let start = 0; start < count; start += 1000) {
    const page = await fb.playlist.getTracks(playlistIndex, start, Math.min(1000, count - start))
    tracks.push(...page.map((track, offset) => ({ ...normalizeTrack(track), sourceIndex: start + offset })))
  }
  return tracks
}

async function playAlbum(album: AlbumCard) {
  if (!state.connected) {
    const firstTrack = state.tracks.find((track) => track.album === album.name) ?? state.tracks[0]
    if (firstTrack) await playTrack(firstTrack)
    return
  }

  const result = await runAction(() => fb.library.getAlbumTracks(album.name, album.artist))
  if (!result) return
  const tracks = result.tracks.map(normalizeTrack)
  if (!tracks.length) {
    notify('此专辑没有可播放的曲目。', 'info')
    return
  }
  await playGeneratedCollection(tracks)
}

async function getAlbumTracks(album: AlbumCard) {
  if (!state.connected) return state.tracks.filter((track) => track.album === album.name)
  const result = await runAction(() => fb.library.getAlbumTracks(album.name, album.artist))
  return result ? result.tracks.map(normalizeTrack) : []
}

async function getFolderTracks(folder: LibraryFolderCard) {
  if (!state.connected) {
    const prefix = folder.absolutePath.replaceAll('\\', '/').toLocaleLowerCase()
    return state.tracks.filter((track) => (track.absolutePath || track.path).replaceAll('\\', '/').toLocaleLowerCase().startsWith(prefix))
  }
  const result = await runAction(() => fb.library.browseTree({ rootId: folder.rootId, pathId: folder.pathId, includeFiles: true, recursiveFiles: true }))
  return result ? result.files.map(normalizeTrack) : []
}

async function shuffleAlbum(album: AlbumCard) {
  const tracks = await getAlbumTracks(album)
  if (!tracks.length) {
    notify('此专辑没有可播放的曲目。', 'info')
    return
  }
  if (!state.connected) {
    await playTrack(tracks[Math.floor(Math.random() * tracks.length)])
    return
  }
  await playGeneratedCollection(tracks, Math.floor(Math.random() * tracks.length), true, '已随机播放专辑')
}

async function queueAlbum(album: AlbumCard) {
  const tracks = await getAlbumTracks(album)
  const paths = tracks.map(playablePath).filter(Boolean)
  if (!paths.length) return
  if (!state.connected) {
    const firstIndex = state.queue.filter((item) => item.queueSource === 'explicit').length
    state.queue.push(...tracks.map((track, offset) => ({ ...track, queueSource: 'explicit' as const, sourceIndex: firstIndex + offset })))
    notify(`已将 ${tracks.length} 首曲目添加到队列`, 'success')
    return
  }
  const result = await runAction(() => fb.queue.addPaths(paths))
  if (result) notify(`已将 ${result.addedCount ?? 0} 首曲目添加到队列${result.invalidCount ? `，跳过 ${result.invalidCount} 项` : ''}`, result.invalidCount ? 'info' : 'success')
  await loadQueue()
}

async function addAlbumToPlaylist(album: AlbumCard, playlistIndex: number) {
  const playlist = state.playlists.find((item) => item.index === playlistIndex)
  if (!playlist) return
  const tracks = await getAlbumTracks(album)
  if (playlist.isLocked || playlist.isAutoplaylist) return
  const paths = tracks.map(playablePath).filter(Boolean)
  if (!paths.length) return
  if (!state.connected) {
    notify(`已将 ${tracks.length} 首曲目添加到“${playlist.name}”`, 'success')
    return
  }
  await runAction(() => fb.playlist.add(playlistIndex, paths), `已将 ${paths.length} 首曲目添加到“${playlist.name}”`)
}

async function playPlaylist(playlistIndex: number, shuffled = false) {
  const playlist = state.playlists.find((item) => item.index === playlistIndex)
  if (!playlist) return
  if (!state.connected) {
    const tracks = shuffled ? [...state.tracks].sort(() => Math.random() - 0.5) : state.tracks
    if (tracks[0]) await playTrack(tracks[0])
    return
  }
  if (!playlist.trackCount) {
    notify('此播放列表为空。', 'info')
    return
  }
  if (!shuffled) {
    await runAction(() => fb.playlist.playTrack(playlistIndex, 0))
    return
  }
  if (!await setRandomOrder()) return
  await runAction(() => fb.playlist.playTrack(playlistIndex, Math.floor(Math.random() * playlist.trackCount)), '已启用原生随机播放')
}

async function duplicatePlaylist(playlistIndex: number) {
  const playlist = state.playlists.find((item) => item.index === playlistIndex)
  if (!playlist) return
  if (!state.connected) {
    notify(`已复制“${playlist.name}”`, 'success')
    return
  }
  const result = await runAction(() => fb.playlist.duplicate(playlistIndex), `已复制“${playlist.name}”`)
  if (result) await loadPlaylists()
}

async function clearPlaylist(playlistIndex: number) {
  const playlist = state.playlists.find((item) => item.index === playlistIndex)
  if (!playlist || playlist.isLocked || playlist.isAutoplaylist) return
  if (!state.connected) {
    notify(`已清空“${playlist.name}”`, 'success')
    return
  }
  const confirmation = await fb.dialog.confirm({
    title: '清空播放列表',
    message: `确定要移除“${playlist.name}”中的全部曲目吗？`,
    type: 'warning',
    buttons: ['清空', '取消'],
    defaultButton: 1,
  })
  if (!confirmation.confirmed) return
  const result = await runAction(() => fb.playlist.clear(playlistIndex), `已清空“${playlist.name}”`)
  if (result && state.route.view === 'playlist' && state.route.playlistIndex === playlistIndex) await refreshActivePlaylist()
  await loadPlaylists()
}

async function removePlaylist(playlistIndex: number) {
  const playlist = state.playlists.find((item) => item.index === playlistIndex)
  if (!playlist) return
  if (playlist.isLocked && !playlist.isAutoplaylist) {
    notify('此播放列表已锁定，无法删除。', 'info')
    return
  }
  if (!state.connected) {
    state.playlists = state.playlists.filter((item) => item.index !== playlistIndex)
    notify(`已删除“${playlist.name}”`, 'success')
    return
  }
  if (state.activePlaylist?.index === playlistIndex) {
    const fallback = state.playlists.find((item) => item.index !== playlistIndex)
    if (fallback) await runAction(() => fb.playlist.setActive(fallback.index))
  }
  let targetIndex = playlistIndex
  if (playlist.isAutoplaylist) {
    const converted = await runAction(() => fb.playlist.removeAutoplaylist(playlistIndex))
    if (!converted) return
    await loadPlaylists()
    const matches = state.playlists.filter((item) => item.name === playlist.name && !item.isAutoplaylist)
    if (matches.length !== 1) {
      notify('无法安全确认转换后的播放列表，已停止删除。', 'error')
      return
    }
    targetIndex = matches[0].index
    if (matches[0].isLocked) {
      notify('自动播放列表已转换，但仍处于锁定状态，未继续删除。', 'error')
      return
    }
  }
  const result = await runAction(() => fb.playlist.remove(targetIndex), `已删除“${playlist.name}”`)
  if (!result) return
  await loadPlaylists()
  if (state.route.view === 'playlist' && state.route.playlistName === playlist.name) {
    await navigate({ view: 'home' }, 'replace')
  }
}

async function undoPlaylistChange(playlistIndex: number) {
  if (!state.connected) return
  const result = await runAction(() => fb.playlist.undo(playlistIndex), '已撤销播放列表更改')
  if (result) {
    await loadPlaylists()
    if (state.route.view === 'playlist' && state.route.playlistIndex === playlistIndex) await refreshActivePlaylist()
  }
}

async function reorderPlaylistTrack(from: number, to: number, after = false) {
  const route = state.route
  if (route.view !== 'playlist' || from === to) return
  const playlist = state.playlists.find((item) => item.index === route.playlistIndex)
  if (!playlist || playlist.isLocked || playlist.isAutoplaylist) return
  const sourceTrack = state.visibleTracks[from]
  if (!sourceTrack) return
  const resolved = await resolvePlaylistTrackIndex(route.playlistIndex, sourceTrack, sourceTrack.sourceIndex)
  if (resolved == null) return
  const targetTrack = state.visibleTracks[to]
  const target = targetTrack ? await resolvePlaylistTrackIndex(route.playlistIndex, targetTrack, targetTrack.sourceIndex) : to
  if (target == null) return
  const delta = target > resolved
    ? target - resolved - (after ? 0 : 1)
    : target - resolved + (after ? 1 : 0)
  if (!delta) return
  const result = await runAction(() => fb.playlist.moveTracks(route.playlistIndex, [resolved], delta), '已调整播放列表顺序')
  if (result) await refreshActivePlaylist()
}

async function reorderPlaylists(order: number[]) {
  const currentOrder = state.playlists.map((playlist) => playlist.index)
  if (order.length !== currentOrder.length || new Set(order).size !== order.length || order.some((index) => !currentOrder.includes(index))) return
  if (order.every((index, position) => index === currentOrder[position])) return
  const [allPlaylists, ownerId] = await Promise.all([fb.playlist.getAll(), getOwnerId()])
  const internalName = `正在播放 [foo-theme:${ownerId}]`
  const visiblePlaylists = allPlaylists.filter((playlist) => playlist.name !== internalName && playlist.name !== '[WebView Queue]')
  if (visiblePlaylists.length !== order.length || visiblePlaylists.some((playlist) => !order.includes(playlist.index))) {
    notify('播放列表已变化，请重新拖动排序。', 'info')
    await loadPlaylists()
    return
  }
  const oldPositionByIndex = new Map(allPlaylists.map((playlist, position) => [playlist.index, position]))
  let nextVisible = 0
  const merged = allPlaylists.map((playlist) => {
    if (playlist.name === internalName || playlist.name === '[WebView Queue]') return playlist.index
    return order[nextVisible++]
  })
  const newOrder = merged.map((index) => oldPositionByIndex.get(index))
  if (newOrder.some((position) => position == null)) return
  const result = await runAction(() => fb.playlist.reorderPlaylists(newOrder as number[]), '已调整播放列表顺序')
  if (result) await loadPlaylists()
}

async function sortPlaylist(playlistIndex: number, pattern: string, descending = false) {
  const playlist = state.playlists.find((item) => item.index === playlistIndex)
  if (!playlist || playlist.isLocked || playlist.isAutoplaylist) return
  const result = await runAction(() => fb.playlist.sort(playlistIndex, pattern, descending), '播放列表已排序')
  if (result && state.route.view === 'playlist' && state.route.playlistIndex === playlistIndex) await refreshActivePlaylist()
}

async function shuffleCurrent() {
  if (!state.visibleTracks.length) {
    notify('没有可随机播放的曲目。', 'info')
    return
  }
  if (!state.connected) {
    await playTrack(state.visibleTracks[Math.floor(Math.random() * state.visibleTracks.length)])
    return
  }
  const route = state.route
  if (route.view === 'playlist') {
    if (!await setRandomOrder()) return
    const track = state.visibleTracks[Math.floor(Math.random() * state.visibleTracks.length)]
    const index = await resolvePlaylistTrackIndex(route.playlistIndex, track, track.sourceIndex)
    if (index == null) return
    await runAction(() => fb.playlist.playTrack(route.playlistIndex, index), '已启用原生随机播放')
  } else {
    await playGeneratedCollection(state.visibleTracks, Math.floor(Math.random() * state.visibleTracks.length), true, '已启用原生随机播放')
  }
}

async function setRandomOrder() {
  const previous = state.playbackOrder
  const result = await runAction(() => fb.player.setOrder('random'))
  if (result) state.playbackOrder = 3
  else state.playbackOrder = previous
  await loadQueue()
  return result
}

async function togglePlayback() {
  if (!state.connected) {
    state.isPlaying = !state.isPlaying
    state.playbackState = state.isPlaying ? 'playing' : 'paused'
    return
  }
  const result = await runAction(() => fb.player.toggle())
  if (result) {
    state.isPlaying = result.isPlaying
    state.playbackState = result.isPlaying ? 'playing' : 'paused'
  }
}

async function next() {
  if (state.connected) await runAction(() => fb.player.next())
  else if (state.tracks.length) {
    const current = state.tracks.findIndex((track) => isSameTrack(track, state.currentTrack))
    await playTrack(state.tracks[(current + 1) % state.tracks.length])
  }
}

async function previous() {
  if (state.position > 2 && state.canSeek) {
    await seek(0)
    return
  }
  if (state.connected) await runAction(() => fb.player.prev())
  else if (state.tracks.length) {
    const current = state.tracks.findIndex((track) => isSameTrack(track, state.currentTrack))
    await playTrack(state.tracks[current >= 0 ? (current - 1 + state.tracks.length) % state.tracks.length : state.tracks.length - 1])
  }
}

async function seek(position: number) {
  if (!state.canSeek || !Number.isFinite(position)) return false
  const previous = state.position
  const target = Math.min(Math.max(0, position), Math.max(0, state.duration))
  state.position = target
  if (!state.connected) return true
  const result = await runAction(() => fb.player.seek(target))
  if (!result) {
    state.position = previous
    return false
  }
  state.position = result.actualPosition ?? result.newPosition ?? target
  return true
}

async function seekAndPlay(position: number) {
  if (!await seek(position)) return
  if (state.playbackState !== 'playing') {
    const result = await runAction(() => fb.player.play())
    if (result) {
      state.isPlaying = true
      state.playbackState = 'playing'
    }
  }
}

async function syncPlaybackCapabilities() {
  if (!state.connected) return
  const playback = await fb.player.getState()
  state.canSeek = playback.canSeek
  state.playbackState = playback.state
  state.isPlaying = playback.state === 'playing'
}

async function playPlaybackTrack(track: DisplayTrack) {
  if (!state.connected) return playTrack(track)
  const playlistIndex = state.playingPlaylistIndex
  const trackIndex = track.sourceIndex
  if (playlistIndex < 0 || trackIndex == null || trackIndex < 0) return
  const candidate = await fb.playlist.getTracks(playlistIndex, trackIndex, 1)
  if (!candidate[0] || trackKey(candidate[0]) !== trackKey(track)) {
    notify('正在播放的列表已变化，已重新同步。', 'info')
    await loadPlaybackSequence()
    return
  }
  await runAction(() => fb.playlist.playTrack(playlistIndex, trackIndex))
}

async function setVolume(volume: number) {
  state.volume = volume
  if (state.connected) {
    const result = await runAction(() => fb.player.setVolume(volume))
    if (!result) {
      const actual = await fb.player.getVolume()
      state.volume = actual.volume
      state.muted = actual.muted
    }
  }
}

async function toggleMute() {
  if (state.connected) {
    const result = await runAction(() => fb.player.toggleMute())
    if (result) state.muted = result.muted
  } else {
    state.muted = !state.muted
  }
}

async function cyclePlaybackOrder() {
  const current = playbackOrders.findIndex((item) => item.index === state.playbackOrder)
  const next = playbackOrders[(current + 1) % playbackOrders.length]
  if (!state.connected) {
    state.playbackOrder = next.index
    notify(next.label)
    return
  }
  const previous = state.playbackOrder
  const result = await runAction(() => fb.player.setOrder(next.mode))
  if (result) {
    state.playbackOrder = next.index
    notify(next.label)
  } else {
    const actual = await fb.player.getOrder()
    state.playbackOrder = actual.order ?? previous
  }
  await loadQueue()
}

async function createPlaylist(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  if (!state.connected) {
    const index = Math.max(-1, ...state.playlists.map((playlist) => playlist.index)) + 1
    state.playlists.push({ index, name: trimmed, trackCount: 0, isActive: false, isPlaying: false, isLocked: false })
    state.dialog = null
    notify(`已创建“${trimmed}”`, 'success')
    return
  }
  const result = await runAction(() => fb.playlist.create(trimmed), `已创建“${trimmed}”`)
  if (!result) return
  state.dialog = null
  await loadPlaylists()
  await selectActivePlaylist(result.index)
}

async function createAutoPlaylist(name: string, query: string, sort = '', keepSorted = true) {
  const trimmed = name.trim()
  if (!trimmed || !query.trim()) return
  if (!state.connected) {
    notify('自动播放列表仅可在 foobar2000 中创建。', 'info')
    return
  }
  const result = await runAction(() => fb.playlist.createAutoplaylist(trimmed, query.trim(), sort.trim(), keepSorted), `已创建自动播放列表“${trimmed}”`)
  if (!result) return
  state.dialog = null
  await loadPlaylists()
  await selectActivePlaylist(result.index)
}

async function addToQueue(track: DisplayTrack) {
  if (!state.connected) {
    state.queue.push({ ...track, queueSource: 'explicit', sourceIndex: state.queue.length })
    notify('已添加到播放队列', 'success')
    return
  }
  await runAction(() => fb.queue.addPaths([playablePath(track)]), '已添加到播放队列')
  await loadQueue()
}

async function addTracksToQueue(tracks: DisplayTrack[]) {
  if (!tracks.length) return
  if (!state.connected) {
    const offset = state.queue.filter((item) => item.queueSource === 'explicit').length
    state.queue.push(...tracks.map((track, index) => ({ ...track, queueSource: 'explicit' as const, sourceIndex: offset + index })))
    return
  }
  const result = await runAction(() => fb.queue.addPaths(tracks.map(playablePath)))
  if (!result) return
  notify(`已将 ${result.addedCount ?? tracks.length} 首曲目添加到队列`, 'success')
  await loadQueue()
}

async function addToActivePlaylist(track: DisplayTrack) {
  if (!state.activePlaylist) {
    notify('当前没有可用的播放列表。', 'error')
    return
  }
  if (!state.connected) {
    notify(`已添加到“${state.activePlaylist.name}”`, 'success')
    return
  }
  await addToPlaylist(track, state.activePlaylist.index)
}

async function addToPlaylist(track: DisplayTrack, playlistIndex: number) {
  const playlist = state.playlists.find((item) => item.index === playlistIndex)
  if (!playlist || playlist.isLocked || playlist.isAutoplaylist) return
  if (!state.connected) {
    notify(`已添加到“${playlist.name}”`, 'success')
    return
  }
  await runAction(() => fb.playlist.add(playlistIndex, [playablePath(track)]), `已添加到“${playlist.name}”`)
}

  async function addTracksToPlaylist(tracks: DisplayTrack[], playlistIndex: number) {
  const playlist = state.playlists.find((item) => item.index === playlistIndex)
  if (!playlist || playlist.isLocked || playlist.isAutoplaylist || !tracks.length) return
  const result = await runAction(() => fb.playlist.add(playlistIndex, tracks.map(playablePath)))
    if (result) notify(`已将 ${result.addedCount ?? tracks.length} 首曲目添加到“${playlist.name}”`, 'success')
  }

  async function moveTracksToPlaylist(tracks: DisplayTrack[], sourcePlaylistIndex: number, destinationPlaylistIndex: number) {
    const source = state.playlists.find((item) => item.index === sourcePlaylistIndex)
    const destination = state.playlists.find((item) => item.index === destinationPlaylistIndex)
    if (!source || !destination || sourcePlaylistIndex === destinationPlaylistIndex || source.isLocked || source.isAutoplaylist || destination.isLocked || destination.isAutoplaylist || !tracks.length) return
    const indexes = (await Promise.all(tracks.map((track) => resolvePlaylistTrackIndex(sourcePlaylistIndex, track, track.sourceIndex))))
      .filter((index): index is number => index != null)
      .sort((a, b) => b - a)
    if (indexes.length !== tracks.length) {
      notify('播放列表已变化，请重新选择后再移动。', 'info')
      return
    }
    const added = await runAction(() => fb.playlist.add(destinationPlaylistIndex, tracks.map(playablePath)))
    if (!added) return
    const removed = await runAction(() => fb.playlist.removeTracks(sourcePlaylistIndex, indexes))
    if (!removed) return
    notify(`已将 ${tracks.length} 首曲目移动至“${destination.name}”`, 'success')
    if (state.route.view === 'playlist' && state.route.playlistIndex === sourcePlaylistIndex) await refreshActivePlaylist()
  }

async function playNext(track: DisplayTrack) {
  if (!state.connected) {
    state.queue.unshift({ ...track, queueSource: 'explicit', sourceIndex: 0 })
    notify('将作为下一首播放', 'success')
    return
  }
  const added = await runAction(() => fb.queue.addPaths([playablePath(track)]))
  if (!added || !added.addedCount) return
  const addedIndex = Math.max(0, Number(added.queueCount ?? added.addedCount) - added.addedCount)
  if (addedIndex > 0) await runAction(() => fb.queue.moveToTop(addedIndex), '将作为下一首播放')
  else notify('将作为下一首播放', 'success')
  await loadQueue()
}

async function removePlaylistTrack(track: DisplayTrack, visibleIndex: number) {
  const route = state.route
  if (route.view !== 'playlist') return
  const playlist = state.playlists.find((item) => item.index === route.playlistIndex)
  if (!playlist || playlist.isLocked || playlist.isAutoplaylist) {
    notify('此播放列表不允许移除曲目。', 'info')
    return
  }
  const hintedIndex = track.sourceIndex ?? visibleIndex
  if (!state.connected) {
    const demoIndex = state.viewTracks.findIndex((item) => isSameTrack(item, track))
    if (demoIndex >= 0) state.viewTracks.splice(demoIndex, 1)
    state.visibleTracks = state.viewTracks.slice()
    notify('已从播放列表移除', 'success')
    return
  }
  if (!Number.isInteger(hintedIndex) || hintedIndex < 0) return
  const index = await resolvePlaylistTrackIndex(route.playlistIndex, track, hintedIndex)
  if (index == null) return
  const result = await runAction(() => fb.playlist.removeTracks(route.playlistIndex, [index]), '已从播放列表移除')
  if (!result) return
  await refreshActivePlaylist()
}

async function getOutputDevices() {
  if (!state.connected) {
    notify('输出设备仅可在 foobar2000 中设置。', 'info')
    return []
  }
  return (await runAction(() => fb.config.getOutputDevices())) ?? []
}

async function setOutputDevice(outputId: string, deviceId: string, name: string) {
  if (!state.connected) return
  await runAction(() => fb.config.setOutputDevice(outputId, deviceId), `已切换到 ${name}`)
}

async function loadPluginIntegrations() {
  if (!state.connected) return
  const result = await runAction(() => fb.discovery.getComponents())
  if (!result) return
  const matches: Record<PluginId, RegExp> = {
    converter: /foo_converter/i,
    freedb: /foo_freedb2?/i,
    dop: /foo_dop/i,
  }
  ;(Object.keys(matches) as PluginId[]).forEach((id) => {
    const component = result.components?.find((item) => matches[id].test(`${item.filename} ${item.name}`))
    pluginIntegrations[id].installed = Boolean(component)
    if (component) {
      pluginIntegrations[id].name = component.name || pluginIntegrations[id].name
      pluginIntegrations[id].version = component.version || ''
    }
  })
}

function pluginForMenuItem(item: Extract<MenuItem, { type: 'command' }>): PluginId | null {
  const normalized = [item.path, item.displayPath, item.label, item.displayLabel]
    .join('\n')
    .replaceAll('&', '')
    .toLocaleLowerCase()
  if (/(^|[\s/])(convert(?:er)?|转换)(?:\.{3}|…)?(?=$|[\s/])/m.test(normalized)) return 'converter'
  if (normalized.includes('freedb')) return 'freedb'
  if (/(^|[\s/])(ipod|iphone)(?=$|[\s/])/m.test(normalized)) return 'dop'
  return null
}

function collectPluginActions(items: MenuItem[], output: Record<PluginId, PluginContextAction[]>) {
  items.forEach((item) => {
    if (item.type === 'submenu') {
      collectPluginActions(item.children, output)
      return
    }
    // Old and dynamic context commands can be executable by commandId without exposing a GUID.
    if (item.type !== 'command' || item.commandId == null || item.enabled === false) return
    const id = pluginForMenuItem(item)
    if (id) output[id].push({ commandId: item.commandId, label: item.displayLabel || item.label })
  })
}

async function getPluginContextActions(tracks: DisplayTrack[]) {
  const output: Record<PluginId, PluginContextAction[]> = { converter: [], freedb: [], dop: [] }
  if (!state.connected || !tracks.length) return output
  const handles = tracks.map(playablePath).filter(Boolean)
  if (!handles.length) return output
  const result = await runAction(() => fb.menu.getContextMenu({ mode: 'handles', handles, withAvailability: true }))
  if (!result?.items) return output
  collectPluginActions(result.items, output)
  ;(Object.keys(output) as PluginId[]).forEach((id) => {
    if (output[id].length) pluginIntegrations[id].installed = true
  })
  return output
}

  async function runPluginContextAction(action: PluginContextAction, tracks: DisplayTrack[]) {
  if (!state.connected) return
  const handles = tracks.map(playablePath).filter(Boolean)
  if (!handles.length) {
    notify('所选项目没有可供插件处理的音频文件。', 'error')
    return
  }
    await runAction(() => fb.menu.runContextCommandById(action.commandId, { mode: 'handles', handles }))
  }

  async function sendTracksToIpod(tracks: DisplayTrack[]) {
    if (!pluginIntegrations.dop.installed) {
      notify('未检测到 foo_dop 组件。', 'error')
      return
    }
    const actions = await getPluginContextActions(tracks)
    const action = actions.dop.find((item) => /send\s+to\s+(?:an?\s+)?ipod|发送.*(?:到|至).*ipod/i.test(item.label))
    if (!action) {
      notify('当前 foo_dop 版本未提供“发送到 iPod”命令。', 'info')
      return
    }
    await runPluginContextAction(action, tracks)
  }

  async function sendPlaylistToIpod(playlistIndex: number) {
    const playlist = state.playlists.find((item) => item.index === playlistIndex)
    if (!playlist) return
    const tracks = await getAllPlaylistTracks(playlistIndex)
    if (!tracks.length) {
      notify(`“${playlist.name}”中没有可发送的曲目。`, 'info')
      return
    }
    await sendTracksToIpod(tracks)
  }

function clearIpodCommands() {
  ipodCommandCache.clear()
  ;(Object.keys(ipodCommands) as IpodMainAction[]).forEach((action) => { ipodCommands[action] = false })
}

function matchesIpodCommand(action: IpodMainAction, name: string, path = '') {
  const normalized = `${path} ${name}`.replaceAll('&', '').replace(/\.{3}|…/g, '').trim().toLocaleLowerCase()
  const query = ipodCommandQueries[action].find((item) => normalized.includes(item.toLocaleLowerCase()))
  if (!query) return false
  if (action === 'properties' && normalized.includes('raw properties')) return false
  return true
}

async function refreshIpodCommands() {
  clearIpodCommands()
  if (!state.connected || !pluginIntegrations.dop.installed) return
  const result = await runAction(() => fb.discovery.getMainMenuCommands({ expandDynamic: true, includeHidden: true }))
  if (!result?.commands) return
  ;(Object.keys(ipodCommands) as IpodMainAction[]).forEach((action) => {
    const command = result.commands.find((item) =>
      item.executable !== false && matchesIpodCommand(action, item.name, item.path),
    )
    if (!command) return
    ipodCommandCache.set(action, { guid: command.guid, subGuid: command.subGuid })
    ipodCommands[action] = true
  })
}

async function runIpodMainAction(action: IpodMainAction) {
  if (!state.connected) {
    notify('iPod 管理器仅可在 foobar2000 中使用。', 'info')
    return false
  }
  if (!pluginIntegrations.dop.installed) {
    notify('未检测到 foo_dop 组件。', 'error')
    return false
  }
  if (!ipodCommandCache.has(action)) await refreshIpodCommands()
  const command = ipodCommandCache.get(action)
  if (!command) {
    notify('当前 foo_dop 版本未公开此主菜单命令。', 'info')
    return false
  }
  const result = await runAction(() => fb.discovery.executeMainMenuCommand(command.guid, command.subGuid))
  if (!result) {
    ipodCommandCache.delete(action)
    ipodCommands[action] = false
  }
  return Boolean(result)
}

async function refreshIpodDeviceStatus() {
  if (!state.connected || !pluginIntegrations.dop.installed) {
    ipodDevice.status = 'unavailable'
    return
  }
  const sample = state.currentTrack ?? state.tracks.find((track) => Boolean(playablePath(track)))
  if (!sample) {
    ipodDevice.status = 'unknown'
    return
  }
  ipodDevice.probing = true
  try {
    const actions = await getPluginContextActions([sample])
    ipodDevice.status = actions.dop.some((action) => /send to ipod|发送到 ipod/i.test(action.label)) ? 'connected' : 'disconnected'
  } finally {
    ipodDevice.probing = false
  }
}

async function openIpodManager() {
  await runIpodMainAction('devicePanel')
}

async function findDesktopLyricsCommand() {
  const queries = ['显示桌面歌词', '桌面歌词', 'Desktop Lyrics', '歌词']
  for (const query of queries) {
    const result = await fb.discovery.searchCommands(query, {
      scope: 'mainmenu',
      expandDynamic: true,
      includeHidden: true,
    })
    const command = result.results?.find((item) => {
      const label = `${item.path ?? ''} ${item.name}`.toLocaleLowerCase()
      return item.type === 'mainmenu' && item.executable !== false && (label.includes('桌面歌词') || label.includes('desktop lyrics'))
    })
    if (command) return { guid: command.guid, subGuid: command.subGuid }
  }
  return null
}

async function toggleDesktopLyrics() {
  if (!state.connected) {
    notify('桌面歌词仅可在 foobar2000 中使用。', 'info')
    return
  }
  desktopLyricsCommand ??= await findDesktopLyricsCommand()
  if (!desktopLyricsCommand) {
    notify('未检测到 ESLyric 桌面歌词命令，请安装并启用对应组件。', 'error')
    return
  }
  const result = await runAction(() => fb.discovery.executeMainMenuCommand(desktopLyricsCommand!.guid, desktopLyricsCommand!.subGuid))
  if (!result) desktopLyricsCommand = null
}

async function openMiniPlayer() {
  if (!state.connected) {
    notify('迷你播放器仅可在 foobar2000 中打开。', 'info')
    return
  }
  if (miniPlayerWindowId) {
    const focused = await runAction(() => fb.ui.focus(miniPlayerWindowId))
    if (focused) {
      await runAction(() => fb.ui.minimize())
      return
    }
    miniPlayerWindowId = ''
  }
  const currentWindow = await runAction(() => fb.ui.getCurrentWindowId())
  if (!currentWindow) return
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('mode', 'mini')
  url.searchParams.set('mainWindowId', currentWindow.windowId)
  const result = await runAction(() => fb.ui.createPopup({
    url: url.href,
    width: 430,
    height: 156,
    title: 'foobar2000 迷你播放器',
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    profile: 'miniPlayer',
  }))
  miniPlayerWindowId = result?.windowId ?? ''
  if (miniPlayerWindowId) await runAction(() => fb.ui.minimize())
}

async function startWindowDrag() {
  if (state.connected) await runAction(() => fb.ui.startDrag())
}

async function toggleWindowMaximize() {
  if (state.connected) await runAction(() => fb.ui.toggleMaximize())
}

async function closeWindow() {
  if (state.connected) {
    if (parentWindowId) await runAction(() => fb.ui.sendMessage(parentWindowId, { type: 'restore-main' }))
    await runAction(() => fb.ui.close())
  }
  else window.close()
}

async function restoreCurrentWindow() {
  await fb.ui.restore()
  await fb.ui.focus()
}

async function showInExplorer(track: DisplayTrack) {
  if (!state.connected) {
    notify('文件位置功能仅可在 foobar2000 中使用。', 'info')
    return
  }
  await runAction(() => fb.shell.showInExplorer((track.absolutePath || track.path).replace(/\|subsong:\d+$/i, '')))
}

async function showFolderInExplorer(folder: LibraryFolderCard) {
  if (!state.connected) {
    notify('文件位置功能仅可在 foobar2000 中使用。', 'info')
    return
  }
  await runAction(() => fb.shell.showInExplorer(folder.absolutePath))
}

async function openTrackAlbum(track: DisplayTrack) {
  const album = state.albums.find((item) => item.name === track.album && (item.artist === track.albumArtist || item.artist === track.artist))
  if (!album) {
    notify('音乐库中没有此专辑。', 'info')
    return
  }
  await selectAlbum(album)
}

async function ensureOpenedMusicPlaylist() {
  const ownerId = await getOwnerId()
  const name = `已打开的音乐 [foo-theme:${ownerId}]`
  const playlists = await fb.playlist.getAll()
  const matches = playlists.filter((playlist) => playlist.name === name)
  if (matches.length > 1) throw new Error('检测到重复的导入播放列表，已停止以保护用户数据。')
  const existing = matches[0]
  if (existing) {
    if (existing.isLocked || existing.isAutoplaylist) throw new Error('导入播放列表不可写。')
    return { index: existing.index, name }
  }
  const created = await runAction(() => fb.playlist.create(name))
  if (!created) return null
  await loadPlaylists()
  return { index: created.index, name }
}

function windowsPathKey(path: string) {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) return path
  return path.trim().replaceAll('/', '\\').toLocaleLowerCase('en-US')
}

function resolveReferencedPath(descriptor: string, reference: string) {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(reference) || /^[a-z]:[\\/]/i.test(reference)) return reference
  const normalized = descriptor.replaceAll('/', '\\')
  const directory = normalized.slice(0, normalized.lastIndexOf('\\') + 1)
  return `${directory}${reference.replaceAll('/', '\\')}`
}

async function removeDescriptorDuplicates(paths: string[]) {
  const referenced = new Set<string>()
  const descriptors = paths.filter((path) => /\.(?:cue|m3u8?|pls)$/i.test(path))
  for (const descriptor of descriptors) {
    try {
      const { content } = await fb.file.read(descriptor)
      const references = descriptor.toLocaleLowerCase().endsWith('.cue')
        ? [...content.matchAll(/^\s*FILE\s+"([^"]+)"/gim)].map((match) => match[1])
        : descriptor.toLocaleLowerCase().endsWith('.pls')
          ? [...content.matchAll(/^\s*File\d+\s*=\s*(.+)$/gim)].map((match) => match[1].trim())
          : content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
      references.forEach((reference) => referenced.add(windowsPathKey(resolveReferencedPath(descriptor, reference))))
    } catch {
      // The host will still parse the descriptor when its text cannot be inspected.
    }
  }
  return paths.filter((path) => descriptors.includes(path) || !referenced.has(windowsPathKey(path)))
}

async function expandImportPaths(paths: string[]) {
  const expanded: string[] = []
  for (const path of paths) {
    const info = await fb.file.getInfo(path)
    if (info.success === false) throw new Error(info.error || `无法读取：${path}`)
    if (!info.exists) continue
    if (!info.isDirectory) {
      expanded.push(path)
      continue
    }
    const result = await fb.file.list(path, { recursive: true })
    if (result.success === false) throw new Error(result.error || `无法扫描文件夹：${path}`)
    const files = result.files ?? result.items ?? []
    expanded.push(...files)
  }
  const unique = [...new Map(expanded.map((path) => [windowsPathKey(path), path])).values()]
  return removeDescriptorDuplicates(unique)
}

async function importPaths(paths: string[]) {
  const cleanPaths = [...new Map(paths.filter((path) => typeof path === 'string' && path.trim()).map((path) => [windowsPathKey(path), path])).values()]
  if (!cleanPaths.length) return
  if (!state.connected) {
    notify('请在 foobar2000 窗口中打开文件或文件夹。', 'info')
    return
  }

  state.importing = true
  try {
    const expandedPaths = await runAction(() => expandImportPaths(cleanPaths))
    if (!expandedPaths?.length) {
      notify('所选位置中没有可播放的音频。', 'error')
      return
    }
    const playlist = await ensureOpenedMusicPlaylist()
    if (!playlist) return
    let addedCount = 0
    let firstAddedIndex = 0
    for (let start = 0; start < expandedPaths.length; start += 500) {
      const result = await runAction(() => fb.playlist.add(playlist.index, expandedPaths.slice(start, start + 500)))
      if (!result) {
        if (addedCount) notify(`已导入 ${addedCount} 首，后续批次失败。`, 'error')
        return
      }
      if (!addedCount) firstAddedIndex = result.countBefore
      addedCount += result.addedCount
    }
    if (!addedCount) {
      notify('所选位置中没有可播放的音频。', 'error')
      return
    }
    await loadPlaylists()
    await selectActivePlaylist(playlist.index)
    await runAction(() => fb.playlist.playTrack(playlist.index, firstAddedIndex))
    notify(`已在“${playlist.name}”中打开 ${addedCount} 首曲目`, 'success')
  } finally {
    state.importing = false
  }
}

async function openFiles() {
  if (!state.connected) {
    notify('原生文件选择器仅可在 foobar2000 中使用。', 'info')
    return
  }
  const options: Parameters<typeof fb.dialog.openFile>[0] = {
    title: '打开音乐文件',
    multiple: true,
    defaultPath: '%music%',
  }
  const result = await runAction(() => fb.dialog.openFile(options))
  if (!result || result.canceled) return
  if (result.error) {
    notify(result.error, 'error')
    return
  }
  await importPaths(result.filePaths ?? [])
}

async function openFolder() {
  if (!state.connected) {
    notify('原生文件夹选择器仅可在 foobar2000 中使用。', 'info')
    return
  }
  const result = await runAction(() => fb.dialog.openFolder({ title: '打开音乐文件夹' }))
  if (!result || result.canceled) return
  if (result.error) {
    notify(result.error, 'error')
    return
  }
  if (!result.folderPath) return
  await importPaths([result.folderPath])
}

async function importDroppedPaths() {
  if (!state.connected || !state.dndSupported) {
    notify('此窗口不支持文件拖放。', 'info')
    return
  }
  const result = await runAction(() => fb.dnd.getPathsAsync())
  if (!result) return
  const paths = Array.isArray(result.paths) ? result.paths.filter((path): path is string => typeof path === 'string') : []
  await importPaths(paths)
}

async function toggleFavourite(track: DisplayTrack) {
  const currentRating = Number(track.rating ?? 0)
  const key = trackKey(track)
  if (currentRating !== 5) priorFavouriteRatings.set(key, currentRating)
  const nextRating = currentRating === 5 ? priorFavouriteRatings.get(key) ?? 0 : 5
  if (state.connected) {
    const result = await runAction(() => fb.rating.set(playablePath(track), nextRating, { cueIndex: trackSubsong(track) }))
    if (!result) return
  }
  patchTrackCopies(track, { rating: nextRating })
  notify(nextRating ? '已添加到收藏' : '已取消收藏', 'success')
  if (state.view === 'favourites' && !nextRating) {
    state.viewTracks = state.viewTracks.filter((item) => trackKey(item) !== key)
    state.visibleTracks = state.viewTracks.slice()
  }
}

async function getTrackDetails(tracks: DisplayTrack[]): Promise<TrackDetails[]> {
  const paths = tracks.map(playablePath)
  const [metadataResult, playcountResult, replayGainResult] = await Promise.all([
    fb.metadata.readBatch(paths),
    fb.playcount.getBatch(paths),
    fb.replaygain.get(paths),
  ])
  const technical = tracks[0] ? await fb.metadata.read(paths[0], { cueIndex: trackSubsong(tracks[0]) }) : null
  return tracks.map((track, index) => {
    const metadata = metadataResult.results[index]
    const playcount = playcountResult.results[index]
    const replayGain = replayGainResult.results?.[index]
    return {
      track,
      path: paths[index],
      tags: metadata?.tags ?? {},
      info: index === 0 ? technical?.info ?? {} : {},
      playCount: playcount?.playCount ?? 0,
      firstPlayed: playcount?.firstPlayed ?? '',
      lastPlayed: playcount?.lastPlayed ?? '',
      added: playcount?.added ?? '',
      rating: playcount?.rating ?? Number(track.rating ?? 0),
      replayGain: {
        trackGain: replayGain?.trackGain,
        trackPeak: replayGain?.trackPeak,
        albumGain: replayGain?.albumGain,
        albumPeak: replayGain?.albumPeak,
        hasReplayGain: replayGain?.hasReplayGain,
      },
    }
  })
}

async function writeTrackMetadata(tracks: DisplayTrack[], tags: Record<string, string>) {
  const items = tracks.map((track) => ({ path: playablePath(track), tags }))
  const result = await runAction(() => fb.metadata.writeBatch(items))
  if (!result) return false
  if (result.failCount) {
    notify(`标签部分写入失败：成功 ${result.successCount ?? 0}，失败 ${result.failCount}`, 'error')
    return false
  }
  notify(`已更新 ${result.successCount ?? tracks.length} 首曲目的标签`, 'success')
  await loadLibrary()
  await navigate(state.route, 'none')
  return true
}

async function setTrackRating(track: DisplayTrack, rating: number) {
  const value = Math.min(5, Math.max(0, Math.round(rating)))
  const result = await runAction(() => fb.rating.set(playablePath(track), value, { cueIndex: trackSubsong(track) }))
  if (!result) return false
  patchTrackCopies(track, { rating: value })
  notify(value ? `已设置为 ${value} 星` : '已清除评分', 'success')
  return true
}

async function setTracksRating(tracks: DisplayTrack[], rating: number) {
  const value = Math.min(5, Math.max(0, Math.round(rating)))
  let succeeded = 0
  for (const track of tracks) {
    const result = await runAction(() => fb.rating.set(playablePath(track), value, { cueIndex: trackSubsong(track) }))
    if (!result) continue
    patchTrackCopies(track, { rating: value })
    succeeded += 1
  }
  if (succeeded) notify(`已将 ${succeeded} 首曲目设置为 ${value || '未评'}星`, 'success')
  return succeeded === tracks.length
}

async function scanReplayGain(tracks: DisplayTrack[], mode: 'track' | 'album') {
  const result = await runAction(() => fb.replaygain.scan(tracks.map(playablePath), { mode }))
  if (result) notify(result.note || `已提交 ${mode === 'album' ? '专辑' : '音轨'} ReplayGain 扫描`, 'success')
  return Boolean(result)
}

async function clearReplayGain(tracks: DisplayTrack[]) {
  const result = await runAction(() => fb.replaygain.clear(tracks.map(playablePath)))
  if (result) notify(`已清除 ${result.clearedCount ?? tracks.length} 首曲目的 ReplayGain`, 'success')
  return Boolean(result)
}

async function embedTrackArtwork(track: DisplayTrack, type: 'front' | 'back' | 'disc' | 'artist' = 'front') {
  const path = localFilePath(track)
  if (!path) return false
  const picked = await fb.dialog.openFile({ title: '选择封面图片', multiple: false, filters: ['图片文件|*.jpg;*.jpeg;*.png;*.webp'] })
  if (picked.canceled || !picked.filePaths?.[0]) return false
  const bytes = await fb.file.readBinary(picked.filePaths[0])
  const result = await runAction(() => fb.metadata.embedArtworkBytes(path, bytes, { type, target: 'embedded' }))
  if (result) notify('封面已嵌入文件', 'success')
  return Boolean(result)
}

async function removeTrackArtwork(track: DisplayTrack, type: 'front' | 'back' | 'disc' | 'artist' = 'front') {
  const path = localFilePath(track)
  if (!path) return false
  const result = await runAction(() => fb.metadata.removeEmbeddedArt(path, { type }))
  if (result) notify('已移除嵌入封面', 'success')
  return Boolean(result)
}

async function renameTrackFile(track: DisplayTrack, newName: string) {
  const path = localFilePath(track)
  const safeName = newName.trim()
  if (!path || !safeName || /[\\/:*?"<>|]/.test(safeName)) return false
  const result = await runAction(() => fb.file.rename(path, safeName), '文件已重命名')
  if (result) await rescanLibrary()
  return Boolean(result)
}

async function moveTrackFile(track: DisplayTrack, folder: string) {
  const path = localFilePath(track)
  if (!path || !folder) return false
  const fileName = path.replaceAll('/', '\\').split('\\').at(-1) ?? ''
  const destination = `${folder.replace(/[\\/]+$/, '')}\\${fileName}`
  const targetInfo = await fb.file.getInfo(destination)
  if (targetInfo.exists) {
    notify('目标文件已存在，未执行移动。', 'error')
    return false
  }
  const result = await runAction(() => fb.file.move(path, destination), '文件已移动')
  if (result) await rescanLibrary()
  return Boolean(result)
}

async function chooseMoveFolder() {
  const result = await runAction(() => fb.dialog.openFolder({ title: '选择目标文件夹' }))
  return result && !result.canceled ? result.folderPath ?? '' : ''
}

async function deleteTrackFile(track: DisplayTrack) {
  const path = localFilePath(track)
  if (!path) return false
  const result = await runAction(() => fb.file.delete(path, { moveToTrash: true }), '文件已移动到回收站')
  if (result) await rescanLibrary()
  return Boolean(result)
}

function findQueueIndex(items: TrackInfo[], expected: DisplayQueueItem) {
  const expectedKey = trackKey(expected)
  if (items[expected.sourceIndex] && trackKey(items[expected.sourceIndex]) === expectedKey) return expected.sourceIndex
  const matches = items.map((item, index) => trackKey(item) === expectedKey ? index : -1).filter((index) => index >= 0)
  return matches.length === 1 ? matches[0] : -1
}

async function playQueueItem(index: number) {
  const item = state.queue[index]
  if (!item) return
  if (!state.connected) return playTrack(item)
  if (item.queueSource === 'playlist' && item.playlist != null && item.playlistItem != null) {
    const playlistIndex = item.playlist
    const resolvedIndex = await resolvePlaylistTrackIndex(playlistIndex, normalizeTrack(item), item.playlistItem)
    if (resolvedIndex == null) return
    await runAction(() => fb.playlist.playTrack(playlistIndex, resolvedIndex))
    return
  }
  const actual = await fb.queue.get()
  const actualIndex = findQueueIndex(actual.items ?? [], item)
  if (actualIndex < 0) {
    notify('播放队列已变化，请重新选择。', 'info')
    await loadQueue()
    return
  }
  let played = false
  if (item.playlist != null && item.playlistItem != null) {
    const resolved = await resolvePlaylistTrackIndex(item.playlist, normalizeTrack(item), item.playlistItem)
    if (resolved != null) played = Boolean(await runAction(() => fb.playlist.playTrack(item.playlist!, resolved)))
  } else played = Boolean(await playGeneratedCollection([normalizeTrack(item)]))
  if (!played) return
  const latest = await fb.queue.get()
  const latestIndex = findQueueIndex(latest.items ?? [], item)
  if (latestIndex >= 0) await runAction(() => fb.queue.remove(latestIndex))
  await loadQueue()
}

async function removeQueueItem(index: number) {
  const item = state.queue[index]
  if (!item || item.queueSource !== 'explicit') return
  if (!state.connected) state.queue.splice(index, 1)
  else {
    const actual = await fb.queue.get()
    const actualIndex = findQueueIndex(actual.items ?? [], item)
    if (actualIndex < 0) {
      notify('播放队列已变化，请重新选择。', 'info')
      await loadQueue()
      return
    }
    await runAction(() => fb.queue.remove(actualIndex), '已从队列移除')
    await loadQueue()
  }
}

async function moveQueueItemToTop(index: number) {
  const item = state.queue[index]
  if (!item) return
  if (!state.connected) {
    const [item] = state.queue.splice(index, 1)
    if (item) state.queue.unshift(item)
  } else if (item.queueSource === 'playlist') {
    await playNext(normalizeTrack(item))
  } else {
    const actual = await fb.queue.get()
    const actualIndex = findQueueIndex(actual.items ?? [], item)
    if (actualIndex < 0) {
      notify('播放队列已变化，请重新选择。', 'info')
      await loadQueue()
      return
    }
    await runAction(() => fb.queue.moveToTop(actualIndex), '已移到队首')
    await loadQueue()
  }
}

async function clearQueue() {
  if (!state.queue.length) return
  if (!state.connected) state.queue = []
  else {
    await runAction(() => fb.queue.clear(), '播放队列已清空')
    await loadQueue()
  }
}

async function refreshLibrary() {
  state.loading = true
  try {
    if (state.connected) {
      const result = await fb.library.refresh()
      if (result.success === false) throw new Error(result.error || '音乐库刷新失败。')
      await loadLibrary()
    } else {
      useDemoData()
    }
    await navigate(state.route, 'none')
    notify('音乐库已刷新', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : '音乐库刷新失败。'
    state.error = message
    notify(message, 'error')
  } finally {
    state.loading = false
  }
}

async function rescanLibrary() {
  if (!state.connected) {
    notify('音乐库扫描仅可在 foobar2000 中使用。', 'info')
    return
  }
  const result = await runAction(() => fb.library.rescan(), '已开始扫描音乐库')
  if (result) await pollLibraryStatus()
}

async function loadLibraryStatus() {
  if (!state.connected) return
  const status = await fb.library.getStatus()
  state.libraryStatus = {
    initialized: status.initialized,
    scanning: status.scanning ?? null,
    itemCount: status.itemCount ?? status.count ?? state.tracks.length,
  }
}

async function pollLibraryStatus() {
  if (libraryStatusTimer) clearTimeout(libraryStatusTimer)
  await loadLibraryStatus()
  if (state.libraryStatus.scanning === true) libraryStatusTimer = setTimeout(() => refreshSafely(pollLibraryStatus), 1200)
  else if (state.libraryStatus.scanning === false) {
    await loadLibrary()
    await navigate(state.route, 'none')
  }
}

async function showPreferences() {
  if (state.connected) await runAction(() => fb.misc.showPreferences())
  else notify('首选项仅可在 foobar2000 中使用。', 'info')
}

async function toggleFullscreen() {
  if (state.connected) {
    const result = await runAction(() => fb.ui.toggleFullscreen())
    if (result?.fullscreen != null) state.isFullscreen = result.fullscreen
  }
  else if (document.fullscreenElement) await document.exitFullscreen()
  else await document.documentElement.requestFullscreen()
}

async function reloadInterface() {
  if (state.connected) await runAction(() => fb.ui.reload())
  else window.location.reload()
}

function toggleNowPlaying(tab = state.nowPlayingTab) {
  state.nowPlayingTab = tab
  state.nowPlayingOpen = !state.nowPlayingOpen
}

function closeNowPlaying() {
  state.nowPlayingOpen = false
}

function dispose() {
  lifecycleGeneration += 1
  routeGeneration += 1
  searchGeneration += 1
  libraryGeneration += 1
  playlistGeneration += 1
  queueGeneration += 1
  playbackSequenceGeneration += 1
  mediaRequest += 1
  subscriptions.forEach((unsubscribe) => unsubscribe())
  subscriptions = []
  if (toastTimer) clearTimeout(toastTimer)
  if (searchTimer) clearTimeout(searchTimer)
  if (libraryReloadTimer) clearTimeout(libraryReloadTimer)
  if (libraryStatusTimer) clearTimeout(libraryStatusTimer)
  if (noDragResizeTimer) clearTimeout(noDragResizeTimer)
  window.removeEventListener('resize', scheduleNoDragRegion)
  document.removeEventListener('fullscreenchange', syncBrowserFullscreen)
  initPromise = null
}

export function useFoobar() {
  const filteredAlbums = computed(() => {
    const query = state.route.view === 'search' ? state.route.query.trim().toLocaleLowerCase() : ''
    if (!query && state.route.view === 'home') {
      const order = new Map<string, number>()
      state.recentTracks.forEach((track, index) => {
        const key = albumKey({ name: track.album, artist: track.albumArtist || track.artist })
        if (!order.has(key)) order.set(key, index)
      })
      return state.albums.filter((album) => order.has(albumKey(album))).sort((a, b) => order.get(albumKey(a))! - order.get(albumKey(b))!)
    }
    if (!query) return state.albums
    const terms = query.split(/\s+/).filter(Boolean)
    return state.albums.filter((album) =>
      terms.every((term) => `${album.name} ${album.artist}`.toLocaleLowerCase().includes(term)),
    )
  })
  const libraryFilterOptions = computed(() => {
    const artists = new Set<string>()
    const albumArtists = new Set<string>()
    const genres = new Set<string>()
    const folders = new Set<string>()
    state.tracks.forEach((track) => {
      if (track.artist) artists.add(track.artist)
      if (track.albumArtist || track.artist) albumArtists.add(track.albumArtist || track.artist)
      String(track.genre || '').split(/[;,]/).map((value) => value.trim()).filter(Boolean).forEach((value) => genres.add(value))
      const normalized = track.path.replaceAll('\\', '/')
      const slash = normalized.lastIndexOf('/')
      if (slash > 0) folders.add(normalized.slice(0, slash + 1))
    })
    return {
      artists: [...artists].sort((a, b) => a.localeCompare(b)),
      albumArtists: [...albumArtists].sort((a, b) => a.localeCompare(b)),
      genres: [...genres].sort((a, b) => a.localeCompare(b)),
      folders: [...folders].sort((a, b) => a.localeCompare(b)).slice(0, 1000),
    }
  })

  return {
    state,
    filteredAlbums,
    libraryFilterOptions,
    pluginIntegrations,
    ipodDevice,
    ipodCommands,
    initialize,
    dispose,
    setView,
    goBack,
    goForward,
    setSearch,
    submitSearch,
    clearSearch,
    setLibraryFilterFacet,
    addLibraryFilterRule,
    updateLibraryFilterRule,
    removeLibraryFilterRule,
    setLibraryFilterMatchMode,
    clearLibraryFilters,
    applyCustomColumn,
    selectActivePlaylist,
    selectAlbum,
    selectArtist,
    getArtistTracks,
    selectLibraryFolder,
    loadFavourites,
    loadRadio,
    playTrack,
    playTrackCollection,
    playAlbum,
    getAlbumTracks,
    getFolderTracks,
    shuffleAlbum,
    queueAlbum,
    addAlbumToPlaylist,
    playPlaylist,
    duplicatePlaylist,
    clearPlaylist,
    removePlaylist,
    undoPlaylistChange,
    reorderPlaylistTrack,
    reorderPlaylists,
    sortPlaylist,
    getOutputDevices,
    setOutputDevice,
    getPluginContextActions,
    runPluginContextAction,
    sendTracksToIpod,
    sendPlaylistToIpod,
    runIpodMainAction,
    refreshIpodDeviceStatus,
    refreshIpodCommands,
    openIpodManager,
    toggleDesktopLyrics,
    openMiniPlayer,
    startWindowDrag,
    toggleWindowMaximize,
    closeWindow,
    shuffleCurrent,
    togglePlayback,
    next,
    previous,
    seek,
    seekAndPlay,
    setVolume,
    toggleMute,
    cyclePlaybackOrder,
    createPlaylist,
    createAutoPlaylist,
    addToQueue,
    addTracksToQueue,
    addToActivePlaylist,
    addToPlaylist,
    moveTracksToPlaylist,
    addTracksToPlaylist,
    playNext,
    removePlaylistTrack,
    showInExplorer,
    showFolderInExplorer,
    openTrackAlbum,
    toggleFavourite,
    getTrackDetails,
    writeTrackMetadata,
    setTrackRating,
    setTracksRating,
    scanReplayGain,
    clearReplayGain,
    embedTrackArtwork,
    removeTrackArtwork,
    renameTrackFile,
    moveTrackFile,
    chooseMoveFolder,
    deleteTrackFile,
    openFiles,
    openFolder,
    importDroppedPaths,
    removeQueueItem,
    playQueueItem,
    playPlaybackTrack,
    moveQueueItemToTop,
    clearQueue,
    refreshLibrary,
    rescanLibrary,
    showPreferences,
    toggleFullscreen,
    reloadInterface,
    toggleNowPlaying,
    closeNowPlaying,
    notify,
  }
}
