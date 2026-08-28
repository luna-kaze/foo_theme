import { computed, reactive } from 'vue'
import fb, {
  type AlbumInfo,
  type PlaybackTrackChangedPayload,
  type PlaylistInfo,
  type TrackInfo,
} from 'foo-webview-sdk'
import { mockAlbums, mockLyrics, mockPlaylists, mockQueue, mockTracks } from '../data/mock'
import type {
  AlbumCard,
  DisplayQueueItem,
  DisplayTrack,
  ParsedLyric,
  PlayerUiState,
  ViewId,
} from '../types/music'

const state = reactive<PlayerUiState>({
  connected: false,
  loading: true,
  view: 'home',
  search: '',
  albums: [],
  tracks: [],
  recentTracks: [],
  viewTracks: [],
  visibleTracks: [],
  playlists: [],
  activePlaylist: null,
  selectedAlbum: null,
  queue: [],
  currentTrack: null,
  currentArtwork: '',
  lyrics: [],
  lyricsSynced: false,
  isPlaying: false,
  position: 0,
  duration: 0,
  volume: 64,
  muted: false,
  playbackOrder: 0,
  nowPlayingOpen: false,
  nowPlayingTab: 'lyrics',
  canGoBack: false,
  canGoForward: false,
  dialog: null,
  toast: null,
  error: '',
  searchLoading: false,
  dndSupported: false,
  importing: false,
})

let initialized = false
let subscriptions: Array<() => void> = []
let toastTimer: ReturnType<typeof setTimeout> | null = null
let selectingPlaylist = false
let searchTimer: ReturnType<typeof setTimeout> | null = null
let libraryReloadTimer: ReturnType<typeof setTimeout> | null = null
let searchRequest = 0
let mediaRequest = 0
let stagingPlaylistPromise: Promise<number> | null = null
let desktopLyricsCommand: { guid: string; subGuid?: string } | null = null
let miniPlayerWindowId = ''
const history: ViewId[] = ['home']
let historyIndex = 0
const stagingPlaylistName = 'WebView 临时播放'
const importExtensions = new Set(['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'aiff', 'aif', 'ape', 'wv', 'wma', 'mpc', 'tta', 'dsf', 'dff', 'cue', 'm3u', 'm3u8', 'pls'])
const runtimeParams = new URLSearchParams(window.location.search)
const parentWindowId = runtimeParams.get('mainWindowId') ?? ''

const normalizeTrack = (track: TrackInfo | PlaybackTrackChangedPayload): DisplayTrack => ({
  ...track,
  path: track.path || track.absolutePath || '',
  duration: Number(track.duration || 0),
})

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
  void action().catch((error) => {
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

function attachArtwork(tracks: DisplayTrack[]): DisplayTrack[] {
  const exactAlbums = new Map<string, AlbumCard>()
  const namedAlbums = new Map<string, AlbumCard>()
  state.albums.forEach((album) => {
    exactAlbums.set(`${album.name}\u0000${album.artist}`, album)
    if (!namedAlbums.has(album.name)) namedAlbums.set(album.name, album)
  })
  return tracks.map((track) => {
    const album = exactAlbums.get(`${track.album}\u0000${track.albumArtist || track.artist}`) ?? namedAlbums.get(track.album)
    return album?.artworkUrl ? { ...track, artworkUrl: album.artworkUrl } : track
  })
}

function applySearch() {
  const terms = state.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  state.visibleTracks = terms.length
    ? state.viewTracks.filter((track) =>
        terms.every((term) =>
          [track.title, track.artist, track.album, track.albumArtist ?? '', track.genre ?? '', track.path].some((field) =>
            field.toLocaleLowerCase().includes(term),
          ),
        ),
      )
    : state.viewTracks.slice()
}

function setViewTracks(tracks: DisplayTrack[]) {
  state.viewTracks = attachArtwork(tracks)
  applySearch()
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
  state.currentArtwork = state.currentTrack?.artworkUrl ?? ''
  state.duration = state.currentTrack?.duration ?? 0
  state.lyrics = mockLyrics.slice()
  state.lyricsSynced = true
  setViewTracks(state.recentTracks)
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
  const [allAlbums, recentResult, allTracks] = await Promise.all([
    loadAllAlbums(),
    fb.library.getRecentlyAdded(100, 'modified'),
    loadAllTracks(),
  ])

  const albums: AlbumCard[] = allAlbums.map((album: AlbumInfo, index: number) => ({
    ...album,
    id: `${album.artist}\u0000${album.name}\u0000${index}`,
    artworkUrl: album.coverDataUrl ?? '',
  }))
  state.albums = albums
  await loadAlbumArtwork(albums)
  state.tracks = attachArtwork(allTracks.map(normalizeTrack))
  const recentTracks = attachArtwork((recentResult.tracks ?? []).map(normalizeTrack))
  state.recentTracks = recentTracks.length ? recentTracks : state.tracks.slice(0, 100)
  setViewTracks(state.view === 'home' ? state.recentTracks : state.tracks)
}

async function loadPlaylists() {
  state.playlists = await fb.playlist.getAll()
  state.activePlaylist = await fb.playlist.getActive()
}

async function loadQueue() {
  const result = await fb.queue.get()
  const artworkByAlbum = new Map(state.albums.map((album) => [album.name, album.artworkUrl]))
  const explicit: DisplayQueueItem[] = (result.items ?? []).map((item, sourceIndex) => ({
    ...item,
    queueSource: 'explicit',
    sourceIndex,
    artworkUrl: artworkByAlbum.get(item.album) || '',
  }))
  let upcoming: DisplayQueueItem[] = []
  try {
    const [playing, current] = await Promise.all([
      fb.player.getPlayingPlaylist(),
      fb.player.getCurrentTrackIndex(),
    ])
    if (playing.playlist >= 0 && current.index >= 0) {
      const tracks = await fb.playlist.getTracks(playing.playlist, current.index + 1, 100)
      upcoming = tracks.map((track, offset) => ({
        ...track,
        playlist: playing.playlist,
        playlistItem: current.index + 1 + offset,
        queueSource: 'playlist',
        sourceIndex: current.index + 1 + offset,
        artworkUrl: artworkByAlbum.get(track.album) || '',
      }))
    }
  } catch {
    // Explicit queue entries remain useful when no playing playlist is available.
  }
  state.queue = [...explicit, ...upcoming]
}

async function loadCurrentArtwork(request: number, path: string) {
  try {
    const art = await fb.artwork.getFb2kUrl('front', { maxSize: 1000 })
    if (request === mediaRequest && state.currentTrack?.path === path) {
      state.currentArtwork = art.available ? art.dataUrl ?? '' : ''
    }
  } catch {
    if (request === mediaRequest) state.currentArtwork = ''
  }
}

async function loadLyrics(request: number, path: string) {
  try {
    const result = await fb.lyrics.get(path)
    if (request !== mediaRequest || state.currentTrack?.path !== path) return
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
  const nextTrack = track ?? (await fb.player.getCurrentTrack())
  state.currentTrack = nextTrack ? attachArtwork([normalizeTrack(nextTrack)])[0] : null
  state.duration = state.currentTrack?.duration ?? 0
  state.currentArtwork = ''
  state.lyrics = []
  state.lyricsSynced = false
  const request = ++mediaRequest
  const path = state.currentTrack?.path ?? ''
  if (state.connected && state.currentTrack?.path) {
    try {
      const result = await fb.rating.get(state.currentTrack.path)
      state.currentTrack.rating = result.rating
    } catch {
      // Ratings remain optional when no writable backend is installed.
    }
  }
  if (path) await Promise.all([loadCurrentArtwork(request, path), loadLyrics(request, path)])
}

function bindEvents() {
  const scheduleLibraryReload = () => {
    if (libraryReloadTimer) clearTimeout(libraryReloadTimer)
    libraryReloadTimer = setTimeout(() => refreshSafely(loadLibrary), 450)
  }
  subscriptions = [
    fb.on('playback:trackChanged', (track) => {
      state.isPlaying = true
      state.position = 0
      refreshSafely(() => syncCurrentTrack(track))
      refreshSafely(loadQueue)
    }),
    fb.on('playback:stateChanged', (event) => {
      state.isPlaying = event.state === 'playing'
      if (event.position != null) state.position = event.position
      if (event.duration != null) state.duration = event.duration
    }),
    fb.on('playback:paused', (event) => {
      state.isPlaying = !event.paused
    }),
    fb.on('playback:stopped', () => {
      state.isPlaying = false
      state.position = 0
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
    }),
    fb.on('playback:queueChanged', () => refreshSafely(loadQueue)),
    fb.on('playlist:activated', () => {
      if (!selectingPlaylist) refreshSafely(() => selectActivePlaylist(undefined, false))
    }),
    fb.on('playlist:itemsAdded', () => {
      refreshSafely(refreshActivePlaylist)
      refreshSafely(loadQueue)
    }),
    fb.on('playlist:itemsRemoved', () => {
      refreshSafely(refreshActivePlaylist)
      refreshSafely(loadQueue)
    }),
    fb.on('playlist:itemsReordered', () => {
      refreshSafely(refreshActivePlaylist)
      refreshSafely(loadQueue)
    }),
    fb.on('playlist:itemsReplaced', () => {
      refreshSafely(refreshActivePlaylist)
      refreshSafely(loadQueue)
    }),
    fb.on('playlist:addComplete', () => {
      refreshSafely(refreshActivePlaylist)
      refreshSafely(loadPlaylists)
      refreshSafely(loadQueue)
    }),
    fb.on('playlist:created', () => refreshSafely(loadPlaylists)),
    fb.on('playlist:removed', () => refreshSafely(loadPlaylists)),
    fb.on('playlist:renamed', () => refreshSafely(loadPlaylists)),
    fb.on('playlist:lockChanged', () => refreshSafely(loadPlaylists)),
    fb.on('playlist:reordered', () => refreshSafely(loadPlaylists)),
    fb.on('metadb:changed', () => {
      if (state.view === 'favourites') refreshSafely(() => loadFavourites(false))
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
  ]
}

async function initialize() {
  if (initialized) return
  initialized = true
  state.loading = true
  const webViewDetected = Boolean((window as Window & { chrome?: { webview?: unknown } }).chrome?.webview)
  if (!webViewDetected && !fb.isAvailable()) {
    useDemoData()
    state.loading = false
    return
  }

  try {
    await Promise.race([
      fb.ready(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('等待 foobar2000 宿主连接超时。')), 5500)),
    ])
    state.connected = fb.isAvailable()
    if (!state.connected) throw new Error('foobar2000 宿主桥接不可用。')
    const [playback, position, volume, order] = await Promise.all([
      fb.player.getState(),
      fb.player.getPosition(),
      fb.player.getVolume(),
      fb.player.getOrder(),
    ])
    state.isPlaying = playback.state === 'playing'
    state.position = position.position ?? 0
    state.duration = position.duration ?? 0
    state.volume = volume.volume
    state.muted = volume.muted
    state.playbackOrder = order.order

    try {
      const capabilities = await fb.dnd.getCapabilities()
      state.dndSupported = capabilities.success && capabilities.paths
    } catch {
      state.dndSupported = false
    }

    const results = await Promise.allSettled([loadLibrary(), loadPlaylists(), loadQueue(), syncCurrentTrack()])
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) notify('部分 foobar2000 数据无法加载。', 'error')
    bindEvents()
    void fb.ui.setTitle('foobar2000')
  } catch (error) {
    state.error = error instanceof Error ? error.message : '无法连接到 foobar2000。'
    notify(state.error, 'error')
  } finally {
    state.loading = false
  }
}

async function applyView(view: ViewId) {
  state.view = view

  if (view === 'home') setViewTracks(state.recentTracks)
  if (view === 'songs') setViewTracks(state.tracks)
  if (view === 'playlist') await refreshActivePlaylist()
  if (view === 'favourites') await loadFavourites(false)
  if (view === 'radio') await loadRadio(false)
}

async function setView(view: ViewId, pushHistory = true) {
  state.nowPlayingOpen = false
  state.dialog = null
  if (pushHistory && (view !== state.view || view === 'radio')) {
    history.splice(historyIndex + 1)
    history.push(view)
    historyIndex = history.length - 1
  }
  updateHistoryState()
  await applyView(view)
}

async function goBack() {
  if (!state.canGoBack) return
  state.nowPlayingOpen = false
  state.dialog = null
  historyIndex -= 1
  updateHistoryState()
  await applyView(history[historyIndex])
}

async function goForward() {
  if (!state.canGoForward) return
  state.nowPlayingOpen = false
  state.dialog = null
  historyIndex += 1
  updateHistoryState()
  await applyView(history[historyIndex])
}

function setSearch(value: string) {
  searchRequest += 1
  state.search = value
  if (searchTimer) clearTimeout(searchTimer)
  if (!value.trim()) {
    if (state.view === 'search') void setView('home')
    else applySearch()
    return
  }
  searchTimer = setTimeout(() => void submitSearch(), 240)
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
  if (searchTimer) clearTimeout(searchTimer)
  const request = ++searchRequest
  state.searchLoading = true
  if (state.view !== 'search') await setView('search')

  try {
    if (!state.connected) {
      setViewTracks(state.tracks)
      return
    }
    const result = await runAction(() => fb.library.search(buildLibraryQuery(query), 1000, { offset: 0 }))
    if (request !== searchRequest || !result) return
    setViewTracks((result.tracks ?? []).map(normalizeTrack))
  } finally {
    if (request === searchRequest) state.searchLoading = false
  }
}

async function clearSearch() {
  searchRequest += 1
  state.search = ''
  state.searchLoading = false
  await setView('home')
}

async function selectActivePlaylist(index?: number, pushHistory = true) {
  if (!state.connected) {
    const selected = state.playlists.find((playlist) => playlist.index === index) ?? state.playlists[0]
    state.activePlaylist = selected ?? null
    setViewTracks([...state.tracks].reverse())
    await setView('playlist', pushHistory)
    return
  }

  selectingPlaylist = true
  try {
    if (index != null) await fb.playlist.setActive(index)
    state.activePlaylist = await fb.playlist.getActive()
    await setView('playlist', pushHistory)
  } finally {
    selectingPlaylist = false
  }
}

async function refreshActivePlaylist() {
  if (!state.connected || !state.activePlaylist) return
  setViewTracks(await getAllPlaylistTracks(state.activePlaylist.index))
}

async function selectAlbum(album: AlbumCard) {
  state.selectedAlbum = album
  if (!state.connected) {
    setViewTracks(state.tracks.filter((track) => track.album === album.name))
  } else {
    const result = await runAction(() => fb.library.getAlbumTracks(album.name, album.artist))
    if (!result) return
    setViewTracks(result.tracks.map(normalizeTrack))
  }
  await setView('album')
}

async function loadFavourites(pushHistory = true) {
  if (pushHistory) {
    await setView('favourites')
    return
  }
  if (!state.connected) {
    setViewTracks(state.tracks.filter((track) => Number(track.rating ?? 0) > 0))
  } else {
    const result = await runAction(() => fb.library.query('%rating% GREATER 0', '%artist%|%album%|%tracknumber%', 5000))
    if (result) setViewTracks(result.tracks.map(normalizeTrack))
  }
}

async function loadRadio(pushHistory = true) {
  if (pushHistory) {
    await setView('radio')
    return
  }
  if (!state.connected) {
    setViewTracks([...state.tracks].sort(() => Math.random() - 0.5).slice(0, 30))
  } else {
    const result = await runAction(() => fb.library.getRandomTracks(50))
    if (result) setViewTracks(result.tracks.map(normalizeTrack))
  }
}

async function playTrack(track: DisplayTrack, index?: number) {
  if (!track) return
  if (!state.connected) {
    state.currentTrack = track
    state.currentArtwork = track.artworkUrl ?? state.albums.find((album) => album.name === track.album)?.artworkUrl ?? ''
    state.duration = track.duration
    state.position = 0
    state.isPlaying = true
    return
  }

  await runAction(async () => {
    if (state.view === 'playlist' && state.activePlaylist && index != null) {
      return fb.playlist.playTrack(state.activePlaylist.index, track.sourceIndex ?? index)
    }
    return fb.player.playPath(track.path)
  })
}

async function ensureStagingPlaylist() {
  if (stagingPlaylistPromise) return stagingPlaylistPromise
  stagingPlaylistPromise = (async () => {
    const playlists = await fb.playlist.getAll()
    const existing = playlists.find((playlist) => playlist.name === stagingPlaylistName && !playlist.isLocked && !playlist.isAutoplaylist)
    if (existing) return existing.index
    const created = await fb.playlist.create(stagingPlaylistName)
    await loadPlaylists()
    return created.index
  })()
  try {
    return await stagingPlaylistPromise
  } finally {
    stagingPlaylistPromise = null
  }
}

async function playGeneratedCollection(paths: string[], message?: string) {
  const playablePaths = paths.filter(Boolean)
  return runAction(async () => {
    if (!playablePaths.length) throw new Error('没有可播放的曲目。')
    const playlist = await ensureStagingPlaylist()
    return fb.playlist.replaceAllAndPlay({ playlist, paths: playablePaths, playIndex: 0 })
  }, message)
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
  const paths = result.tracks.map((track) => track.path).filter(Boolean)
  if (!paths.length) {
    notify('此专辑没有可播放的曲目。', 'info')
    return
  }
  await playGeneratedCollection(paths)
}

async function getAlbumTracks(album: AlbumCard) {
  if (!state.connected) return state.tracks.filter((track) => track.album === album.name)
  const result = await runAction(() => fb.library.getAlbumTracks(album.name, album.artist))
  return result ? result.tracks.map(normalizeTrack) : []
}

async function shuffleAlbum(album: AlbumCard) {
  const tracks = (await getAlbumTracks(album)).sort(() => Math.random() - 0.5)
  if (!tracks.length) {
    notify('此专辑没有可播放的曲目。', 'info')
    return
  }
  if (!state.connected) {
    await playTrack(tracks[0])
    return
  }
  await playGeneratedCollection(tracks.map((track) => track.path), '已随机播放专辑')
}

async function queueAlbum(album: AlbumCard) {
  const tracks = await getAlbumTracks(album)
  const paths = tracks.map((track) => track.path).filter(Boolean)
  if (!paths.length) return
  if (!state.connected) {
    const firstIndex = state.queue.filter((item) => item.queueSource === 'explicit').length
    state.queue.push(...tracks.map((track, offset) => ({ ...track, queueSource: 'explicit' as const, sourceIndex: firstIndex + offset })))
    notify(`已将 ${tracks.length} 首曲目添加到队列`, 'success')
    return
  }
  await runAction(() => fb.queue.addPaths(paths), `已将 ${paths.length} 首曲目添加到队列`)
  await loadQueue()
}

async function addAlbumToPlaylist(album: AlbumCard, playlistIndex: number) {
  const playlist = state.playlists.find((item) => item.index === playlistIndex)
  if (!playlist) return
  const tracks = await getAlbumTracks(album)
  const paths = tracks.map((track) => track.path).filter(Boolean)
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
  const allTracks = await runAction(() => getAllPlaylistTracks(playlistIndex))
  if (!allTracks) return
  const tracks = allTracks.sort(() => Math.random() - 0.5)
  await playGeneratedCollection(tracks.map((track) => track.path), '已随机播放列表')
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
  if (result && state.activePlaylist?.index === playlistIndex) await refreshActivePlaylist()
  await loadPlaylists()
}

async function removePlaylist(playlistIndex: number) {
  const playlist = state.playlists.find((item) => item.index === playlistIndex)
  if (!playlist) return
  if (playlist.isLocked) {
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
  if (playlist.isAutoplaylist) {
    const converted = await runAction(() => fb.playlist.removeAutoplaylist(playlistIndex))
    if (!converted) return
  }
  const result = await runAction(() => fb.playlist.remove(playlistIndex), `已删除“${playlist.name}”`)
  if (!result) return
  await loadPlaylists()
  if (state.view === 'playlist') {
    if (state.activePlaylist) await selectActivePlaylist(state.activePlaylist.index, false)
    else await setView('home')
  }
}

async function undoPlaylistChange(playlistIndex: number) {
  if (!state.connected) return
  const result = await runAction(() => fb.playlist.undo(playlistIndex), '已撤销播放列表更改')
  if (result) {
    await loadPlaylists()
    if (state.activePlaylist?.index === playlistIndex) await refreshActivePlaylist()
  }
}

async function shuffleCurrent() {
  const tracks = [...state.visibleTracks].sort(() => Math.random() - 0.5)
  if (!tracks.length) {
    notify('没有可随机播放的曲目。', 'info')
    return
  }
  if (!state.connected) {
    await playTrack(tracks[0])
    return
  }
  const paths = tracks.map((track) => track.path).filter(Boolean)
  await playGeneratedCollection(paths, '已开始随机播放')
}

async function togglePlayback() {
  if (!state.connected) {
    state.isPlaying = !state.isPlaying
    return
  }
  const result = await runAction(() => fb.player.toggle())
  if (result) state.isPlaying = result.isPlaying
}

async function next() {
  if (state.connected) await runAction(() => fb.player.next())
  else if (state.tracks.length) {
    const current = state.tracks.findIndex((track) => track.id === state.currentTrack?.id)
    await playTrack(state.tracks[(current + 1) % state.tracks.length])
  }
}

async function previous() {
  if (state.position > 2) {
    await seek(0)
    return
  }
  if (state.connected) await runAction(() => fb.player.prev())
  else if (state.tracks.length) {
    const current = state.tracks.findIndex((track) => track.id === state.currentTrack?.id)
    await playTrack(state.tracks[(current - 1 + state.tracks.length) % state.tracks.length])
  }
}

async function seek(position: number) {
  state.position = position
  if (state.connected) await runAction(() => fb.player.seek(position))
}

async function setVolume(volume: number) {
  state.volume = volume
  state.muted = volume === 0
  if (state.connected) await runAction(() => fb.player.setVolume(volume))
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
  const orders = [0, 1, 2, 4]
  const current = orders.indexOf(state.playbackOrder)
  const nextOrder = orders[(current + 1) % orders.length]
  state.playbackOrder = nextOrder
  if (state.connected) await runAction(() => fb.player.setOrder(nextOrder))
  const labels: Record<number, string> = { 0: '默认播放顺序', 1: '循环播放列表', 2: '单曲循环', 4: '随机播放' }
  notify(labels[nextOrder] ?? '播放顺序已更改')
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

async function addToQueue(track: DisplayTrack) {
  if (!state.connected) {
    state.queue.push({ ...track, queueSource: 'explicit', sourceIndex: state.queue.length })
    notify('已添加到播放队列', 'success')
    return
  }
  await runAction(() => fb.queue.addPaths([track.path]), '已添加到播放队列')
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
  if (!playlist) return
  if (!state.connected) {
    notify(`已添加到“${playlist.name}”`, 'success')
    return
  }
  await runAction(() => fb.playlist.add(playlistIndex, [track.path]), `已添加到“${playlist.name}”`)
}

async function playNext(track: DisplayTrack) {
  if (!state.connected) {
    state.queue.unshift({ ...track, queueSource: 'explicit', sourceIndex: 0 })
    notify('将作为下一首播放', 'success')
    return
  }
  const insertIndex = state.queue.filter((item) => item.queueSource === 'explicit').length
  const added = await runAction(() => fb.queue.addPaths([track.path]))
  if (!added) return
  await runAction(() => fb.queue.moveToTop(insertIndex), '将作为下一首播放')
  await loadQueue()
}

async function removePlaylistTrack(track: DisplayTrack, visibleIndex: number) {
  if (state.view !== 'playlist' || !state.activePlaylist) return
  if (state.activePlaylist.isLocked || state.activePlaylist.isAutoplaylist) {
    notify('此播放列表不允许移除曲目。', 'info')
    return
  }
  const index = track.sourceIndex ?? visibleIndex
  if (!state.connected) {
    const demoIndex = state.viewTracks.findIndex((item) => item.path === track.path)
    if (demoIndex >= 0) state.viewTracks.splice(demoIndex, 1)
    applySearch()
    notify('已从播放列表移除', 'success')
    return
  }
  const result = await runAction(() => fb.playlist.removeTracks(state.activePlaylist!.index, [index]), '已从播放列表移除')
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
  await runAction(() => fb.shell.showInExplorer(track.path))
}

async function openTrackAlbum(track: DisplayTrack) {
  const album = state.albums.find((item) => item.name === track.album && (item.artist === track.albumArtist || item.artist === track.artist))
    ?? state.albums.find((item) => item.name === track.album)
  if (!album) {
    notify('音乐库中没有此专辑。', 'info')
    return
  }
  await selectAlbum(album)
}

async function ensureOpenedMusicPlaylist() {
  const playlists = await fb.playlist.getAll()
  const existing = playlists.find((playlist) =>
    (playlist.name === '已打开的音乐' || playlist.name === 'Opened Music') && !playlist.isLocked && !playlist.isAutoplaylist,
  )
  if (existing) return existing.index
  const names = new Set(playlists.map((playlist) => playlist.name))
  let name = '已打开的音乐'
  for (let suffix = 2; names.has(name); suffix += 1) name = `已打开的音乐 ${suffix}`
  const created = await runAction(() => fb.playlist.create(name))
  if (!created) return null
  await loadPlaylists()
  return created.index
}

async function expandImportPaths(paths: string[]) {
  const expanded: string[] = []
  for (const path of paths) {
    const info = await fb.file.getInfo(path)
    if (info.success === false) throw new Error(info.error || `无法读取：${path}`)
    if (!info.isDirectory) {
      expanded.push(path)
      continue
    }
    const result = await fb.file.list(path, { recursive: true })
    if (result.success === false) throw new Error(result.error || `无法扫描文件夹：${path}`)
    const files = result.files ?? result.items ?? []
    expanded.push(...files.filter((file) => importExtensions.has(file.split('.').at(-1)?.toLocaleLowerCase() ?? '')))
  }
  return [...new Set(expanded)]
}

async function importPaths(paths: string[]) {
  const cleanPaths = [...new Set(paths.filter((path) => typeof path === 'string' && path.trim()))]
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
    const playlistIndex = await ensureOpenedMusicPlaylist()
    if (playlistIndex == null) return
    let addedCount = 0
    let firstAddedIndex = 0
    for (let start = 0; start < expandedPaths.length; start += 500) {
      const result = await runAction(() => fb.playlist.add(playlistIndex, expandedPaths.slice(start, start + 500)))
      if (!result) return
      if (!addedCount) firstAddedIndex = result.countBefore
      addedCount += result.addedCount
    }
    if (!addedCount) {
      notify('所选位置中没有可播放的音频。', 'error')
      return
    }
    await loadPlaylists()
    await selectActivePlaylist(playlistIndex)
    await runAction(() => fb.playlist.playTrack(playlistIndex, firstAddedIndex))
    notify(`已在“已打开的音乐”中打开 ${addedCount} 首曲目`, 'success')
  } finally {
    state.importing = false
  }
}

async function openFiles() {
  if (!state.connected) {
    notify('原生文件选择器仅可在 foobar2000 中使用。', 'info')
    return
  }
  const options = {
    title: '打开音乐文件',
    multiple: true,
    defaultPath: '%music%',
    filters: [
      { name: '音频和播放列表', extensions: ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'aiff', 'ape', 'wv', 'cue', 'm3u', 'm3u8', 'pls'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  } as unknown as Parameters<typeof fb.dialog.openFile>[0]
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
  const nextRating = Number(track.rating ?? 0) > 0 ? 0 : 5
  if (state.connected) {
    const result = await runAction(() => fb.rating.set(track.path, nextRating))
    if (!result) return
  }
  track.rating = nextRating
  const libraryTrack = state.tracks.find((item) => item.path === track.path)
  if (libraryTrack) libraryTrack.rating = nextRating
  if (state.currentTrack?.path === track.path) state.currentTrack.rating = nextRating
  notify(nextRating ? '已添加到收藏' : '已取消收藏', 'success')
  if (state.view === 'favourites' && !nextRating) {
    state.viewTracks = state.viewTracks.filter((item) => item.path !== track.path)
    applySearch()
  }
}

async function removeQueueItem(index: number) {
  const item = state.queue[index]
  if (!item || item.queueSource !== 'explicit') return
  if (!state.connected) state.queue.splice(index, 1)
  else {
    await runAction(() => fb.queue.remove(item.sourceIndex), '已从队列移除')
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
    await runAction(() => fb.queue.addPaths([item.path]), '将作为下一首播放')
    await loadQueue()
  } else {
    await runAction(() => fb.queue.moveToTop(item.sourceIndex), '已移到队首')
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
      await fb.library.refresh()
      await loadLibrary()
    } else {
      useDemoData()
    }
    await applyView(state.view)
    notify('音乐库已刷新', 'success')
  } finally {
    state.loading = false
  }
}

async function rescanLibrary() {
  if (!state.connected) {
    notify('音乐库扫描仅可在 foobar2000 中使用。', 'info')
    return
  }
  await runAction(() => fb.library.rescan(), '已开始扫描音乐库')
}

async function showPreferences() {
  if (state.connected) await runAction(() => fb.misc.showPreferences())
  else notify('首选项仅可在 foobar2000 中使用。', 'info')
}

async function toggleFullscreen() {
  if (state.connected) await runAction(() => fb.ui.toggleFullscreen())
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
  subscriptions.forEach((unsubscribe) => unsubscribe())
  subscriptions = []
  if (toastTimer) clearTimeout(toastTimer)
  if (searchTimer) clearTimeout(searchTimer)
  if (libraryReloadTimer) clearTimeout(libraryReloadTimer)
  initialized = false
}

export function useFoobar() {
  const filteredAlbums = computed(() => {
    const query = state.search.trim().toLocaleLowerCase()
    if (!query) return state.albums
    return state.albums.filter((album) =>
      `${album.name} ${album.artist}`.toLocaleLowerCase().includes(query),
    )
  })

  return {
    state,
    filteredAlbums,
    initialize,
    dispose,
    setView,
    goBack,
    goForward,
    setSearch,
    submitSearch,
    clearSearch,
    selectActivePlaylist,
    selectAlbum,
    loadFavourites,
    loadRadio,
    playTrack,
    playAlbum,
    shuffleAlbum,
    queueAlbum,
    addAlbumToPlaylist,
    playPlaylist,
    duplicatePlaylist,
    clearPlaylist,
    removePlaylist,
    undoPlaylistChange,
    getOutputDevices,
    setOutputDevice,
    toggleDesktopLyrics,
    openMiniPlayer,
    startWindowDrag,
    closeWindow,
    shuffleCurrent,
    togglePlayback,
    next,
    previous,
    seek,
    setVolume,
    toggleMute,
    cyclePlaybackOrder,
    createPlaylist,
    addToQueue,
    addToActivePlaylist,
    addToPlaylist,
    playNext,
    removePlaylistTrack,
    showInExplorer,
    openTrackAlbum,
    toggleFavourite,
    openFiles,
    openFolder,
    importDroppedPaths,
    removeQueueItem,
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
