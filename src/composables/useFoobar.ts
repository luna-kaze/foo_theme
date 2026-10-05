import { computed, reactive, shallowRef } from 'vue'
import { pickImageFile } from '../utils/imagePicker'
import { createPlaybackWorkspace, type PlaybackMode } from './playbackWorkspace'
import { createPlaybackFocusGate, createSettledNavigation, type PlaybackFocusState } from '../utils/settledNavigation'
import { coverflowPerformance } from '../utils/coverflowPerformance'
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
  ArtistCard,
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
import { findNativeMenuCommand, findNativeTools, type NativeMenuNode } from '../utils/nativeMenu'
import { airplayPath, createAirplayPlayback, decodeAirplayArtwork } from '../utils/airplayPlayback'
import { createExternalImporter } from '../utils/externalImport'
import type { ExternalDropTarget } from '../utils/externalDrop'
import { filterImportCandidates } from '../utils/importFilters'

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
  playbackPlanIds: [],
  playbackTrackIndex: -1,
  playbackPreviewId: null,
  playbackPreviewPending: false,
  playbackPreviewRequest: 0,
  playbackBrowseIndex: null,
  playbackBrowseTrack: null,
  playbackWindowDeferred: false,
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
  shufflePending: false,
  shuffleStaged: false,
  shuffleBusy: false,
  shuffleRevision: 0,
  shuffleSourceName: '',
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
  alphabetIndexView: false,
  libraryFilters: { artist: '', albumArtist: '', folder: '', rating: 'all', favourite: 'all', matchMode: 'all', rules: [{ id: 'primary', field: 'all', operator: 'contains', value: '' }] },
  libraryStatus: { initialized: false, scanning: null, itemCount: 0 },
  customColumn: { label: '', pattern: '' },
})

// Navigation animation is a visual effect, not a reason to replace the page.
const routeNavigation = shallowRef<{ from: ViewRoute; to: ViewRoute; generation: number; animate: boolean } | null>(null)
const routeReady = shallowRef<{ route: ViewRoute; generation: number } | null>(null)

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
let workspaceProjectionGeneration = 0
let radioNonce = 0
let ownerIdPromise: Promise<string> | null = null
let libraryStatusTimer: ReturnType<typeof setTimeout> | null = null
let noDragResizeTimer: ReturnType<typeof setTimeout> | null = null
let playcountLibraryGeneration = -1
let favouritePlaylistIndex: number | null = null
let externalDropHandler: ((event: { sessionId: string; paths: string[]; x: number; y: number }) => void) | null = null
const insertingPlaylistIndexes = new Set<number>()
const favouriteTrackKeys = new Set<string>()
let desktopLyricsCommand: { guid: string; subGuid?: string } | null = null
const miniPlayerMode = shallowRef(false)
type MainWindowSnapshot = { bounds: { x: number; y: number; width: number; height: number }; minSize: { width: number; height: number }; maximized: boolean; resizable: boolean; alwaysOnTop: boolean }
let mainWindowSnapshot: MainWindowSnapshot | null = null
let miniWindowTask: Promise<void> | null = null
const miniWindowConfigKey = 'foo-theme.mini-window.v1'
let fullscreenRequest: boolean | null = null
let fullscreenIntent: boolean | null = null
let fullscreenTask: Promise<boolean> | null = null
const history: ViewRoute[] = [{ view: 'home' }]
let historyIndex = 0
const ownershipConfigKey = 'foo-theme.owned-playlists.v1'
const preferencesConfigKey = 'foo-theme.preferences.v1'
const customColumnValues = new Map<string, string>()
let exactAlbumArtwork = new Map<string, string>()
let namedAlbumArtwork = new Map<string, string | null>()

const playbackWorkspace = createPlaybackWorkspace({
  connected: () => state.connected, owner: getOwnerId, tracks: getAllPlaylistTracks, notify,
  publish: () => {
    if (airplay.state.active) return
    state.shuffleBusy = playbackWorkspace.status.busy
    if (playbackWorkspace.status.ready) state.playbackOrder = playbackWorkspace.status.mode
    state.shufflePending = playbackWorkspace.status.pending
    state.shuffleStaged = playbackWorkspace.status.staged
    state.shuffleSourceName = playbackWorkspace.status.ready ? playbackWorkspace.status.sourceName : ''
    state.shuffleRevision = playbackWorkspace.status.revision
  },
})

const airplay = createAirplayPlayback({
  enter: async () => {
    workspaceProjectionGeneration += 1; playbackSequenceGeneration += 1; queueGeneration += 1
    settledSkip.cancel(); playbackSelectionVersion += 1
    state.playbackPreviewId = null; state.playbackPreviewPending = false
    state.playbackBrowseIndex = null; state.playbackBrowseTrack = null; state.playbackWindowDeferred = false
    state.shufflePending = state.shuffleStaged = false; state.shuffleSourceName = ''; state.canSeek = false
    state.shuffleBusy = false
    state.queue = []
    return playbackWorkspace.suspend()
  },
  read: async () => {
    const [track, position, formatted, playback] = await Promise.all([
      fb.player.getCurrentTrack(), fb.player.getPosition(),
      (fb.titleformat?.eval('[%path%]\u001f[%title%]\u001f[%artist%]\u001f[%album%]') ?? Promise.resolve(null)).catch(() => null),
      (fb.player.getState?.() ?? Promise.resolve(null)).catch(() => null),
    ])
    if (playback?.state === 'stopped') return { track: null }
    if (track && position.path && airplayPath(track) && airplayPath(track) !== airplayPath({ path: position.path })) return { track: null }
    const normalized = track ? normalizeTrack(track) : null
    const fields = formatted?.success ? formatted.result.split('\u001f') : []
    if (normalized && fields.length === 4 && airplayPath(normalized) && airplayPath(normalized) === airplayPath({ path: fields[0] })) {
      if (fields[1]) normalized.title = fields[1]
      normalized.artist = fields[2] ?? ''; normalized.album = fields[3] ?? ''
    }
    return { track: normalized, position: position.position, duration: position.duration && position.duration > 0 ? position.duration : track?.duration, receiving: playback?.state === 'playing' || playback?.state === 'paused' }
  },
  artwork: async path => {
    const providers = [
      () => fb.artwork.getForTrack(path, 'front', { maxSize: 1000 }),
      () => fb.artwork.getByPath?.(path, 'front'),
      async () => {
        if (airplayPath(await fb.player.getCurrentTrack()) !== path) return undefined
        const image = await fb.artwork.getCurrent?.('front')
        return airplayPath(await fb.player.getCurrentTrack()) === path ? image : undefined
      },
    ]
    for (const provider of providers) {
      try {
        const result = await provider()
        const source = result?.available ? result.dataUrl || result.url || '' : ''
        if (source && await decodeAirplayArtwork(source)) return source
      } catch { /* Keep looking for a readable image without dropping the outgoing cover. */ }
    }
    return ''
  },
  leave: async track => { await playbackWorkspace.resume(); await syncCurrentTrack(track); await loadPlaybackSequence(true) },
  publish: (track, artwork, history, position) => {
    state.currentTrack = track; state.currentArtwork = artwork; state.duration = track.duration
    state.canSeek = false; state.lyrics = []; state.lyricsSynced = false
    if (position != null) state.position = position
    state.playbackTracks = history.map((item, index) => ({ ...item, sourceIndex: index }))
    state.playbackPlanIds = state.playbackTracks.map(item => item.playbackId!)
    state.playbackTrackIndex = history.length - 1
    state.shufflePending = state.shuffleStaged = false; state.shuffleSourceName = ''
  },
  command: async (direction, vacantPath) => {
    const actual = await fb.player.getCurrentTrack()
    if (!airplay.state.active || actual && !airplayPath(actual)) return false
    if (!actual && !(vacantPath && airplay.state.phase === 'handover' && state.playbackState === 'stopped')) return false
    return Boolean(await runAction(() => direction > 0 ? fb.player.next() : fb.player.prev()))
  },
  notify: message => notify(message, 'error'),
})

async function syncWorkspaceProjection() {
  if (airplay.state.active) return
  const generation = ++workspaceProjectionGeneration
  await playbackWorkspace.sync()
  if (state.connected) {
    const [playing, position] = await Promise.all([fb.player.getPlayingPlaylist(), fb.player.getCurrentTrackIndex(true)])
    if (generation !== workspaceProjectionGeneration) return
    state.playingPlaylistIndex = playing.playlist ?? -1
    const snapshot = playbackWorkspace.projection(position.index >= 0 ? position.index : undefined)
    if (snapshot?.external && (position.track || state.currentTrack)) {
      const current = position.track ? normalizeTrack(position.track) : state.currentTrack!
      const anchor = { ...current, playbackId: `continuing:${state.playingPlaylistIndex}:${position.index}:${trackKey(current)}`, playbackPlaceholder: true }
      state.playbackTracks = [anchor, ...attachArtwork(snapshot.order.slice(snapshot.index + 1, snapshot.index + 61))]
      state.playbackPlanIds = [anchor.playbackId, ...snapshot.order.map((track) => track.playbackId!)]
      state.playbackTrackIndex = 0
    } else if (snapshot) setPlaybackWindow(snapshot.order, snapshot.index, snapshot.order[0]?.playbackPlaylistIndex ?? -1, state.playingPlaylistIndex)
  } else {
    const snapshot = playbackWorkspace.projection(playbackWorkspace.demoIndex())
    if (snapshot) {
      setPlaybackWindow(snapshot.order, snapshot.index, -1)
      const current = snapshot.order[snapshot.index]
      if (current && (state.currentTrack?.playbackId ? current.playbackId !== state.currentTrack.playbackId : !isSameTrack(current, state.currentTrack))) {
        state.currentTrack = current
        state.currentArtwork = current.artworkUrl ?? ''
        state.duration = current.duration
        state.position = 0
      }
      const editor = playbackWorkspace.projection(playbackWorkspace.demoIndex(), true) ?? snapshot
      state.queue = editor.order.slice(editor.index + 1).map((track, index) => ({ ...track, sourceIndex: track.sourceIndex ?? index, queueSource: track.playbackQueued ? 'explicit' : 'playlist' }))
    }
  }
  state.shufflePending = playbackWorkspace.status.pending
  state.shuffleStaged = playbackWorkspace.status.staged
  state.shuffleSourceName = playbackWorkspace.status.ready ? playbackWorkspace.status.sourceName : ''
  state.shuffleRevision = playbackWorkspace.status.revision
}

let workspaceAdoption: Promise<boolean> | null = null
async function ensurePlaybackWorkspace() {
  if (airplay.state.active || airplayPath(state.currentTrack)) return false
  if (workspaceAdoption) return workspaceAdoption
  if (playbackWorkspace.status.ready) return true
  workspaceAdoption = (async () => {
    if (state.playbackState === 'stopped' && !state.currentTrack) return false
    if (state.connected) {
      const playing = await fb.player.getPlayingPlaylist()
      const index = playing.playlist ?? -1
      if (index < 0) return false
      const name = (await fb.playlist.getAll()).find((playlist) => playlist.index === index)?.name ?? ''
      await playbackWorkspace.adopt(await getAllPlaylistTracks(index), index, name, name, 0, currentPlaybackMode())
    } else if (state.currentTrack) {
      await playbackWorkspace.adopt(state.playbackTracks.length ? state.playbackTracks : [state.currentTrack], -1, 'demo:A', '当前曲目集合', Math.max(0, state.playbackTrackIndex), currentPlaybackMode())
    }
    await playbackWorkspace.sync()
    return playbackWorkspace.status.ready
  })()
  try { return await workspaceAdoption } finally { workspaceAdoption = null }
}

async function refreshWorkspace() {
  await syncWorkspaceProjection()
  if (state.connected) { await loadPlaylists(); await loadQueue() }
}

const playbackFocusGate = createPlaybackFocusGate()
let playbackSelectionVersion = 0
const settledSkip = createSettledNavigation<string>({
  preview: (id, request) => {
    state.playbackBrowseIndex = null
    state.playbackBrowseTrack = null
    state.playbackWindowDeferred = false
    playbackSelectionVersion += 1
    state.playbackPreviewId = id
    state.playbackPreviewPending = true
    state.playbackPreviewRequest = request
    const snapshot = playbackWorkspace.projection(undefined, true)
    if (snapshot) setPlaybackWindow(snapshot.order, snapshot.index, snapshot.order[0]?.playbackPlaylistIndex ?? -1, state.playingPlaylistIndex)
  },
  waitUntilReady: (id, request, signal) => playbackFocusGate.wait(id, request, signal),
  commit: async (id, signal) => {
    if (!await playbackWorkspace.sync()) return false
    if (signal.aborted) return false
    const snapshot = playbackWorkspace.projection(undefined, true)
    const target = snapshot?.order.find((track) => track.playbackId === id)
    if (!target) return false
    if (snapshot?.order[snapshot.index]?.playbackId === id) return true
    if (!await playbackWorkspace.jump(target, () => !signal.aborted)) return false
    if (signal.aborted) return false
    if (state.connected) {
      let confirmed = false
      for (let attempt = 0; attempt < 20 && !signal.aborted; attempt++) {
        const [position, playback] = await Promise.all([fb.player.getCurrentTrackIndex(true), fb.player.getState()])
        await playbackWorkspace.sync()
        const actual = playbackWorkspace.projection(position.index >= 0 ? position.index : undefined)
        if (position.index >= 0 && playback.state !== 'stopped' && actual?.order[actual.index]?.playbackId === id) {
          state.playbackState = playback.state
          state.isPlaying = playback.state === 'playing'
          await syncCurrentTrack(position.track ?? actual.order[actual.index])
          confirmed = true
          break
        }
        await new Promise(resolve => setTimeout(resolve, 60))
      }
      if (!confirmed) return false
    }
    if (signal.aborted) return false
    await refreshWorkspace()
    return true
  },
  clear: () => {
    state.playbackBrowseIndex = null
    state.playbackBrowseTrack = null
    state.playbackWindowDeferred = false
    playbackSelectionVersion += 1
    const preview = state.playbackPreviewId
    state.playbackPreviewId = null
    state.playbackPreviewPending = false
    if (preview) {
      const snapshot = playbackWorkspace.projection()
      if (snapshot) setPlaybackWindow(snapshot.order, snapshot.index, snapshot.order[0]?.playbackPlaylistIndex ?? -1, state.playingPlaylistIndex)
    }
  },
})

function previewSkip(direction: number) {
  if (!playbackWorkspace.status.ready || state.queue.some((track) => track.queueSource === 'explicit' && !track.playbackId?.startsWith('work:'))) return null
  const snapshot = playbackWorkspace.projection(undefined, true)
  if (!snapshot || snapshot.index < 0) return null
  const pending = state.playbackPreviewPending ? snapshot.order.findIndex((track) => track.playbackId === state.playbackPreviewId) : -1
  const index = pending >= 0 ? pending : snapshot.index
  let target = index + direction
  if (state.playbackOrder === 1) target = (target + snapshot.order.length) % snapshot.order.length
  else if (target < 0 || target >= snapshot.order.length) return pending >= 0 ? settledSkip.schedule(snapshot.order[index].playbackId!) : null
  return settledSkip.schedule(snapshot.order[target].playbackId!)
}

function setPlaybackFocusState(focus: PlaybackFocusState) { playbackFocusGate.report(focus) }

function beginPlaybackBrowse() {
  if (airplay.state.active) return
  settledSkip.cancel(false)
  playbackSelectionVersion += 1
  state.playbackPreviewPending = false
}

function lookupWorkspaceTrack(track: DisplayTrack) {
  const snapshot = playbackWorkspace.projection(undefined, true)
  if (!snapshot) return null
  if (track.playbackId?.startsWith('work:')) {
    const indexed = getPlaybackWindowData(snapshot.order, snapshot.order[0]?.playbackPlaylistIndex ?? -1).positions.get(track.playbackId)
    return indexed == null ? null : snapshot.order[indexed]
  }
  const indexed = track.sourceIndex == null ? null : snapshot.order[track.sourceIndex]
  if (indexed && isSameTrack(indexed, track)) return indexed
  const matches = snapshot.order.filter((item) => isSameTrack(item, track))
  return matches.length === 1 ? matches[0] : null
}

async function browsePlaybackTrack(track: DisplayTrack) {
  if (airplay.state.active || airplayPath(track)) return
  settledSkip.cancel(false)
  playbackSelectionVersion += 1
  const version = playbackSelectionVersion
  let target = lookupWorkspaceTrack(track)
  if (!target && await ensurePlaybackWorkspace()) target = lookupWorkspaceTrack(track)
  if (!target || version !== playbackSelectionVersion) return
  state.playbackBrowseIndex = null
  state.playbackBrowseTrack = null
  state.playbackWindowDeferred = false
  state.playbackPreviewId = target.playbackId!
  state.playbackPreviewPending = false
  state.playbackPreviewRequest += 1
  const snapshot = playbackWorkspace.projection(undefined, true)
  if (snapshot) setPlaybackWindow(snapshot.order, snapshot.index, snapshot.order[0]?.playbackPlaylistIndex ?? -1, state.playingPlaylistIndex)
}

function browsePlaybackPosition(index: number, distant = false) {
  if (airplay.state.active) return
  const snapshot = playbackWorkspace.projection(undefined, true)
  if (!snapshot) return
  const selected = Math.max(0, Math.min(snapshot.order.length - 1, Math.round(index)))
  const track = snapshot.order[selected]
  if (!track) return
  settledSkip.cancel(false)
  playbackSelectionVersion += 1
  state.playbackPreviewId = track.playbackId!
  state.playbackPreviewPending = false
  state.playbackPreviewRequest += 1
  state.playbackBrowseIndex = selected
  state.playbackBrowseTrack = track
  state.playbackWindowDeferred = distant
  coverflowPerformance.record(distant ? 'lightweightTarget' : 'nearTarget', 0, 1)
  if (!distant) setPlaybackWindow(snapshot.order, snapshot.index, snapshot.order[0]?.playbackPlaylistIndex ?? -1, state.playingPlaylistIndex)
}

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
    return { ...track, ...(artworkUrl ? { artworkUrl } : {}), isFavourite: favouriteTrackKeys.has(trackKey(track)) }
  })
}

function syncFavouriteFlags() {
  const sync = (track: DisplayTrack) => { track.isFavourite = favouriteTrackKeys.has(trackKey(track)) }
  for (const collection of [state.tracks, state.recentTracks, state.viewTracks, state.visibleTracks, state.queue, state.playbackTracks]) collection.forEach(sync)
  if (state.currentTrack) sync(state.currentTrack)
}

async function refreshFavouriteTrackKeys() {
  const previous = new Set(favouriteTrackKeys)
  favouriteTrackKeys.clear()
  if (favouritePlaylistIndex != null) {
    const tracks = await getAllPlaylistTracks(favouritePlaylistIndex)
    tracks.forEach((track) => favouriteTrackKeys.add(trackKey(track)))
  }
  if (previous.size !== favouriteTrackKeys.size || [...previous].some((key) => !favouriteTrackKeys.has(key))) syncFavouriteFlags()
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
  state.playbackPlanIds = state.playbackTracks.map((track, index) => `playlist:${index}:${trackKey(track)}`)
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

type LibrarySortFields = { artistSort: string; albumArtistSort: string; albumSort: string }

async function loadLibrarySortFields(paths: string[]) {
  const fields = new Map<string, LibrarySortFields>()
  for (let start = 0; start < paths.length; start += 500) {
    const batch = paths.slice(start, start + 500)
    try {
      const result = await fb.titleformat.evalFieldsBatch(batch, {
        artistSort: '$if2($meta(artistsort),$meta(artist sort))',
        albumArtistSort: '$if2($meta(albumartistsort),$meta(album artist sort))',
        albumSort: '$if2($meta(albumsort),$meta(album sort))',
      })
      result.results.forEach((item, index) => {
        if (!item.success || !batch[index]) return
        fields.set(batch[index], {
          artistSort: typeof item.artistSort === 'string' ? item.artistSort : '',
          albumArtistSort: typeof item.albumArtistSort === 'string' ? item.albumArtistSort : '',
          albumSort: typeof item.albumSort === 'string' ? item.albumSort : '',
        })
      })
    } catch {
      // Sort metadata is optional; automatic romanization remains available.
    }
  }
  return fields
}

async function attachAlbumSortNames(albums: AlbumCard[]) {
  const paths = [...new Set(albums.map((album) => album.firstTrackPath).filter((path): path is string => Boolean(path)))]
  if (!paths.length) return
  const fields = await loadLibrarySortFields(paths)
  albums.forEach((album) => { album.sortName = album.firstTrackPath ? fields.get(album.firstTrackPath)?.albumSort || '' : '' })
}

async function attachArtistSortNames(artists: ArtistCard[]) {
  const sources = new Map<string, { path: string; albumArtist: boolean }>()
  state.tracks.forEach((track) => {
    const path = playablePath(track)
    if (track.artist && !sources.has(track.artist)) sources.set(track.artist, { path, albumArtist: false })
    if (track.albumArtist && !sources.has(track.albumArtist)) sources.set(track.albumArtist, { path, albumArtist: true })
  })
  const paths = [...new Set([...sources.values()].map(({ path }) => path))]
  if (!paths.length) return
  const fields = await loadLibrarySortFields(paths)
  artists.forEach((artist) => {
    const source = sources.get(artist.name)
    const sortFields = source ? fields.get(source.path) : null
    artist.sortName = source?.albumArtist ? sortFields?.albumArtistSort || sortFields?.artistSort || '' : sortFields?.artistSort || sortFields?.albumArtistSort || ''
  })
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
  await Promise.all([loadAlbumArtwork(albums), attachAlbumSortNames(albums)])
  if (generation !== libraryGeneration) return
  state.albums = albums
  rebuildAlbumArtworkIndex(albums)
  state.tracks = attachArtwork(trackResult.value.map(normalizeTrack))
  if (recentResult.status === 'fulfilled' && recentResult.value.success !== false) state.recentTracks = attachArtwork((recentResult.value.tracks ?? []).map(normalizeTrack))
}

async function loadPlaylists() {
  const generation = ++playlistGeneration
  const [allPlaylists, active, ownerId] = await Promise.all([fb.playlist.getAll(), fb.playlist.getActive(), getOwnerId()])
  if (generation !== playlistGeneration) return false
  const favouriteName = `收藏 [foo-theme:${ownerId}]`
  favouritePlaylistIndex = allPlaylists.find((playlist) => playlist.name === favouriteName)?.index ?? null
  const playlists = allPlaylists.filter((playlist) => !isThemeInternalPlaylist(playlist, ownerId))
  state.playlists = playlists
  state.activePlaylist = active && playlists.some((playlist) => playlist.index === active.index) ? active : null
  const route = state.route
  if (route.view === 'playlist') {
    state.browsingPlaylist = playlists.find((item) => item.index === route.playlistIndex) ?? null
  }
  await refreshFavouriteTrackKeys()
  return true
}

function isThemeInternalPlaylist(playlist: PlaylistInfo, ownerId: string) {
  return playlist.name === `拖放解析 [foo-theme:${ownerId}]`
    || playlist.name.trim().toLocaleLowerCase() === 'airplay'
    || playlist.name === `正在播放 [foo-theme:${ownerId}]`
    || playlist.name === `收藏 [foo-theme:${ownerId}]`
    || playlist.name === '[WebView Queue]'
    || ['A', 'B'].some((letter) => playlist.name === `正在播放 ${letter} [foo-theme:${ownerId}]`)
    || playlist.name.startsWith('随机播放 ') && playlist.name.endsWith(`[foo-theme:${ownerId}]`)
}

async function loadQueue() {
  if (airplay.state.active) return
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
  if (playbackWorkspace.status.ready) {
    await playbackWorkspace.sync()
    const current = await fb.player.getCurrentTrackIndex()
    const snapshot = playbackWorkspace.projection(current.index ?? -1, true)
    const bridge = playbackWorkspace.bridge()
    const bridgePlaylist = bridge ? (await fb.playlist.getAll()).find((playlist) => playlist.name === bridge.name)?.index : -1
    const planned: DisplayQueueItem[] = snapshot?.order.slice(snapshot.index + 1, snapshot.index + 101).map((track, index) => ({ ...track, sourceIndex: track.sourceIndex ?? index, queueSource: track.playbackQueued ? 'explicit' as const : 'playlist' as const, playlist: track.playbackPlaylistIndex, playlistItem: track.sourceIndex })) ?? []
    const userQueue: DisplayQueueItem[] = (await fb.queue.get()).items.map((item, sourceIndex) => ({ ...item, queueSource: 'explicit' as const, sourceIndex }))
      .filter((item) => !(bridge && item.playlist === bridgePlaylist && item.playlistItem === bridge.item))
    if (generation === queueGeneration) state.queue = [...userQueue, ...planned.map((track) => ({ ...track, artworkUrl: artworkByAlbum.get(albumKey({ name: track.album, artist: track.albumArtist || track.artist })) || track.artworkUrl }))]
    return
  }
  try {
    const [playing, current] = await Promise.all([
      fb.player.getPlayingPlaylist(),
      fb.player.getCurrentTrackIndex(),
    ])
    const playlistIndex = playing.playlist
    const currentIndex = current.index
    if (state.playbackState !== 'stopped' && ![2, 3, 4, 5, 6].includes(state.playbackOrder) && playlistIndex != null && currentIndex != null && playlistIndex >= 0 && currentIndex >= 0) {
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

const playbackWindowCache = new WeakMap<DisplayTrack[], { playlist: number; ids: string[]; positions: Map<string, number> }>()
function getPlaybackWindowData(tracks: DisplayTrack[], playlistIndex: number) {
  let cached = playbackWindowCache.get(tracks)
  if (!cached || cached.playlist !== playlistIndex) {
    const ids = tracks.map((track, index) => track.playbackId ?? `playlist:${playlistIndex}:${index}:${trackKey(track)}`)
    cached = { playlist: playlistIndex, ids, positions: new Map(ids.map((id, index) => [id, index])) }
    playbackWindowCache.set(tracks, cached)
  }
  return cached
}
function setPlaybackWindow(tracks: DisplayTrack[], currentIndex: number, playlistIndex: number, actualPlaylistIndex = playlistIndex) {
  const cached = getPlaybackWindowData(tracks, playlistIndex)
  state.playbackPlanIds = cached.ids
  if (state.playbackWindowDeferred) {
    coverflowPerformance.record('deferredWindowRefresh')
    const start = state.playbackTracks[0]?.sourceIndex ?? 0
    state.playbackTrackIndex = currentIndex >= start && currentIndex < start + state.playbackTracks.length ? currentIndex - start : -1
    state.playingPlaylistIndex = actualPlaylistIndex
    return
  }
  const preview = cached.positions.get(state.playbackPreviewId ?? '') ?? -1
  const startTime = coverflowPerformance.active ? performance.now() : 0
  const start = Math.max(0, (preview >= 0 ? preview : currentIndex) - 30)
  state.playbackTracks = attachArtwork(tracks.slice(start, start + 61)).map((track, offset) => ({ ...track, sourceIndex: start + offset, playbackPlaylistIndex: track.playbackPlaylistIndex ?? playlistIndex, playbackId: cached.ids[start + offset] }))
  state.playbackTrackIndex = currentIndex >= start && currentIndex < start + 61 ? currentIndex - start : -1
  state.playingPlaylistIndex = actualPlaylistIndex
  if (coverflowPerformance.active) coverflowPerformance.record('coverWindowBuild', performance.now() - startTime, state.playbackTracks.length)
}

async function loadPlaybackSequence(force = false) {
  if (airplay.state.active) return
  const generation = ++playbackSequenceGeneration
  const [playing, current] = await Promise.all([fb.player.getPlayingPlaylist(), fb.player.getCurrentTrackIndex(true)])
  if (generation !== playbackSequenceGeneration) return
  const playlistIndex = playing.playlist
  const currentIndex = current.index
  if (playbackWorkspace.status.ready) {
    await syncWorkspaceProjection()
    if (playbackWorkspace.status.ready) return
  }
  if (state.playbackState === 'stopped' && !state.currentTrack) {
    state.playbackTracks = []; state.playbackPlanIds = []; state.playbackTrackIndex = -1; state.playingPlaylistIndex = -1
    return
  }
  if (playlistIndex == null || currentIndex == null || playlistIndex < 0 || currentIndex < 0) {
    state.playbackTracks = state.currentTrack ? [{ ...state.currentTrack, sourceIndex: 0 }] : []
    state.playbackPlanIds = state.playbackTracks.map((track, index) => `playlist:${index}:${trackKey(track)}`)
    state.playbackTrackIndex = state.currentTrack ? 0 : -1
    state.playingPlaylistIndex = -1
    return
  }
  if (!force && state.playingPlaylistIndex === playlistIndex) {
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
  if (generation !== playbackSequenceGeneration) return
  state.playbackTracks = attachArtwork(tracks.map((track, offset) => ({ ...normalizeTrack(track), sourceIndex: start + offset, playbackPlaylistIndex: playlistIndex, playbackId: `playlist:${playlistIndex}:${start + offset}:${trackKey(normalizeTrack(track))}` })))
  state.playbackPlanIds = state.playbackTracks.map((track) => track.playbackId!)
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
  let nextTrack = track === undefined ? state.playbackState === 'stopped' ? null : await fb.player.getCurrentTrack() : track
  if (!nextTrack && state.playbackPreviewPending) return
  if (track === undefined && !nextTrack && state.playbackState !== 'stopped') {
    const position = await fb.player.getCurrentTrackIndex(true)
    nextTrack = position.track ?? null
    if (!nextTrack && playbackWorkspace.status.ready) {
      const snapshot = playbackWorkspace.projection(position.index ?? -1)
      nextTrack = snapshot?.order[snapshot.index] ?? null
    }
  }
  if (request !== mediaRequest) return
  if (!nextTrack && airplay.state.active) { airplay.decoderStopped(); return }
  if (airplayPath(nextTrack)) {
    await airplay.accept({ track: normalizeTrack(nextTrack!), position: state.position })
    airplay.reconcile()
    return
  }
  if (airplay.state.active) { airplay.stop(); await playbackWorkspace.resume() }
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
    if (insertingPlaylistIndexes.has(event.playlist)) return
    if (state.route.view === 'playlist' && state.route.playlistIndex === event.playlist) refreshSafely(refreshActivePlaylist)
    if (state.playingPlaylistIndex === event.playlist) refreshSafely(() => loadPlaybackSequence(true))
    const refreshFavouriteView = event.playlist === favouritePlaylistIndex && (state.route.view === 'favourites' || (state.route.view === 'songs' && state.libraryFilters.favourite !== 'all'))
    refreshSafely(async () => {
      await loadPlaylists()
      if (refreshFavouriteView) await navigate(state.route, 'none')
    })
    refreshSafely(loadQueue)
  }
  const reloadPlaylistStructure = async () => {
    if (!await loadPlaylists()) return
    const route = state.route
    if (route.view === 'playlist') {
      const matches = state.playlists.filter((playlist) => playlist.name === route.playlistName)
      if (matches.length === 1) await navigate({ ...route, playlistIndex: matches[0].index }, 'none', false)
      else await navigate({ view: 'home' }, 'replace')
    }
  }
  subscriptions = [
    fb.on('playback:starting', event => {
      if (airplay.state.active && airplayPath(state.currentTrack) && (event.command === 'next' || event.command === 'prev')) airplay.recordStarting(event.command === 'next' ? 1 : -1)
      else if (airplay.state.active) airplay.reconcile()
    }),
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
      if (airplay.state.active && event.state !== 'stopped') airplay.reconcile()
    }),
    fb.on('playback:paused', (event) => {
      state.playbackState = event.paused ? 'paused' : 'playing'
      state.isPlaying = !event.paused
      if (airplay.state.active) airplay.reconcile()
    }),
    fb.on('playback:stopped', (event) => {
      if (event.reason === 'starting_another') return
      if (airplay.state.active) {
        if (event.reason === 'shutting_down') { airplay.dispose(); return }
        state.isPlaying = false; state.playbackState = 'stopped'; state.canSeek = false
        airplay.decoderStopped(); return
      }
      if (state.playbackPreviewPending && event.reason === 'unknown') return
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
      airplay.observePosition(event.position)
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
      if (airplay.state.active) { airplay.reconcile(); return }
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
      if (externalDropHandler) { externalDropHandler(event); return }
      if (event.paths.length) refreshSafely(() => importPaths(event.paths))
      else refreshSafely(importDroppedPaths)
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
  try {
    const saved = (await fb.config.get(miniWindowConfigKey)).value as MainWindowSnapshot | null
    if (saved && saved.bounds && saved.bounds.width > 0 && saved.bounds.height > 0 && saved.minSize) {
      mainWindowSnapshot = saved
      miniPlayerMode.value = true
    }
  } catch {
    // A normal window remains usable when no saved mini-window state exists.
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
      await Promise.all([syncNoDragRegion(), loadThemePreferences()])
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
      await playbackWorkspace.restore()
      await syncCurrentTrack()
      if (!playbackWorkspace.status.ready && state.currentTrack) await ensurePlaybackWorkspace()
      await Promise.allSettled([loadQueue(), loadPlaybackSequence(), navigate(state.route, 'none')])
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

export function routeKey(route: ViewRoute) {
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
  if (route.view === 'search') {
    await loadLibraryArtists()
    return loadSearchTracks(route.query)
  }
  if (route.view === 'favourites') {
    if (!state.connected) return state.tracks.filter((track) => favouriteTrackKeys.has(trackKey(track)))
    if (favouritePlaylistIndex == null) return []
    return getAllPlaylistTracks(favouritePlaylistIndex)
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
    const artistCards: ArtistCard[] = [...artists].map(([name, value]): ArtistInfo => ({ name, trackCount: value.tracks, albumCount: value.albums.size, duration: value.duration }))
    await attachArtistSortNames(artistCards)
    state.artists = artistCards
    return
  }
  const result = await fb.library.getArtists(100000)
  if (!result.success) throw new Error(result.error || '无法加载艺术家。')
  const artistCards: ArtistCard[] = result.items
  await attachArtistSortNames(artistCards)
  state.artists = artistCards
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
    if (filters.folder && !track.path.replaceAll('\\', '/').toLocaleLowerCase().startsWith(filters.folder.toLocaleLowerCase())) return false
    const rating = Number(track.rating ?? 0)
    if (filters.rating === 'unrated' && rating !== 0) return false
    if (filters.rating !== 'all' && filters.rating !== 'unrated' && rating !== Number(filters.rating)) return false
    if (filters.favourite === 'favourite' && !track.isFavourite) return false
    if (filters.favourite === 'unfavourite' && track.isFavourite) return false
    if (!activeRules.length) return true
    return filters.matchMode === 'all'
      ? activeRules.every((rule) => matchesLibraryRule(track, rule))
      : activeRules.some((rule) => matchesLibraryRule(track, rule))
  })
  return filtered
}

async function refreshLibraryFilters() {
  if (state.route.view === 'songs') await navigate(state.route, 'none')
}

async function setLibraryFilterFacet(key: 'artist' | 'albumArtist' | 'folder' | 'rating' | 'favourite', value: string) {
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
  Object.assign(state.libraryFilters, { artist: '', albumArtist: '', folder: '', rating: 'all', favourite: 'all', matchMode: 'all', rules: [{ id: 'primary', field: 'all', operator: 'contains', value: '' }] })
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

async function navigate(route: ViewRoute, historyMode: 'push' | 'replace' | 'none' = 'push', animateNavigation = true) {
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
  const previousRoute = state.route
  const routeChanged = routeKey(route) !== routeKey(previousRoute)
  if (historyMode !== 'none') {
    closeNowPlaying()
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
  // Synchronous subscribers capture the OLD DOM before Vue patches the route.
  if (routeChanged) routeNavigation.value = { from: previousRoute, to: route, generation, animate: animateNavigation }
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
    if (generation === routeGeneration) {
      state.searchLoading = false
      routeReady.value = { route: state.route, generation }
    }
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
  closeNowPlaying()
  state.dialog = null
  historyIndex -= 1
  updateHistoryState()
  await navigate(history[historyIndex], 'none')
}

async function goForward() {
  if (!state.canGoForward) return
  closeNowPlaying()
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
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = null
  searchGeneration += 1
  await navigate({ view: 'search', query }, state.view === 'search' ? 'replace' : 'push')
}

async function clearSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = null
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

async function browsePlaylist(index: number) {
  const playlist = state.playlists.find((item) => item.index === index)
  if (!playlist) return
  await navigate({ view: 'playlist', playlistIndex: playlist.index, playlistName: playlist.name }, 'none', false)
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

async function browseFavourites() {
  await navigate({ view: 'favourites' }, 'none', false)
}

async function loadRadio(pushHistory = true) {
  await navigate({ view: 'radio', nonce: ++radioNonce }, pushHistory ? 'push' : 'none')
}

async function playTrack(track: DisplayTrack, index?: number) {
  if (airplayPath(track)) return
  settledSkip.cancel()
  if (!track) return
  if (isSameTrack(track, state.currentTrack) && state.playbackState !== 'stopped') {
    await togglePlayback()
    return
  }
  if (!state.connected) {
    const collection = state.visibleTracks.length ? state.visibleTracks : [track]
    const currentIndex = collection.findIndex((item) => isSameTrack(item, track))
    if (!await playbackWorkspace.start(collection, Math.max(0, currentIndex), '当前曲目集合', currentPlaybackMode())) return
    await refreshWorkspace()
    state.isPlaying = true
    state.playbackState = 'playing'
    return
  }

  const route = state.route
  if (route.view === 'playlist') {
    const resolvedIndex = await resolvePlaylistTrackIndex(route.playlistIndex, track, track.sourceIndex ?? index)
    if (resolvedIndex == null) return
    await playbackWorkspace.start(await getAllPlaylistTracks(route.playlistIndex), resolvedIndex, route.playlistName, currentPlaybackMode())
    await refreshWorkspace()
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

async function loadThemePreferences() {
  try {
    const result = await fb.config.get(preferencesConfigKey)
    const value = result.value as { alphabetIndexView?: unknown } | null
    state.alphabetIndexView = Boolean(value?.alphabetIndexView)
  } catch {
    // The default continuous grid remains usable when preference storage is unavailable.
  }
}

async function setAlphabetIndexView(enabled: boolean) {
  state.alphabetIndexView = enabled
  if (!state.connected) return
  const saved = await runAction(() => fb.config.set(preferencesConfigKey, { alphabetIndexView: enabled }))
  if (!saved) state.alphabetIndexView = !enabled
}

async function playGeneratedCollection(tracks: DisplayTrack[], playIndex = 0, random = false, message?: string) {
  if (tracks.some(track => Boolean(airplayPath(track)))) return
  settledSkip.cancel()
  const requestedIndex = Number.isInteger(playIndex) ? playIndex : 0
  const entries = tracks.map((track, originalIndex) => ({ originalIndex, path: playablePath(track) })).filter((item) => item.path)
  const mappedPlayIndex = entries.findIndex((item) => item.originalIndex === requestedIndex)
  if (!entries.length || mappedPlayIndex < 0) { notify('所选集合没有可播放路径。', 'info'); return false }
  const started = await playbackWorkspace.start(entries.map((entry) => tracks[entry.originalIndex]), mappedPlayIndex, message || state.selectedAlbum?.name || '当前曲目集合', currentPlaybackMode(), random)
  if (!started) return false
  if (!state.connected) { state.position = 0; state.isPlaying = true; state.playbackState = 'playing' }
  await refreshWorkspace()
  return true
}

async function playCurrentCollection() {
  if (state.route.view === 'playlist') return playPlaylist(state.route.playlistIndex)
  await playGeneratedCollection(state.visibleTracks)
}

async function playTrackCollection(tracks: DisplayTrack[], random = false) {
  if (!tracks.length) {
    notify('所选文件夹没有可播放的曲目。', 'info')
    return
  }
  await playGeneratedCollection(tracks, 0, random, random ? '所选曲目集合' : undefined)
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
    tracks.push(...page.map((track, offset) => ({ ...normalizeTrack(track), sourceIndex: start + offset, playbackId: `playlist:${playlistIndex}:${start + offset}:${trackKey(normalizeTrack(track))}`, playbackPlaylistIndex: playlistIndex })))
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
  await playGeneratedCollection(tracks, 0, true, album.name)
}

async function queueAlbum(album: AlbumCard) {
  const tracks = await getAlbumTracks(album)
  const paths = tracks.map(playablePath).filter(Boolean)
  if (!paths.length) return
  await addTracksToQueue(tracks)
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
  settledSkip.cancel()
  const playlist = state.playlists.find((item) => item.index === playlistIndex)
  if (!playlist) return
  if (shuffled) {
    const tracks = state.connected ? await getAllPlaylistTracks(playlistIndex) : state.tracks
    await playGeneratedCollection(tracks, 0, true, playlist.name)
    return
  }
  if (!state.connected) {
    const tracks = state.tracks
    if (tracks[0]) await playGeneratedCollection(tracks, 0, false, playlist.name)
    return
  }
  if (!playlist.trackCount) {
    notify('此播放列表为空。', 'info')
    return
  }
  await playbackWorkspace.start(await getAllPlaylistTracks(playlistIndex), 0, playlist.name, currentPlaybackMode())
  await refreshWorkspace()
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

async function reorderPlaylistTrack(from: number, to: number, after = false, selectedVisibleIndexes: number[] = [from]) {
  const route = state.route
  if (route.view !== 'playlist' || !selectedVisibleIndexes.length) return
  const playlist = state.playlists.find((item) => item.index === route.playlistIndex)
  if (!playlist || playlist.isLocked || playlist.isAutoplaylist) return
  const visibleIndexes = [...new Set(selectedVisibleIndexes)].sort((left, right) => left - right)
  const selectedTracks = visibleIndexes.map((index) => state.visibleTracks[index]).filter((track): track is DisplayTrack => Boolean(track))
  const targetTrack = state.visibleTracks[to]
  if (selectedTracks.length !== visibleIndexes.length || !targetTrack) return
  const snapshot = await getAllPlaylistTracks(route.playlistIndex)
  const usedIndexes = new Set<number>()
  const resolveFromSnapshot = (track: DisplayTrack) => {
    const hint = track.sourceIndex
    if (hint != null && snapshot[hint] && trackKey(snapshot[hint]) === trackKey(track) && !usedIndexes.has(hint)) return hint
    return snapshot.findIndex((item) => !usedIndexes.has(item.sourceIndex ?? -1) && isSameTrack(item, track))
  }
  const selectedIndexes: number[] = []
  for (const track of selectedTracks) {
    const index = resolveFromSnapshot(track)
    if (index < 0) {
      notify('播放列表已变化，请重新选择后再排序。', 'info')
      await refreshActivePlaylist()
      return
    }
    usedIndexes.add(index)
    selectedIndexes.push(index)
  }
  selectedIndexes.sort((left, right) => left - right)
  const targetHint = targetTrack.sourceIndex
  const target = targetHint != null && snapshot[targetHint] && trackKey(snapshot[targetHint]) === trackKey(targetTrack)
    ? targetHint
    : snapshot.findIndex((item) => isSameTrack(item, targetTrack))
  if (target < 0) {
    notify('播放列表已变化，请重新选择后再排序。', 'info')
    await refreshActivePlaylist()
    return
  }
  const boundary = after ? target + 1 : target
  const remaining = snapshot.map((_, index) => index).filter((index) => !selectedIndexes.includes(index))
  const insertion = boundary - selectedIndexes.filter((index) => index < boundary).length
  const order = [...remaining.slice(0, insertion), ...selectedIndexes, ...remaining.slice(insertion)]
  if (order.every((index, position) => index === position)) return
  const result = await runAction(() => fb.playlist.reorder(route.playlistIndex, order), '已调整播放列表顺序')
  if (result) await refreshActivePlaylist()
}

async function reorderPlaylists(order: number[]) {
  const currentOrder = state.playlists.map((playlist) => playlist.index)
  if (order.length !== currentOrder.length || new Set(order).size !== order.length || order.some((index) => !currentOrder.includes(index))) return
  if (order.every((index, position) => index === currentOrder[position])) return
  const [allPlaylists, ownerId] = await Promise.all([fb.playlist.getAll(), getOwnerId()])
  const visiblePlaylists = allPlaylists.filter((playlist) => !isThemeInternalPlaylist(playlist, ownerId))
  if (visiblePlaylists.length !== order.length || visiblePlaylists.some((playlist) => !order.includes(playlist.index))) {
    notify('播放列表已变化，请重新拖动排序。', 'info')
    await loadPlaylists()
    return
  }
  const oldPositionByIndex = new Map(allPlaylists.map((playlist, position) => [playlist.index, position]))
  let nextVisible = 0
  const merged = allPlaylists.map((playlist) => {
    if (isThemeInternalPlaylist(playlist, ownerId)) return playlist.index
    return order[nextVisible++]
  })
  const newOrder = merged.map((index) => oldPositionByIndex.get(index))
  if (newOrder.some((position) => position == null)) return
  const result = await runAction(() => fb.playlist.reorderPlaylists(newOrder as number[]), '已调整播放列表顺序')
  if (!result) return
  const remapPlaylistRoute = (route: ViewRoute): ViewRoute => {
    if (route.view !== 'playlist') return route
    const oldPlaylist = allPlaylists.find((playlist) => playlist.index === route.playlistIndex)
    if (oldPlaylist?.name !== route.playlistName) return route
    const nextPlaylistIndex = merged.indexOf(route.playlistIndex)
    return nextPlaylistIndex >= 0 ? { ...route, playlistIndex: nextPlaylistIndex } : route
  }
  history.forEach((route, index) => { history[index] = remapPlaylistRoute(route) })
  state.route = remapPlaylistRoute(state.route)
  await loadPlaylists()
}

async function movePlaylistToTop(playlistIndex: number) {
  const order = state.playlists.map((playlist) => playlist.index)
  const position = order.indexOf(playlistIndex)
  if (position <= 0) return
  order.splice(position, 1)
  order.unshift(playlistIndex)
  await reorderPlaylists(order)
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
  const route = state.route
  const name = route.view === 'playlist' ? route.playlistName : route.view === 'album' ? route.albumName : route.view === 'artist' ? route.artist : '当前曲目集合'
  await playGeneratedCollection(state.visibleTracks, 0, true, name)
}

async function togglePlayback() {
  settledSkip.cancel(state.playbackPreviewPending)
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
  if (airplay.state.active || airplayPath(state.currentTrack)) { await airplay.remote(1); return }
  if (!playbackWorkspace.status.ready) await ensurePlaybackWorkspace()
  const pending = previewSkip(1)
  if (pending) { await pending; return }
  settledSkip.cancel()
  if (playbackWorkspace.status.ready) { await playbackWorkspace.next(); await refreshWorkspace() }
  else if (state.connected) await runAction(() => fb.player.next())
  else if (state.tracks.length) {
    const current = state.tracks.findIndex((track) => isSameTrack(track, state.currentTrack))
    await playTrack(state.tracks[(current + 1) % state.tracks.length])
  }
}

async function previous() {
  if (airplay.state.active || airplayPath(state.currentTrack)) { await airplay.remote(-1); return }
  if (!playbackWorkspace.status.ready) await ensurePlaybackWorkspace()
  const pending = previewSkip(-1)
  if (pending) { await pending; return }
  settledSkip.cancel()
  const previousTrack = state.playbackTracks[state.playbackTrackIndex - 1]
  if (playbackWorkspace.status.ready && previousTrack?.playbackId?.startsWith('work:')) {
    await playbackWorkspace.jump(previousTrack); await refreshWorkspace(); return
  }
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
  if (airplay.state.active || airplayPath(state.currentTrack)) return false
  settledSkip.cancel(state.playbackPreviewPending)
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
  const key = trackKey(state.currentTrack)
  const playback = await fb.player.getState()
  if (key !== trackKey(state.currentTrack)) return
  state.canSeek = !airplay.state.active && !airplayPath(state.currentTrack) && playback.canSeek
  state.playbackState = playback.state
  state.isPlaying = playback.state === 'playing'
}

async function playPlaybackTrack(track: DisplayTrack) {
  if (airplayPath(track)) {
    if (airplay.state.active && airplayPath(track) === airplay.state.path) await togglePlayback()
    return
  }
  let target = lookupWorkspaceTrack(track)
  if (!target) {
    settledSkip.cancel()
    const version = playbackSelectionVersion
    if (await ensurePlaybackWorkspace()) target = lookupWorkspaceTrack(track)
    if (version !== playbackSelectionVersion) return
  }
  if (target) { await settledSkip.schedule(target.playbackId!); return }
  if (track.playbackId?.startsWith('work:')) { notify('播放计划条目已变化，请重新选择。', 'info'); return }
  settledSkip.cancel()
  if (track.playbackPlaceholder) return togglePlayback()
  if (!state.connected) return playTrack(track)
  const playlistIndex = track.playbackPlaylistIndex ?? state.playingPlaylistIndex
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

function currentPlaybackMode(): PlaybackMode {
  return [0, 1, 2].includes(state.playbackOrder) ? state.playbackOrder as PlaybackMode : 0
}

async function cyclePlaybackOrder() {
  if (airplay.state.active) { notify('AirPlay 播放顺序由发送端控制。', 'info'); return }
  const mode = ((currentPlaybackMode() + 1) % 3) as PlaybackMode
  await ensurePlaybackWorkspace()
  if (!await playbackWorkspace.setMode(mode)) return
  await refreshWorkspace()
  state.playbackOrder = mode
  notify(['默认播放', '列表循环', '单曲循环'][mode])
}

async function shufflePlaybackPlan() {
  if (airplay.state.active) return
  if (!await ensurePlaybackWorkspace()) { notify('请先选择曲目建立播放工作集。', 'info'); return }
  if (!await playbackWorkspace.shuffle()) return
  await refreshWorkspace()
  notify(state.shuffleStaged ? '最新随机计划已更新，等待安全提交。' : '已随机重排待播放曲目', 'success')
}

async function restorePlaybackPlan() {
  if (airplay.state.active) return
  if (!await ensurePlaybackWorkspace()) return
  if (!await playbackWorkspace.restoreOrder()) return
  await refreshWorkspace()
  notify(state.shuffleStaged ? '待播放原序已更新，保留人工编辑，等待安全提交。' : '已恢复待播放原序，保留人工编辑', 'success')
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
  await addTracksToQueue([track])
}

async function addTracksToQueue(tracks: DisplayTrack[]) {
  if (airplay.state.active) { notify('AirPlay 队列由发送端管理，请切回本地播放后编辑待播曲目。', 'info'); return }
  if (!tracks.length) return
  const success = await ensurePlaybackWorkspace() ? await playbackWorkspace.add(tracks) : await playbackWorkspace.seed(tracks)
  if (!success) return
  await refreshWorkspace()
  notify(`已将 ${tracks.length} 首曲目添加到计划队列`, 'success')
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
    const sourceTracks = await getAllPlaylistTracks(sourcePlaylistIndex)
    const usedIndexes = new Set<number>()
    const indexes: number[] = []
    for (const track of tracks) {
      const hintedIndex = track.sourceIndex
      const hintedTrack = hintedIndex == null ? null : sourceTracks[hintedIndex]
      const hasMatchingHint = hintedIndex != null && hintedTrack && trackKey(hintedTrack) === trackKey(track) && !usedIndexes.has(hintedIndex)
      const resolvedIndex: number = hasMatchingHint
        ? hintedIndex!
        : sourceTracks.findIndex((item) => !usedIndexes.has(item.sourceIndex ?? -1) && isSameTrack(item, track))
      if (resolvedIndex < 0) {
        notify('播放列表已变化，请重新选择后再移动。', 'info')
        return
      }
      usedIndexes.add(resolvedIndex)
      indexes.push(resolvedIndex)
    }
    if (indexes.length !== tracks.length) {
      notify('播放列表已变化，请重新选择后再移动。', 'info')
      return
    }
    indexes.sort((a, b) => b - a)
    const added = await runAction(() => fb.playlist.add(destinationPlaylistIndex, tracks.map(playablePath)))
    if (!added) return
    const removed = await runAction(() => fb.playlist.removeTracks(sourcePlaylistIndex, indexes))
    if (!removed) return
    notify(`已将 ${tracks.length} 首曲目移动至“${destination.name}”`, 'success')
    if (state.route.view === 'playlist' && state.route.playlistIndex === sourcePlaylistIndex) await refreshActivePlaylist()
  }

  async function removeTracksFromPlaylist(tracks: DisplayTrack[], playlistIndex: number) {
    const playlist = state.playlists.find((item) => item.index === playlistIndex)
    if (!playlist || playlist.isLocked || playlist.isAutoplaylist || !tracks.length) return
    if (!state.connected) {
      const indexes = tracks.map((track) => track.sourceIndex).filter((index): index is number => index != null).sort((a, b) => b - a)
      indexes.forEach((index) => state.viewTracks.splice(index, 1))
      state.visibleTracks = state.viewTracks.slice()
      notify(`已从“${playlist.name}”移除 ${tracks.length} 首曲目`, 'success')
      return
    }
    const sourceTracks = await getAllPlaylistTracks(playlistIndex)
    const usedIndexes = new Set<number>()
    const indexes: number[] = []
    for (const track of tracks) {
      const hintedIndex = track.sourceIndex
      const hintedTrack = hintedIndex == null ? null : sourceTracks[hintedIndex]
      const hasMatchingHint = hintedIndex != null && hintedTrack && trackKey(hintedTrack) === trackKey(track) && !usedIndexes.has(hintedIndex)
      const index = hasMatchingHint ? hintedIndex! : sourceTracks.findIndex((item) => !usedIndexes.has(item.sourceIndex ?? -1) && isSameTrack(item, track))
      if (index < 0) {
        notify('播放列表已变化，请重新选择后再移除。', 'info')
        return
      }
      usedIndexes.add(index)
      indexes.push(index)
    }
    const result = await runAction(() => fb.playlist.removeTracks(playlistIndex, indexes.sort((a, b) => b - a)))
    if (!result) return
    notify(`已从“${playlist.name}”移除 ${tracks.length} 首曲目`, 'success')
    if (state.route.view === 'playlist' && state.route.playlistIndex === playlistIndex) await refreshActivePlaylist()
  }

  async function insertTracksIntoPlaylist(tracks: DisplayTrack[], sourcePlaylistIndex: number | null, destinationPlaylistIndex: number, targetIndex: number, after: boolean, move: boolean) {
    const source = sourcePlaylistIndex == null ? null : state.playlists.find((item) => item.index === sourcePlaylistIndex)
    const destination = state.playlists.find((item) => item.index === destinationPlaylistIndex)
    if (!destination || sourcePlaylistIndex != null && (!source || sourcePlaylistIndex === destinationPlaylistIndex || source.isLocked || source.isAutoplaylist) || destination.isLocked || destination.isAutoplaylist || !tracks.length) return
    const destinationTracks = await getAllPlaylistTracks(destinationPlaylistIndex)
    if (targetIndex < 0 || targetIndex > destinationTracks.length) return
    insertingPlaylistIndexes.add(destinationPlaylistIndex)
    let changed = false
    try {
      const added = await runAction(() => fb.playlist.add(destinationPlaylistIndex, tracks.map(playablePath)))
      const addedCount = Number(added?.addedCount ?? 0)
      changed = addedCount > 0
      if (!added || addedCount !== tracks.length) {
        notify('部分曲目未能插入目标播放列表。', 'info')
        return
      }
      const appended = Array.from({ length: addedCount }, (_, index) => destinationTracks.length + index)
      const insertion = Math.min(destinationTracks.length, targetIndex + (after ? 1 : 0))
      const original = Array.from({ length: destinationTracks.length }, (_, index) => index)
      const order = [...original.slice(0, insertion), ...appended, ...original.slice(insertion)]
      if (!order.every((index, position) => index === position) && !await runAction(() => fb.playlist.reorder(destinationPlaylistIndex, order))) return
      if (move && sourcePlaylistIndex != null) await removeTracksFromPlaylist(tracks, sourcePlaylistIndex)
      notify(`已将 ${tracks.length} 首曲目插入“${destination.name}”`, 'success')
    } finally {
      insertingPlaylistIndexes.delete(destinationPlaylistIndex)
      if (changed) {
        await loadPlaylists()
        if (state.route.view === 'playlist' && state.route.playlistIndex === destinationPlaylistIndex) await refreshActivePlaylist()
        if (state.playingPlaylistIndex === destinationPlaylistIndex) await loadPlaybackSequence()
        await loadQueue()
      }
    }
  }

async function playNext(track: DisplayTrack) {
  if (airplay.state.active) { notify('AirPlay 下一首由发送端控制，不能插入本地曲目。', 'info'); return }
  const success = await ensurePlaybackWorkspace() ? await playbackWorkspace.add([track], true) : await playbackWorkspace.seed([track])
  if (!success) return
  await refreshWorkspace()
  notify(state.shuffleStaged ? '下一首修改待计划提交，手动下一首将优先应用。' : '已插入计划下一首', 'success')
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
  const output: Record<PluginId, PluginContextAction[]> & { tools: NativeMenuNode[] } = { converter: [], freedb: [], dop: [], tools: [] }
  if (!state.connected || !tracks.length) return output
  const handles = tracks.map(playablePath).filter(Boolean)
  if (!handles.length) return output
  const result = await runAction(() => fb.menu.getContextMenu({ mode: 'handles', handles, withAvailability: true }))
  if (!result?.items) return output
  collectPluginActions(result.items, output)
  output.tools = findNativeTools(result.items)
  ;(['converter', 'freedb', 'dop'] as PluginId[]).forEach((id) => {
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

async function showNativeTrackProperties(tracks: DisplayTrack[]) {
  const handles = tracks.map(playablePath).filter(Boolean)
  if (!state.connected || !handles.length) return false
  const menu = await runAction(() => fb.menu.getContextMenu({ mode: 'handles', handles, withAvailability: true }))
  const command = findNativeMenuCommand(menu?.items, 'properties')
  if (command?.commandId == null) {
    notify('当前 foobar2000 未提供可执行的“属性”命令。', 'info')
    return false
  }
  const result = await runAction(() => fb.menu.runContextCommandById(command.commandId!, { mode: 'handles', handles }))
  return Boolean(result)
}

async function runNativePlaylistCleanup(playlistIndex: number, kind: 'duplicates' | 'invalid') {
  const playlist = state.playlists.find((item) => item.index === playlistIndex)
  if (!state.connected || !playlist || playlist.isLocked || playlist.isAutoplaylist) return false
  if (!await runAction(() => fb.playlist.setActive(playlistIndex))) return false
  state.activePlaylist = playlist
  const menu = await runAction(() => fb.menu.getMainMenu())
  const command = findNativeMenuCommand(menu?.items, kind)
  if (!command?.command) {
    notify(`当前 foobar2000 未提供“${kind === 'duplicates' ? '移除重复项' : '移除无效项'}”命令。`, 'info')
    return false
  }
  const result = await runAction(() => fb.menu.runMainMenuCommand(command.command!))
  if (!result) return false
  await loadPlaylists()
  if (state.route.view === 'playlist' && state.route.playlistIndex === playlistIndex) await refreshActivePlaylist()
  notify(`已执行原生“${kind === 'duplicates' ? '移除重复项' : '移除无效项'}”。`, 'success')
  return true
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
  if (miniWindowTask) return miniWindowTask
  if (miniPlayerMode.value) return
  miniWindowTask = (async () => {
    try {
      await closeNowPlaying()
      const [windowState, minSize, resizable, topmost] = await Promise.all([fb.ui.getState(), fb.ui.getMinSize(), fb.ui.isResizable(), fb.ui.isAlwaysOnTop()])
      if (windowState.isMaximized && !await runAction(() => fb.ui.restore())) return
      const bounds = await fb.ui.getBounds()
      mainWindowSnapshot = { bounds, minSize, maximized: windowState.isMaximized, resizable: resizable.resizable, alwaysOnTop: topmost.enabled }
      if (!await runAction(() => fb.config.set(miniWindowConfigKey, mainWindowSnapshot))) throw new Error('无法保存主窗口尺寸。')
      miniPlayerMode.value = true
      for (const action of [() => fb.ui.setMinSize(430, 156), () => fb.ui.setResizable(false), () => fb.ui.setSize(430, 156), () => fb.ui.setAlwaysOnTop(true)]) {
        if (!await runAction(action)) throw new Error('无法切换主窗口为迷你播放器。')
      }
    } catch (error) {
      if (mainWindowSnapshot) await restoreMainWindowSnapshot()
      notify(error instanceof Error ? error.message : '无法打开迷你播放器。', 'error')
    }
  })().finally(() => { miniWindowTask = null })
  return miniWindowTask
}

async function restoreMainWindowSnapshot() {
  const saved = mainWindowSnapshot
  if (!saved) return
  let restored = true
  for (const action of [() => fb.ui.setResizable(saved.resizable), () => fb.ui.setMinSize(saved.minSize.width, saved.minSize.height), () => fb.ui.setBounds(saved.bounds), () => fb.ui.setAlwaysOnTop(saved.alwaysOnTop), ...(saved.maximized ? [() => fb.ui.maximize()] : [])]) {
    if (!await runAction(action)) restored = false
  }
  if (!restored) return
  miniPlayerMode.value = false
  mainWindowSnapshot = null
  await runAction(() => fb.config.set(miniWindowConfigKey, null))
}

async function restoreMainPlayer() {
  if (miniWindowTask) await miniWindowTask
  if (!mainWindowSnapshot) return
  miniWindowTask = restoreMainWindowSnapshot().finally(() => { miniWindowTask = null })
  return miniWindowTask
}

async function startWindowDrag() {
  if (state.connected) await runAction(() => fb.ui.startDrag())
}

async function toggleWindowMaximize() {
  if (state.connected) await runAction(() => fb.ui.toggleMaximize())
}

async function closeWindow() {
  if (state.connected) {
    if (miniPlayerMode.value) await restoreMainPlayer()
    await runAction(() => fb.ui.close())
  }
  else window.close()
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
    expanded.push(...files.sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })))
  }
  const unique = [...new Map(expanded.map((path) => [windowsPathKey(path), path])).values()]
  return removeDescriptorDuplicates(await filterImportCandidates(unique))
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
    if (!await playbackWorkspace.start(await getAllPlaylistTracks(playlist.index), firstAddedIndex, playlist.name, currentPlaybackMode())) return
    await refreshWorkspace()
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

const externalImporter = createExternalImporter({
  owner: getOwnerId, expand: expandImportPaths, tracks: getAllPlaylistTracks,
  reorder: reorderPlaylists, visible: () => state.playlists,
  refresh: async index => {
    await loadPlaylists()
    if (index != null && state.route.view === 'playlist' && state.route.playlistIndex === index) await refreshActivePlaylist()
  },
  select: selectActivePlaylist,
  play: async (tracks, name) => {
    if (tracks.some(track => Boolean(airplayPath(track)))) return false
    const success = await playGeneratedCollection(tracks, 0, false, name)
    if (success) { await syncCurrentTrack(); await refreshWorkspace() }
    return success
  },
  fallback: importPaths,
})
let externalImports = 0
async function importExternalPaths(paths: string[], target: ExternalDropTarget) {
  if (!state.connected) return
  externalImports += 1; state.importing = true
  try { await externalImporter.importPaths(paths, target); notify('已完成拖放导入。', 'success') }
  finally { externalImports -= 1; state.importing = externalImports > 0 }
}
function setExternalDropHandler(handler: typeof externalDropHandler) { externalDropHandler = handler }

async function ensureFavouritePlaylist() {
  if (favouritePlaylistIndex != null) return favouritePlaylistIndex
  const ownerId = await getOwnerId()
  const name = `收藏 [foo-theme:${ownerId}]`
  const existing = (await fb.playlist.getAll()).find((playlist) => playlist.name === name)
  if (existing) {
    favouritePlaylistIndex = existing.index
    return existing.index
  }
  const created = await runAction(() => fb.playlist.create(name))
  if (!created) return null
  favouritePlaylistIndex = created.index
  await loadPlaylists()
  return created.index
}

async function toggleFavourite(track: DisplayTrack) {
  const key = trackKey(track)
  if (!state.connected) {
    if (favouriteTrackKeys.has(key)) favouriteTrackKeys.delete(key)
    else favouriteTrackKeys.add(key)
    syncFavouriteFlags()
    notify(favouriteTrackKeys.has(key) ? '已添加到收藏' : '已取消收藏', 'success')
    return
  }
  const playlistIndex = await ensureFavouritePlaylist()
  if (playlistIndex == null) return
  if (favouriteTrackKeys.has(key)) {
    const tracks = await getAllPlaylistTracks(playlistIndex)
    const indexes = tracks.filter((item) => trackKey(item) === key).map((item) => item.sourceIndex).filter((index): index is number => index != null)
    if (!indexes.length || !await runAction(() => fb.playlist.removeTracks(playlistIndex, indexes))) return
  } else if (!await runAction(() => fb.playlist.add(playlistIndex, [playablePath(track)]))) return
  await refreshFavouriteTrackKeys()
  notify(favouriteTrackKeys.has(key) ? '已添加到收藏' : '已取消收藏', 'success')
  if (state.view === 'favourites' && !favouriteTrackKeys.has(key)) {
    state.viewTracks = state.viewTracks.filter((item) => trackKey(item) !== key)
    state.visibleTracks = state.viewTracks.slice()
  }
}

let favouriteMutationQueue: Promise<unknown> = Promise.resolve()
function setTracksFavourite(tracks: DisplayTrack[], favourite: boolean) {
  const unique = [...new Map(tracks.map((track) => [trackKey(track), track])).values()]
  const action = favouriteMutationQueue.catch(() => {}).then(async () => {
    if (!unique.length) return
    if (!state.connected) {
      unique.forEach((track) => favourite ? favouriteTrackKeys.add(trackKey(track)) : favouriteTrackKeys.delete(trackKey(track)))
      syncFavouriteFlags()
      if (state.route.view === 'favourites') await navigate(state.route, 'none', false)
      notify(favourite ? `已收藏 ${unique.length} 首曲目` : `已取消 ${unique.length} 首曲目的收藏`, 'success')
      return
    }
    const playlistIndex = await ensureFavouritePlaylist()
    if (playlistIndex == null) return
    const current = await getAllPlaylistTracks(playlistIndex)
    const currentKeys = new Set(current.map(trackKey))
    const wantedKeys = new Set(unique.map(trackKey))
    const additions = unique.filter((track) => !currentKeys.has(trackKey(track)))
    const removals = current.filter((track) => wantedKeys.has(trackKey(track))).map((track) => track.sourceIndex).filter((index): index is number => index != null).sort((a, b) => b - a)
    if (favourite ? !additions.length : !removals.length) {
      await refreshFavouriteTrackKeys()
      notify(favourite ? '所选曲目已在收藏中。' : '所选曲目已不在收藏中。', 'info')
      return
    }
    // Suppress intermediate item events just like an insert transaction.
    insertingPlaylistIndexes.add(playlistIndex)
    try {
      const result = await runAction(() => favourite
        ? fb.playlist.add(playlistIndex, additions.map(playablePath))
        : fb.playlist.removeTracks(playlistIndex, removals))
      if (result) notify(favourite ? `已收藏 ${additions.length} 首曲目` : `已取消 ${unique.length} 首曲目的收藏`, 'success')
    } finally {
      insertingPlaylistIndexes.delete(playlistIndex)
      await loadPlaylists()
      if (state.route.view === 'favourites' || state.route.view === 'songs' && state.libraryFilters.favourite !== 'all') await navigate(state.route, 'none', false)
    }
  })
  favouriteMutationQueue = action
  return action
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
  // The scanner accepts file paths, not foobar handles such as "file|subsong:0".
  const paths = tracks.map(localFilePath).filter(Boolean)
  if (!paths.length) {
    notify('所选项目不包含可扫描的本地音频文件。', 'info')
    return false
  }
  const result = await runAction(() => fb.replaygain.scan(paths, { mode }))
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
  const picked = await pickImageFile('选择封面图片')
  if (!picked) return false
  const bytes = picked.bytes
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
  if (item?.playbackId?.startsWith('work:')) { await settledSkip.schedule(item.playbackId); return }
  settledSkip.cancel()
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
  if (item?.playbackId?.startsWith('work:')) { await playbackWorkspace.remove([item.playbackId]); await refreshWorkspace(); return }
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
  if (item.playbackId?.startsWith('work:')) { await playbackWorkspace.moveNext(item.playbackId); await refreshWorkspace(); return }
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
  if (playbackWorkspace.status.ready) {
    if (!await playbackWorkspace.clear()) return
    if (state.connected) {
      const bridge = playbackWorkspace.bridge()
      const bridgePlaylist = bridge ? (await fb.playlist.getAll()).find((playlist) => playlist.name === bridge.name)?.index : -1
      const queue = await fb.queue.get()
      for (let index = queue.items.length - 1; index >= 0; index--) {
        const item = queue.items[index]
        if (!(bridge && item.playlist === bridgePlaylist && item.playlistItem === bridge.item)) await runAction(() => fb.queue.remove(index))
      }
    }
    await refreshWorkspace(); return
  }
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

function setFullscreen(enabled: boolean): Promise<boolean> {
  if (enabled && (!state.nowPlayingOpen || miniPlayerMode.value)) return Promise.resolve(false)
  if (!fullscreenTask && state.isFullscreen === enabled) return Promise.resolve(true)
  fullscreenRequest = enabled
  fullscreenIntent = enabled
  if (fullscreenTask) return fullscreenTask
  fullscreenTask = (async () => {
    let succeeded = true
    while (fullscreenRequest != null) {
      const target = fullscreenRequest && state.nowPlayingOpen && !miniPlayerMode.value
      fullscreenRequest = null
      if (state.connected) {
        const result = await runAction(() => fb.ui.setFullscreen(target))
        if (result) state.isFullscreen = result.fullscreen ?? target
        else { succeeded = false; fullscreenRequest = null; break }
      } else {
        try {
          if (target && !document.fullscreenElement) await document.documentElement.requestFullscreen()
          if (!target && document.fullscreenElement) await document.exitFullscreen()
          state.isFullscreen = Boolean(document.fullscreenElement)
        } catch { succeeded = false; fullscreenRequest = null; break }
      }
      if (state.isFullscreen && !state.nowPlayingOpen) fullscreenRequest = false
    }
    return succeeded
  })().finally(() => { fullscreenTask = null; fullscreenIntent = null })
  return fullscreenTask
}

function toggleFullscreen() {
  if (!state.nowPlayingOpen || miniPlayerMode.value) return Promise.resolve(false)
  return setFullscreen(!(fullscreenIntent ?? state.isFullscreen))
}

async function toggleFullscreenNowPlaying() {
  if (miniPlayerMode.value) return false
  if (state.nowPlayingOpen && (fullscreenIntent ?? state.isFullscreen)) return closeNowPlaying()
  state.nowPlayingTab = 'lyrics'
  state.nowPlayingOpen = true
  return setFullscreen(true)
}

async function reloadInterface() {
  if (state.connected) await runAction(() => fb.ui.reload())
  else window.location.reload()
}

function toggleNowPlaying(tab = state.nowPlayingTab) {
  state.nowPlayingTab = tab
  if (state.nowPlayingOpen && (fullscreenIntent ?? state.isFullscreen)) void setFullscreen(false)
  else if (state.nowPlayingOpen) void closeNowPlaying()
  else state.nowPlayingOpen = true
}

async function closeNowPlaying() {
  state.nowPlayingOpen = false
  if (state.isFullscreen || fullscreenTask) await setFullscreen(false)
}

function dispose() {
  airplay.dispose()
  settledSkip.cancel()
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
    airplayState: airplay.state,
    retryAirplayArtwork: airplay.artworkFailed,
    routeNavigation,
    routeReady,
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
    browsePlaylist,
    selectAlbum,
    selectArtist,
    getArtistTracks,
    selectLibraryFolder,
    loadFavourites,
    browseFavourites,
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
    playCurrentCollection,
    duplicatePlaylist,
    clearPlaylist,
    removePlaylist,
    undoPlaylistChange,
    reorderPlaylistTrack,
    reorderPlaylists,
    movePlaylistToTop,
    sortPlaylist,
    getOutputDevices,
    setOutputDevice,
    getPluginContextActions,
    runPluginContextAction,
    showNativeTrackProperties,
    runNativePlaylistCleanup,
    sendTracksToIpod,
    sendPlaylistToIpod,
    runIpodMainAction,
    refreshIpodDeviceStatus,
    refreshIpodCommands,
    openIpodManager,
    toggleDesktopLyrics,
    openMiniPlayer,
    miniPlayerMode,
    restoreMainPlayer,
    startWindowDrag,
    toggleWindowMaximize,
    closeWindow,
    shuffleCurrent,
    shufflePlaybackPlan,
    restorePlaybackPlan,
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
    removeTracksFromPlaylist,
    insertTracksIntoPlaylist,
    addTracksToPlaylist,
    playNext,
    removePlaylistTrack,
    showInExplorer,
    showFolderInExplorer,
    openTrackAlbum,
    toggleFavourite,
    setTracksFavourite,
    setAlphabetIndexView,
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
    importExternalPaths,
    setExternalDropHandler,
    removeQueueItem,
    playQueueItem,
    playPlaybackTrack,
    browsePlaybackTrack,
    browsePlaybackPosition,
    beginPlaybackBrowse,
    setPlaybackFocusState,
    moveQueueItemToTop,
    clearQueue,
    refreshLibrary,
    rescanLibrary,
    showPreferences,
    toggleFullscreen,
    setFullscreen,
    toggleFullscreenNowPlaying,
    reloadInterface,
    toggleNowPlaying,
    closeNowPlaying,
    notify,
  }
}
