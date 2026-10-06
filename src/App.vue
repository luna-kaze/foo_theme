<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { AlertCircle, CheckCircle2, FileMusic, Info } from '@lucide/vue'
import AppSidebar from './components/AppSidebar.vue'
import ThemeSettings from './components/ThemeSettings.vue'
import LightFieldSettingsDialog from './components/LightFieldSettingsDialog.vue'
import AboutDialog from './components/AboutDialog.vue'
import { loadLightFieldSettings } from './utils/lightFieldSettings'
import AppTopbar from './components/AppTopbar.vue'
import CreatePlaylistDialog from './components/CreatePlaylistDialog.vue'
import RouteScene from './components/RouteScene.vue'
import MiniPlayer from './components/MiniPlayer.vue'
import NowPlayingPanel from './components/NowPlayingPanel.vue'
import PlayerBar from './components/PlayerBar.vue'
import QueuePopover from './components/QueuePopover.vue'
import TrackInspector from './components/TrackInspector.vue'
import FileOperationDialog from './components/FileOperationDialog.vue'
import TrackActionMenu from './components/TrackActionMenu.vue'
import CoverflowPerformanceDialog from './components/CoverflowPerformanceDialog.vue'
import { routeKey, useFoobar } from './composables/useFoobar'
import fb, { consoleApi, type ArtistInfo, type OutputDevice, type PlaylistInfo } from 'foo-webview-sdk'
import type { AlbumCard, ArtistCard, DisplayTrack, LibraryFolderCard, RouteSceneData, TrackDetails, ViewId } from './types/music'
import { menuIcons, showContextMenu, type ContextMenuItem } from './utils/contextMenu'
import type { NativeMenuNode } from './utils/nativeMenu'
import { createExternalDropSession, externalDropLabel, sidebarDropZone, type ExternalDropTarget } from './utils/externalDrop'
import { isSameTrack, localFilePath, playablePath, trackKey } from './utils/track'
import { createNavigationTransitions } from './utils/navigationTransition'
import { installAutoHideScrollbars } from './utils/autoHideScrollbars'
import { coverflowPerformance, installCoverflowPerformance } from './utils/coverflowPerformance'
import type { CoverflowPerformanceReport } from './utils/coverflowPerformance'
import { groupAlphabetically } from './utils/alphabetIndex'
import { artistPortraitUrl, chooseArtistPhoto, configureArtistProfiles, ensureLocalArtistProfile, loadOnlineArtistProfile, openArtistSource, resetArtistPhoto } from './composables/useArtistProfiles'

const player = useFoobar()
const { state, filteredAlbums, libraryFilterOptions } = player
configureArtistProfiles({ connected: () => state.connected, tracks: () => state.tracks })
const navigationTransitions = createNavigationTransitions()
const miniMode = computed(() => player.miniPlayerMode.value)
watch(miniMode, value => document.body.classList.toggle('mini-window', value), { immediate: true })
const trackMenu = reactive({ open: false, track: null as DisplayTrack | null, tracks: [] as DisplayTrack[], index: -1, x: 0, y: 0 })
const dragState = reactive({ active: false, depth: 0, label: '', rejected: false, left: 0, top: 0, width: 0, height: 0, marker: false, clickUntil: 0 })
let nativeDragFiles = false
let externalHoverTimer: ReturnType<typeof setTimeout> | null = null
let externalHoverIndex = -1
let externalScrollFrame = 0
let externalScrollElement: HTMLElement | null = null
let externalPoint = { x: 0, y: 0 }
let externalScrollDelta = 0
const externalDropSubscriptions: Array<() => void> = []
const externalDrop = createExternalDropSession({
  paths: async sessionId => {
    const result = await fb.dnd.getPathsAsync(sessionId)
    if (result.success === false) throw new Error(typeof result.error === 'string' ? result.error : '无法取得拖放文件路径。')
    if (sessionId && result.sessionId && result.sessionId !== sessionId) throw new Error('拖放会话已变化，请重新拖入文件。')
    return { sessionId: result.sessionId || sessionId || '', paths: Array.isArray(result.paths) ? result.paths.filter((path): path is string => typeof path === 'string' && Boolean(path.trim())) : [] }
  },
  execute: (paths, target) => player.importExternalPaths(paths, target),
  error: error => player.notify(error instanceof Error ? error.message : '拖放导入失败。', 'error'),
})
player.setExternalDropHandler(event => {
  const ratio = window.devicePixelRatio || 1
  const target = externalDropTarget(event.x / ratio, event.y / ratio)
  dragState.clickUntil = Date.now() + 350
  finishExternalDrag()
  void externalDrop.native(event, target)
})
const queueOpen = ref(false)
const coverflowPerformanceReport = ref<CoverflowPerformanceReport | null>(null)
const themeSettingsOpen = ref(false)
const lightSettingsOpen = ref(false)
const aboutOpen = ref(false)
watch(() => state.connected, connected => {
  if (connected) void loadLightFieldSettings(true).catch(error => player.notify(error instanceof Error ? error.message : '无法读取背景参数。', 'error'))
})
const outputDevices = ref<OutputDevice[]>([])
const outputLoading = ref(false)
const connectionLabel = ref('foobar2000')
const connectionTransitioning = ref(false)
const immersiveFullscreenProgress = ref(0)
const immersiveFullscreenTarget = ref(false)
const immersiveShellStyle = computed(() => ({ '--immersive-fullscreen-progress': immersiveFullscreenProgress.value.toFixed(4) }))
let airplayTimer: ReturnType<typeof setTimeout> | null = null
let fullscreenSettleTimer: ReturnType<typeof setTimeout> | null = null
let fullscreenWindowSettled = true
const fullscreenSceneDelayMs = 260
let immersiveFullscreenFrame = 0
let immersiveFullscreenVelocity = 0
let immersiveFullscreenLastFrame = 0
const selectedTracks = ref<DisplayTrack[]>([])
const albumSelectionMode = ref(false)
const selectedAlbumIds = ref<string[]>([])
const folderSelectionMode = ref(false)
const selectedFolderIds = ref<string[]>([])
const inspector = reactive({ open: false, mode: 'properties' as 'properties' | 'edit', tracks: [] as DisplayTrack[], album: null as AlbumCard | null, details: [] as TrackDetails[], loading: false, busy: false, request: 0 })
const fileDialog = reactive({ open: false, mode: 'rename' as 'rename' | 'move' | 'delete', track: null as DisplayTrack | null, target: '', busy: false })
const ipodPlaylistConfirmation = ref<PlaylistInfo | null>(null)
const trackDragRouteKey = ref<string | null>(null)
const trackPlaylistHoverIndex = ref<number | null>(null)
const trackPlaylistHoverPhase = ref<'selected' | 'waiting' | null>(null)
const trackFavouritesHoverPhase = ref<'selected' | 'waiting' | null>(null)
let hoveredFavourites = false
let playlistHoverTimer: ReturnType<typeof setTimeout> | null = null
let playlistHoverWaitTimer: ReturnType<typeof setTimeout> | null = null
let hoveredPlaylistIndex: number | null = null

function animateImmersiveFullscreen(time: number) {
  const target = immersiveFullscreenTarget.value ? 1 : 0
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reducedMotion) {
    immersiveFullscreenProgress.value = target
    immersiveFullscreenVelocity = 0
    immersiveFullscreenFrame = 0
    immersiveFullscreenLastFrame = 0
    return
  }
  const delta = immersiveFullscreenLastFrame ? Math.min(.02, (time - immersiveFullscreenLastFrame) / 1000) : 1 / 60
  immersiveFullscreenLastFrame = time
  const displacement = target - immersiveFullscreenProgress.value
  immersiveFullscreenVelocity += (displacement * 1350 - immersiveFullscreenVelocity * 76) * delta
  immersiveFullscreenProgress.value = Math.min(1, Math.max(0, immersiveFullscreenProgress.value + immersiveFullscreenVelocity * delta))
  if (Math.abs(displacement) < .002 && Math.abs(immersiveFullscreenVelocity) < .012) {
    immersiveFullscreenProgress.value = target
    immersiveFullscreenVelocity = 0
    immersiveFullscreenFrame = 0
    immersiveFullscreenLastFrame = 0
    return
  }
  immersiveFullscreenFrame = requestAnimationFrame(animateImmersiveFullscreen)
}

watch(immersiveFullscreenTarget, () => {
  if (!immersiveFullscreenFrame) immersiveFullscreenFrame = requestAnimationFrame(animateImmersiveFullscreen)
})

function commitImmersiveFullscreenTarget() {
  fullscreenWindowSettled = true
  immersiveFullscreenTarget.value = state.isFullscreen && state.nowPlayingOpen
}

function scheduleFullscreenSettle() {
  if (fullscreenSettleTimer) clearTimeout(fullscreenSettleTimer)
  fullscreenSettleTimer = setTimeout(commitImmersiveFullscreenTarget, 180 + fullscreenSceneDelayMs)
}

function onFullscreenWindowResize() {
  if (!fullscreenWindowSettled) scheduleFullscreenSettle()
}

watch(() => state.isFullscreen, () => {
  if (state.isFullscreen && !state.nowPlayingOpen) void player.setFullscreen(false)
  fullscreenWindowSettled = false
  scheduleFullscreenSettle()
})

watch(() => state.nowPlayingOpen, () => {
  if (fullscreenWindowSettled) commitImmersiveFullscreenTarget()
})

function captureScene(): RouteSceneData {
  const search = state.route.view === 'search' ? state.route.query : state.search
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return {
    key: routeKey(state.route), cacheKey: state.route.view === 'search' ? 'search' : routeKey(state.route),
    route: { ...state.route }, albums: filteredAlbums.value,
    tracks: state.visibleTracks, artists: state.artists, folders: state.libraryFolders, stats: state.libraryStats,
    selectedAlbum: state.selectedAlbum, activePlaylist: state.browsingPlaylist ?? state.activePlaylist,
    search,
    searchArtists: state.route.view === 'search' && terms.length ? state.artists.filter((artist) => terms.every((term) => artist.name.toLocaleLowerCase().includes(term))) : [],
    loading: state.loading, searchLoading: state.searchLoading,
  }
}

const displayedScene = shallowRef(captureScene())
const sceneScrollPositions = new Map<string, number>()
const sceneWaiters = new Set<() => void>()
const sceneAnimationEnabled = ref(false)
const sceneSwitching = ref(false)
const scenePreparedGeneration = ref(0)
let requestedSceneTransition: { key: string; generation: number; animate: boolean } | null = null
const scenePending = computed(() => (player.routeNavigation.value?.generation ?? 0) > scenePreparedGeneration.value)
const sceneControls = computed(() => ({
  ipod: {
    connected: state.connected, installed: player.pluginIntegrations.dop.installed, version: player.pluginIntegrations.dop.version,
    status: player.ipodDevice.status, probing: player.ipodDevice.probing, availableActions: player.ipodCommands, playlists: state.playlists,
  },
  media: {
    currentTrack: state.currentTrack, isPlaying: state.isPlaying, folderSelectionMode: folderSelectionMode.value,
    selectedFolderIds: selectedFolderIds.value, alphabetIndexView: state.alphabetIndexView, dragActive: trackDragRouteKey.value !== null,
  },
  library: {
    currentTrack: state.currentTrack, isPlaying: state.isPlaying, importing: state.importing,
    libraryFilters: state.libraryFilters, filterOptions: libraryFilterOptions.value, customColumn: state.customColumn,
    albumSelectionMode: albumSelectionMode.value, selectedAlbumIds: selectedAlbumIds.value,
    alphabetIndexView: state.alphabetIndexView, dragActive: trackDragRouteKey.value !== null,
    searchBusy: state.searchLoading,
  },
}))

function saveSceneScroll() {
  const viewport = document.querySelector<HTMLElement>('.workspace-scroll')
  const key = viewport?.querySelector<HTMLElement>('.route-scene')?.dataset.routeKey
  if (viewport && key) sceneScrollPositions.set(key, viewport.scrollTop)
}

function enterScene() {
  const viewport = document.querySelector<HTMLElement>('.workspace-scroll')
  if (viewport) viewport.scrollTop = navigationTransitions.direction === 'enter' ? 0
    : navigationTransitions.direction === 'return' && navigationTransitions.originKey === displayedScene.value.key ? navigationTransitions.originScrollTop
    : sceneScrollPositions.get(displayedScene.value.key) ?? 0
}

function finishSceneLeave() {
  if (!sceneAnimationEnabled.value) sceneSwitching.value = false
}

function waitForScene(key: string) {
  return new Promise<void>((resolve) => {
    let settled = false
    let stop: () => void = () => {}
    const finish = () => {
      if (settled) return
      settled = true
      stop()
      sceneWaiters.delete(finish)
      resolve()
    }
    const inspect = async () => {
      if (routeKey(state.route) !== key) { finish(); return }
      if (displayedScene.value.key !== key || scenePending.value || sceneSwitching.value) return
      await nextTick()
      if (routeKey(state.route) !== key || document.querySelector<HTMLElement>('.workspace-scroll .route-scene')?.dataset.routeKey === key) finish()
    }
    sceneWaiters.add(finish)
    stop = watch([displayedScene, scenePending, sceneSwitching, () => state.route], inspect, { flush: 'post' })
    void inspect()
  })
}

watch(player.routeNavigation, (navigation) => {
  if (!navigation) return
  saveSceneScroll()
  if (navigationTransitions.targetKey && navigationTransitions.targetKey !== routeKey(navigation.to)) navigationTransitions.cancelAlbum()
  // Save the intent at request time. A same-route refresh can finish loading
  // with a newer generation without becoming a new visual navigation.
  requestedSceneTransition = {
    key: routeKey(navigation.to), generation: navigation.generation,
    animate: Boolean(navigation.animate && !trackDragRouteKey.value && !dragState.active && !navigationTransitions.targetKey),
  }
}, { flush: 'sync' })

watch(player.routeReady, async (ready) => {
  if (!ready || routeKey(ready.route) !== routeKey(state.route)) return
  const next = captureScene()
  if (next.route.view === 'albums') await groupAlphabetically(next.albums, (album) => album.name, (album) => album.sortName ?? '')
  if (next.route.view === 'artists') await groupAlphabetically(next.artists, (artist) => artist.name, (artist) => artist.sortName ?? '')
  if (player.routeReady.value !== ready || routeKey(state.route) !== next.key) return
  if (displayedScene.value.cacheKey !== next.cacheKey) {
    const requested = requestedSceneTransition
    sceneAnimationEnabled.value = Boolean(requested?.key === next.key && requested.generation <= ready.generation && requested.animate)
  }
  if (displayedScene.value.key !== next.key) selectedTracks.value = []
  displayedScene.value = next
  scenePreparedGeneration.value = ready.generation
}, { flush: 'sync' })

watch(() => [state.loading, state.searchLoading, state.visibleTracks, filteredAlbums.value, state.artists, state.libraryFolders, state.libraryStats, state.selectedAlbum, state.browsingPlaylist, sceneSwitching.value], () => {
  if (!scenePending.value && !sceneSwitching.value && displayedScene.value.key === routeKey(state.route)) displayedScene.value = captureScene()
}, { flush: 'post' })

function handleTrackDragState(active: boolean) {
  if (active) {
    trackDragRouteKey.value = 'active'
    return
  }
  if (playlistHoverTimer) clearTimeout(playlistHoverTimer)
  if (playlistHoverWaitTimer) clearTimeout(playlistHoverWaitTimer)
  playlistHoverTimer = null
  playlistHoverWaitTimer = null
  hoveredPlaylistIndex = null
  trackPlaylistHoverIndex.value = null
  trackPlaylistHoverPhase.value = null
  trackFavouritesHoverPhase.value = null
  hoveredFavourites = false
  trackDragRouteKey.value = null
}

function handleTrackPlaylistHover(playlistIndex: number | null) {
  if (hoveredPlaylistIndex === playlistIndex) return
  if (playlistHoverTimer) clearTimeout(playlistHoverTimer)
  if (playlistHoverWaitTimer) clearTimeout(playlistHoverWaitTimer)
  playlistHoverTimer = null
  playlistHoverWaitTimer = null
  hoveredPlaylistIndex = playlistIndex
  trackPlaylistHoverIndex.value = playlistIndex
  trackPlaylistHoverPhase.value = playlistIndex == null ? null : 'selected'
  if (playlistIndex == null || state.route.view === 'playlist' && state.route.playlistIndex === playlistIndex) return
  playlistHoverWaitTimer = setTimeout(() => {
    playlistHoverWaitTimer = null
    if (hoveredPlaylistIndex !== playlistIndex) return
    trackPlaylistHoverPhase.value = 'waiting'
    playlistHoverTimer = setTimeout(() => {
      playlistHoverTimer = null
      if (hoveredPlaylistIndex === playlistIndex) {
        window.dispatchEvent(new Event('foo-theme:track-drag-route-change'))
        void player.browsePlaylist(playlistIndex)
      }
    }, 450)
  }, 250)
}

function handleTrackFavouritesHover(hovering: boolean) {
  if (hoveredFavourites === hovering) return
  if (playlistHoverTimer) clearTimeout(playlistHoverTimer)
  if (playlistHoverWaitTimer) clearTimeout(playlistHoverWaitTimer)
  playlistHoverTimer = null
  playlistHoverWaitTimer = null
  hoveredFavourites = hovering
  trackFavouritesHoverPhase.value = hovering ? 'selected' : null
  if (!hovering || state.route.view === 'favourites') return
  playlistHoverWaitTimer = setTimeout(() => {
    playlistHoverWaitTimer = null
    if (!hoveredFavourites) return
    trackFavouritesHoverPhase.value = 'waiting'
    playlistHoverTimer = setTimeout(() => {
      playlistHoverTimer = null
      if (!hoveredFavourites) return
      window.dispatchEvent(new Event('foo-theme:track-drag-route-change'))
      void player.browseFavourites()
    }, 450)
  }, 250)
}


watch(() => state.currentTrack?.path ?? '', (path, previous) => {
  const active = path.toLocaleLowerCase().startsWith('airplay://live/')
  const wasActive = previous.toLocaleLowerCase().startsWith('airplay://live/')
  if (active === wasActive) return
  if (airplayTimer) clearTimeout(airplayTimer)
  connectionTransitioning.value = true
  connectionLabel.value = active ? '正在连接 AirPlay…' : 'AirPlay 已断开'
  airplayTimer = setTimeout(() => {
    connectionTransitioning.value = false
    connectionLabel.value = active ? 'AirPlay' : 'foobar2000'
  }, 1000)
})

watch(() => state.view, (view) => {
  if (view !== 'albums') cancelAlbumSelection()
  if (view !== 'folders' && view !== 'folder') cancelFolderSelection()
  if (view === 'ipod') {
    void player.refreshIpodCommands()
    void player.refreshIpodDeviceStatus()
  }
})

function setAlbumSelection(album: AlbumCard, selected: boolean) {
  const ids = new Set(selectedAlbumIds.value)
  if (selected) ids.add(album.id)
  else ids.delete(album.id)
  selectedAlbumIds.value = [...ids]
}

function cancelAlbumSelection() {
  albumSelectionMode.value = false
  selectedAlbumIds.value = []
}

function folderId(folder: LibraryFolderCard) {
  return `${folder.rootId}\u0000${folder.pathId}`
}

function setFolderSelection(folder: LibraryFolderCard, selected: boolean) {
  const ids = new Set(selectedFolderIds.value)
  if (selected) ids.add(folderId(folder))
  else ids.delete(folderId(folder))
  selectedFolderIds.value = [...ids]
}

function cancelFolderSelection() {
  folderSelectionMode.value = false
  selectedFolderIds.value = []
}

async function getFolderSelectionTracks(folders: LibraryFolderCard[]) {
  const groups = await Promise.all(folders.map((folder) => player.getFolderTracks(folder)))
  const unique = new Map<string, DisplayTrack>()
  groups.flat().forEach((track) => unique.set(trackKey(track), track))
  return [...unique.values()]
}

async function getAlbumSelectionTracks(albums: AlbumCard[]) {
  const groups = await Promise.all(albums.map((album) => player.getAlbumTracks(album)))
  const unique = new Map<string, DisplayTrack>()
  groups.flat().forEach((track) => unique.set(trackKey(track), track))
  return [...unique.values()]
}

function sortAlbumTracks(tracks: DisplayTrack[]) {
  return [...tracks].sort((left, right) =>
    Number(left.discNumber || 1) - Number(right.discNumber || 1)
    || Number(left.trackNumber || 0) - Number(right.trackNumber || 0)
    || left.title.localeCompare(right.title),
  )
}

async function openInspector(mode: 'properties' | 'edit', tracks: DisplayTrack[], album: AlbumCard | null = null) {
  const request = ++inspector.request
  inspector.open = true
  inspector.mode = mode
  inspector.tracks = tracks
  inspector.album = album
  inspector.details = []
  inspector.loading = true
  try {
    const details = await player.getTrackDetails(tracks)
    if (request === inspector.request) inspector.details = details
  } catch (error) {
    if (request === inspector.request) player.notify(error instanceof Error ? error.message : '无法读取曲目属性。', 'error')
  } finally {
    if (request === inspector.request) inspector.loading = false
  }
}

async function saveInspectorMetadata(tags: Record<string, string>) {
  inspector.busy = true
  try {
    if (await player.writeTrackMetadata(inspector.tracks, tags)) inspector.open = false
  } finally { inspector.busy = false }
}

async function setInspectorRating(rating: number) {
  if (await player.setTracksRating(inspector.tracks, rating)) inspector.details.forEach((detail) => { detail.rating = rating })
}

async function scanInspectorReplayGain(mode: 'track' | 'album') {
  inspector.busy = true
  try { if (await player.scanReplayGain(inspector.tracks, mode)) inspector.details = await player.getTrackDetails(inspector.tracks) } finally { inspector.busy = false }
}

async function clearInspectorReplayGain() {
  inspector.busy = true
  try { if (await player.clearReplayGain(inspector.tracks)) inspector.details = await player.getTrackDetails(inspector.tracks) } finally { inspector.busy = false }
}

async function embedInspectorArtwork(type: 'front' | 'back' | 'disc' | 'artist') {
  const track = inspector.tracks[0]
  if (!track) return
  inspector.busy = true
  try { if (await player.embedTrackArtwork(track, type)) inspector.details = await player.getTrackDetails(inspector.tracks) } finally { inspector.busy = false }
}

async function removeInspectorArtwork(type: 'front' | 'back' | 'disc' | 'artist') {
  const track = inspector.tracks[0]
  if (!track) return
  inspector.busy = true
  try { await player.removeTrackArtwork(track, type) } finally { inspector.busy = false }
}

function openFileDialog(mode: 'rename' | 'move' | 'delete', track: DisplayTrack, target = '') {
  fileDialog.open = true
  fileDialog.mode = mode
  fileDialog.track = track
  fileDialog.target = target
}

async function renameFile(name: string) {
  if (!fileDialog.track) return
  fileDialog.busy = true
  try { if (await player.renameTrackFile(fileDialog.track, name)) fileDialog.open = false } finally { fileDialog.busy = false }
}

async function deleteFile() {
  if (!fileDialog.track) return
  fileDialog.busy = true
  try { if (await player.deleteTrackFile(fileDialog.track)) fileDialog.open = false } finally { fileDialog.busy = false }
}

async function moveFile(track: DisplayTrack) {
  const folder = await player.chooseMoveFolder()
  if (folder) openFileDialog('move', track, folder)
}

async function confirmMoveFile() {
  if (!fileDialog.track || !fileDialog.target) return
  fileDialog.busy = true
  try { if (await player.moveTrackFile(fileDialog.track, fileDialog.target)) fileDialog.open = false } finally { fileDialog.busy = false }
}

async function createPlaylistFromDialog(name: string, options?: { query: string; sort: string; keepSorted: boolean }) {
  if (options) await player.createAutoPlaylist(name, options.query, options.sort, options.keepSorted)
  else await player.createPlaylist(name)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'F1') {
    event.preventDefault(); event.stopImmediatePropagation()
    if (!event.repeat) aboutOpen.value = !aboutOpen.value
    return
  }
  if (event.key === 'Escape' && aboutOpen.value) {
    event.preventDefault(); event.stopImmediatePropagation(); aboutOpen.value = false; return
  }
  if (event.ctrlKey && event.altKey && event.code === 'KeyB') {
    event.preventDefault(); event.stopImmediatePropagation()
    if (!event.repeat && !miniMode.value) lightSettingsOpen.value = !lightSettingsOpen.value
    return
  }
  if (event.key === 'Escape' && lightSettingsOpen.value) {
    event.preventDefault(); event.stopImmediatePropagation(); lightSettingsOpen.value = false; return
  }
  if (event.key === 'Escape' && (event.target as HTMLElement | null)?.closest?.('.artist-match-panel')) return
  if (event.key === 'Escape' && (event.target as HTMLElement | null)?.closest?.('.image-picker-dialog')) return
  if (event.ctrlKey && event.altKey && event.code === 'KeyP' && !event.repeat) {
    event.preventDefault()
    if (coverflowPerformance.active) {
      const report = coverflowPerformance.stop()
      console.log('[Coverflow performance]', report)
      if (state.connected) void consoleApi.log(`[Coverflow performance] ${JSON.stringify(report)}`).catch(() => {})
      coverflowPerformanceReport.value = report
      player.notify('性能采样已结束，报告已在主题中打开。', 'success')
    } else { coverflowPerformance.start(); player.notify('性能采样已开始，再按 Ctrl+Alt+P 结束。', 'info') }
    return
  }
  const target = event.target as HTMLElement | null
  const interactive = target?.closest('button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="slider"]')

  if (event.ctrlKey && event.key.toLocaleLowerCase() === 'k') {
    event.preventDefault()
    document.querySelector<HTMLInputElement>('.topbar-search input')?.focus()
    return
  }
  if (event.key === 'F11') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (state.nowPlayingOpen && !miniMode.value && !event.repeat) void player.toggleFullscreen()
    return
  }
  if (event.key === 'Escape') {
    if (coverflowPerformanceReport.value) { coverflowPerformanceReport.value = null; return }
    player.closeNowPlaying()
    state.dialog = null
    inspector.open = false
    trackMenu.open = false
    queueOpen.value = false
    return
  }
  if (event.key === 'MediaPlayPause') { void player.togglePlayback(); return }
  if (event.key === 'MediaTrackNext') { void player.next(); return }
  if (event.key === 'MediaTrackPrevious') { void player.previous(); return }
  if (event.defaultPrevented || interactive) return
  if (event.code === 'Space' && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault()
    void player.togglePlayback()
  }
}

let disposeScrollbars: (() => void) | undefined
let disposePerformance: (() => void) | undefined
onMounted(() => {
  void loadLightFieldSettings(false)
  disposePerformance = installCoverflowPerformance()
  disposeScrollbars = installAutoHideScrollbars()
  void player.initialize()
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('resize', onFullscreenWindowResize)
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
  externalDropSubscriptions.push(
    fb.on('dnd:enter', event => { nativeDragFiles = event.hasFiles; externalDrop.begin(event.sessionId); if (event.hasFiles && state.dndSupported) dragState.active = true }),
    fb.on('dnd:leave', () => finishExternalDrag()),
  )
})

onBeforeUnmount(() => {
  finishExternalDrag(); externalDrop.dispose(); player.setExternalDropHandler(null)
  externalDropSubscriptions.forEach(unsubscribe => unsubscribe())
  disposePerformance?.()
  disposeScrollbars?.()
  sceneWaiters.forEach((finish) => finish())
  navigationTransitions.cancel()
  document.body.classList.remove('mini-window')
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', onFullscreenWindowResize)
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
  player.dispose()
  if (airplayTimer) clearTimeout(airplayTimer)
  if (fullscreenSettleTimer) clearTimeout(fullscreenSettleTimer)
  if (playlistHoverTimer) clearTimeout(playlistHoverTimer)
  if (playlistHoverWaitTimer) clearTimeout(playlistHoverWaitTimer)
  if (immersiveFullscreenFrame) cancelAnimationFrame(immersiveFullscreenFrame)
})

function openNowPlaying() {
  if (Date.now() < dragState.clickUntil) return
  queueOpen.value = false
  player.toggleNowPlaying('lyrics')
}

function openFullscreenNowPlaying() {
  if (Date.now() < dragState.clickUntil) return
  queueOpen.value = false
  void player.toggleFullscreenNowPlaying()
}

function toggleQueue() {
  queueOpen.value = !queueOpen.value
  trackMenu.open = false
}

function closeSecondaryUi() {
  themeSettingsOpen.value = false
  void player.closeNowPlaying()
  state.dialog = null
  trackMenu.open = false
  queueOpen.value = false
}

function openThemeSettings() {
  closeSecondaryUi()
  themeSettingsOpen.value = true
}

function navigatePrimary(view: ViewId) {
  closeSecondaryUi()
  void player.setView(view)
}

function selectPrimaryPlaylist(index: number) {
  closeSecondaryUi()
  void player.selectActivePlaylist(index)
}

function showFavourites() {
  closeSecondaryUi()
  void player.loadFavourites()
}

function goBackPrimary() {
  closeSecondaryUi()
  const originKey = navigationTransitions.originKey
  if (state.route.view === 'album' && originKey && navigationTransitions.originAlbumId === state.selectedAlbum?.id) {
    void navigationTransitions.returnAlbum(async () => {
      await player.goBack()
      await waitForScene(originKey)
    }, () => routeKey(state.route) === originKey)
  } else void player.goBack()
}

function goForwardPrimary() {
  closeSecondaryUi()
  void player.goForward()
}

function submitPrimarySearch() {
  closeSecondaryUi()
  void player.submitSearch()
}

function clearPrimarySearch() {
  closeSecondaryUi()
  void player.clearSearch()
}

function openPrimaryAlbum(album: AlbumCard) {
  if (state.view === 'albums' && albumSelectionMode.value) {
    setAlbumSelection(album, !selectedAlbumIds.value.includes(album.id))
    return
  }
  void enterAlbum(album)
}

async function enterAlbum(album: AlbumCard) {
  closeSecondaryUi()
  const targetKey = routeKey({ view: 'album', albumName: album.name, albumArtist: album.artist })
  await navigationTransitions.openAlbum(album.id, targetKey, displayedScene.value.key, async () => {
    await player.selectAlbum(album)
    await waitForScene(targetKey)
  }, () =>
    state.route.view === 'album' && state.route.albumName === album.name && state.route.albumArtist === album.artist,
  )
}

async function loadOutputDevices() {
  outputLoading.value = true
  try {
    outputDevices.value = await player.getOutputDevices()
  } finally {
    outputLoading.value = false
  }
}

async function selectOutputDevice(device: OutputDevice) {
  await player.setOutputDevice(device.outputId, device.deviceId, device.name)
  await loadOutputDevices()
}

function requestPlaylistIpodTransfer(playlistIndex: number) {
  ipodPlaylistConfirmation.value = state.playlists.find((playlist) => playlist.index === playlistIndex) ?? null
}

async function confirmPlaylistIpodTransfer() {
  const playlist = ipodPlaylistConfirmation.value
  if (!playlist) return
  ipodPlaylistConfirmation.value = null
  await player.sendPlaylistToIpod(playlist.index)
}

function playlistSubmenu(prefix: string): ContextMenuItem[] {
  return state.playlists.map((playlist) => ({
    id: `${prefix}:${playlist.index}`,
    label: playlist.name,
    enabled: !playlist.isLocked && !playlist.isAutoplaylist,
  }))
}

function movePlaylistSubmenu(sourcePlaylistIndex: number): ContextMenuItem[] {
  return state.playlists
    .filter((playlist) => playlist.index !== sourcePlaylistIndex)
    .map((playlist) => ({ id: `track:move-playlist:${playlist.index}`, label: playlist.name, enabled: !playlist.isLocked && !playlist.isAutoplaylist }))
}

function pluginSubmenu(prefix: string, actions: Array<{ label: string }>): ContextMenuItem[] {
  return actions.map((action, index) => ({ id: `${prefix}:${index}`, label: action.label }))
}

function nativeToolsSubmenu(items: NativeMenuNode[]): ContextMenuItem[] {
  return items.flatMap((item): ContextMenuItem[] => {
    if (item.type === 'separator') return [{ type: 'separator' }]
    const label = (item.displayLabel || item.label || '').replaceAll('&', '')
    if (item.type === 'submenu') return [{ label, submenu: nativeToolsSubmenu(item.children ?? []) }]
    if (item.type !== 'command') return []
    return [{ id: `track:tools:${item.commandId}`, label, enabled: item.enabled !== false && item.commandId != null }]
  })
}

function pluginMenuItem(prefix: string, label: string, actions: Array<{ label: string }>, installed: boolean, iconSvg: ContextMenuItem['iconSvg']): ContextMenuItem | null {
  if (actions.length) return { id: prefix, label, iconSvg, submenu: pluginSubmenu(prefix, actions) }
  if (installed) return { id: prefix, label: `${label}（当前项目不可用）`, iconSvg, enabled: false }
  return null
}

async function runSelectedPluginAction(action: string, prefix: string, actions: Array<{ commandId: number; label: string }>, tracks: DisplayTrack[]) {
  if (!action.startsWith(`${prefix}:`)) return false
  const command = actions[Number(action.slice(prefix.length + 1))]
  if (command) await player.runPluginContextAction(command, tracks)
  return true
}

async function openPopup(items: ContextMenuItem[], event: MouseEvent) {
  try {
    return await showContextMenu(items, event)
  } catch (error) {
    player.notify(error instanceof Error ? error.message : '无法打开右键菜单。', 'error')
    return null
  }
}

async function loadMenuCover(track?: DisplayTrack, fallback = '') {
  if (/^(?:data:image\/|https?:\/\/)/i.test(fallback)) return fallback
  const path = track ? playablePath(track) : ''
  if (!state.connected || !path) return ''
  try {
    const artwork = await fb.artwork.getByPath(path, 'front')
    return artwork.available ? artwork.dataUrl ?? '' : ''
  } catch {
    return ''
  }
}

async function openTrackMenu(track: DisplayTrack, index: number, event: MouseEvent) {
  const targets = selectedTracks.value.some((item) => isSameTrack(item, track)) ? selectedTracks.value : [track]
  if (state.connected) {
    trackMenu.open = false
    try {
      const [pluginActions, cover] = await Promise.all([
        player.getPluginContextActions(targets),
        loadMenuCover(track, track.artworkUrl),
      ])
      const pluginItems: ContextMenuItem[] = []
      const converterItem = pluginMenuItem('track:converter', '转换', pluginActions.converter, player.pluginIntegrations.converter.installed, menuIcons.convert)
      const dopItem = pluginMenuItem('track:dop', 'iPod', pluginActions.dop, player.pluginIntegrations.dop.installed, menuIcons.device)
      if (converterItem) pluginItems.push(converterItem)
      if (dopItem) pluginItems.push(dopItem)
      pluginItems.push({ id: 'track:tools', label: '工具', iconSvg: menuIcons.settings, enabled: pluginActions.tools.length > 0, submenu: nativeToolsSubmenu(pluginActions.tools) })
      const sourcePlaylist = state.view === 'playlist' && index >= 0 ? state.browsingPlaylist ?? state.activePlaylist : null
      const isBatch = targets.length > 1
      const singleItems: ContextMenuItem[] = [
        { id: 'track:header', type: 'nowplaying', cover, title: targets.length > 1 ? `已选择 ${targets.length} 首曲目` : track.title, subtitle: targets.length > 1 ? '批量操作' : `${track.artist} · ${track.album}` },
        { type: 'separator' },
        { id: 'track:play', label: '立即播放', iconSvg: menuIcons.play },
        { id: 'track:next', label: '下一首播放', iconSvg: menuIcons.next },
        { id: 'track:queue', label: targets.length > 1 ? `将 ${targets.length} 首曲目添加到队列` : '添加到队列', iconSvg: menuIcons.queue },
        { type: 'separator' },
        { id: 'track:favourite', label: track.isFavourite ? '取消收藏' : '添加到收藏', checked: track.isFavourite, iconSvg: menuIcons.heart },
        { id: 'track:playlist', label: targets.length > 1 ? `将 ${targets.length} 首曲目添加到播放列表` : '添加到播放列表', iconSvg: menuIcons.playlist, enabled: state.playlists.length > 0, submenu: playlistSubmenu('track:playlist') },
        ...(sourcePlaylist ? [{ id: 'track:move-playlist', label: targets.length > 1 ? `将 ${targets.length} 首曲目移动到播放列表` : '移动到播放列表', iconSvg: menuIcons.move, enabled: !sourcePlaylist.isLocked && !sourcePlaylist.isAutoplaylist, submenu: movePlaylistSubmenu(sourcePlaylist.index) } as ContextMenuItem] : []),
        ...(pluginItems.length ? [{ type: 'separator' } as ContextMenuItem, ...pluginItems] : []),
        { type: 'separator' },
        { id: 'track:album', label: '前往专辑', iconSvg: menuIcons.album },
        { id: 'track:location', label: '显示文件位置', iconSvg: menuIcons.folder, enabled: Boolean(track.path) },
        { type: 'separator' },
        { id: 'track:properties', label: '属性', iconSvg: menuIcons.info },
        { id: 'track:edit', label: '编辑标签', iconSvg: menuIcons.edit },
        { id: 'track:rename', label: '重命名文件', iconSvg: menuIcons.edit, enabled: Boolean(localFilePath(track)) },
        { id: 'track:move', label: '移动文件', iconSvg: menuIcons.folder, enabled: Boolean(localFilePath(track)) },
        { id: 'track:delete-file', label: '移动文件到回收站', iconSvg: menuIcons.remove, enabled: Boolean(localFilePath(track)) },
      ]
      const items: ContextMenuItem[] = isBatch
        ? [
            { id: 'track:header', type: 'nowplaying', cover, title: `已选择 ${targets.length} 首曲目`, subtitle: '批量操作' },
            { type: 'separator' },
            { id: 'track:queue', label: `将 ${targets.length} 首曲目添加到队列`, iconSvg: menuIcons.queue },
            { id: 'track:playlist', label: `将 ${targets.length} 首曲目添加到播放列表`, iconSvg: menuIcons.playlist, enabled: state.playlists.length > 0, submenu: playlistSubmenu('track:playlist') },
            ...(sourcePlaylist ? [{ id: 'track:move-playlist', label: `将 ${targets.length} 首曲目移动到播放列表`, iconSvg: menuIcons.move, enabled: !sourcePlaylist.isLocked && !sourcePlaylist.isAutoplaylist, submenu: movePlaylistSubmenu(sourcePlaylist.index) } as ContextMenuItem] : []),
            ...(pluginItems.length ? [{ type: 'separator' } as ContextMenuItem, ...pluginItems] : []),
            { type: 'separator' },
            { id: 'track:properties', label: `查看 ${targets.length} 首曲目属性`, iconSvg: menuIcons.info },
            { id: 'track:edit', label: `编辑 ${targets.length} 首曲目标签`, iconSvg: menuIcons.edit },
          ]
        : singleItems
       if (sourcePlaylist) {
         items.push(
           { type: 'separator' },
            { id: 'track:remove', label: targets.length > 1 ? `从“${sourcePlaylist?.name ?? '播放列表'}”移除 ${targets.length} 首曲目` : `从“${sourcePlaylist?.name ?? '播放列表'}”移除`, iconSvg: menuIcons.remove },
         )
      }
      const action = await openPopup(items, event)
      if (!action) return
      if (action === 'track:play') await handlePlayTrack(track, index)
      if (action === 'track:next') await player.playNext(track)
      if (action === 'track:queue') await player.addTracksToQueue(targets)
      if (action === 'track:favourite') await player.toggleFavourite(track)
      if (action === 'track:album') await player.openTrackAlbum(track)
      if (action === 'track:location') await player.showInExplorer(track)
      if (action === 'track:properties') await openInspector('properties', targets)
      if (action === 'track:edit') await openInspector('edit', targets)
      if (action.startsWith('track:tools:')) await player.runPluginContextAction({ commandId: Number(action.split(':').at(-1)), label: '原生工具' }, targets)
      if (action === 'track:rename') openFileDialog('rename', track)
      if (action === 'track:move') await moveFile(track)
      if (action === 'track:delete-file') openFileDialog('delete', track)
        if (action === 'track:remove' && sourcePlaylist) await player.removeTracksFromPlaylist(targets, sourcePlaylist.index)
       if (action.startsWith('track:playlist:')) await player.addTracksToPlaylist(targets, Number(action.split(':').at(-1)))
       if (action.startsWith('track:move-playlist:')) {
         const source = state.browsingPlaylist ?? state.activePlaylist
         if (source) await player.moveTracksToPlaylist(targets, source.index, Number(action.split(':').at(-1)))
       }
      if (await runSelectedPluginAction(action, 'track:converter', pluginActions.converter, targets)) return
      await runSelectedPluginAction(action, 'track:dop', pluginActions.dop, targets)
    } catch (error) {
      player.notify(error instanceof Error ? error.message : '无法打开右键菜单。', 'error')
    }
    return
  }

  const target = event.currentTarget as HTMLElement | null
  const rect = target?.getBoundingClientRect()
  trackMenu.track = track
  trackMenu.tracks = targets
  trackMenu.index = index
  trackMenu.x = event.clientX || rect?.right || 20
  trackMenu.y = event.clientY || rect?.bottom || 20
  trackMenu.open = true
}

async function openAlbumMenu(album: AlbumCard, event: MouseEvent) {
  event.preventDefault()
  if (!state.connected) {
    await enterAlbum(album)
    return
  }
  if (albumSelectionMode.value && !selectedAlbumIds.value.includes(album.id)) setAlbumSelection(album, true)
  const targets = albumSelectionMode.value
    ? state.albums.filter((item) => selectedAlbumIds.value.includes(item.id))
    : [album]
  const multiple = targets.length > 1
  const albumTracks = await getAlbumSelectionTracks(targets)
  const cover = await loadMenuCover(albumTracks[0], album.artworkUrl)
  const freedbTracks = targets.length === 1 ? sortAlbumTracks(albumTracks) : []
  const pluginActions = await player.getPluginContextActions(albumTracks)
  const pluginItems: ContextMenuItem[] = []
  const converterItem = pluginMenuItem('album:converter', '转换', pluginActions.converter, player.pluginIntegrations.converter.installed, menuIcons.convert)
  const freedbItem = freedbTracks.length ? pluginMenuItem('album:freedb', '获取专辑信息', pluginActions.freedb, player.pluginIntegrations.freedb.installed, menuIcons.tag) : null
  const dopItem = pluginMenuItem('album:dop', 'iPod', pluginActions.dop, player.pluginIntegrations.dop.installed, menuIcons.device)
  if (converterItem) pluginItems.push(converterItem)
  if (freedbItem) pluginItems.push(freedbItem)
  if (dopItem) pluginItems.push(dopItem)
  const action = await openPopup([
    { id: 'album:header', type: 'nowplaying', cover, title: multiple ? `已选择 ${targets.length} 张专辑` : album.name, subtitle: multiple ? '批量专辑操作' : `${album.artist}${album.year ? ` · ${album.year}` : ''}` },
    { type: 'separator' },
    ...(state.view === 'albums' ? [{ id: 'album:select', label: albumSelectionMode.value ? '退出专辑选择' : '选择专辑', iconSvg: menuIcons.info }] : []),
    { id: 'album:open', label: '打开专辑', iconSvg: menuIcons.album, enabled: !multiple },
    { id: 'album:play', label: '播放专辑', iconSvg: menuIcons.play, enabled: !multiple },
    { id: 'album:shuffle', label: '随机播放专辑', iconSvg: menuIcons.shuffle, enabled: !multiple },
    { id: 'album:queue', label: multiple ? `将 ${targets.length} 张专辑添加到队列` : '将专辑添加到队列', iconSvg: menuIcons.queue },
    { type: 'separator' },
    { id: 'album:playlist', label: multiple ? `将 ${targets.length} 张专辑添加到播放列表` : '将专辑添加到播放列表', iconSvg: menuIcons.playlist, enabled: state.playlists.length > 0, submenu: playlistSubmenu('album:playlist') },
    ...(pluginItems.length ? [{ type: 'separator' } as ContextMenuItem, ...pluginItems] : []),
    { type: 'separator' },
    { id: 'album:properties', label: '专辑属性', iconSvg: menuIcons.info },
  ], event)
  if (action === 'album:select') {
    if (albumSelectionMode.value) cancelAlbumSelection()
    else {
      albumSelectionMode.value = true
      selectedAlbumIds.value = [album.id]
    }
  }
  if (action === 'album:open') await enterAlbum(album)
  if (action === 'album:play') await player.playAlbum(album)
  if (action === 'album:shuffle') await player.shuffleAlbum(album)
  if (action === 'album:queue') {
    if (multiple) await player.addTracksToQueue(albumTracks)
    else await player.queueAlbum(album)
  }
  if (action === 'album:properties') await openInspector('properties', albumTracks, multiple ? null : album)
  if (action?.startsWith('album:playlist:')) {
    const playlistIndex = Number(action.split(':').at(-1))
    if (multiple) await player.addTracksToPlaylist(await getAlbumSelectionTracks(targets), playlistIndex)
    else await player.addAlbumToPlaylist(album, playlistIndex)
  }
  if (action && await runSelectedPluginAction(action, 'album:converter', pluginActions.converter, albumTracks)) return
  if (action && await runSelectedPluginAction(action, 'album:freedb', pluginActions.freedb, freedbTracks)) return
  if (action) await runSelectedPluginAction(action, 'album:dop', pluginActions.dop, albumTracks)
}

async function openArtistMenu(artist: ArtistInfo, event: MouseEvent) {
  const tracks = await player.getArtistTracks(artist.name)
  const profile = await ensureLocalArtistProfile(artist.name)
  const cover = artistPortraitUrl(profile)
  const action = await openPopup([
    { id: 'artist:header', type: 'nowplaying', cover, title: artist.name, subtitle: `${artist.trackCount} 首曲目 · ${artist.albumCount} 张专辑` },
    { type: 'separator' },
    { id: 'artist:open', label: '打开艺术家', iconSvg: menuIcons.album },
    { id: 'artist:play', label: '播放全部曲目', iconSvg: menuIcons.play, enabled: tracks.length > 0 },
    { id: 'artist:shuffle', label: '随机播放', iconSvg: menuIcons.shuffle, enabled: tracks.length > 0 },
    { id: 'artist:queue', label: '添加到队列', iconSvg: menuIcons.queue, enabled: tracks.length > 0 },
    { type: 'separator' },
    { id: 'artist:playlist', label: '添加到播放列表', iconSvg: menuIcons.playlist, enabled: tracks.length > 0 && state.playlists.length > 0, submenu: playlistSubmenu('artist:playlist') },
    { type: 'separator' },
    { id: 'artist:info', label: profile.updatedAt ? '刷新艺术家资料' : '获取在线艺术家资料', iconSvg: menuIcons.info, enabled: state.connected },
    { id: 'artist:photo', label: '选择艺术家照片', iconSvg: menuIcons.album, enabled: state.connected },
    { id: 'artist:reset-photo', label: '恢复自动艺术家照片', iconSvg: menuIcons.remove, enabled: state.connected && Boolean(profile.manualImage) },
    { id: 'artist:source', label: '查看资料来源', iconSvg: menuIcons.info, enabled: Boolean(profile.sourceUrl) },
  ], event)
  if (!action) return
  if (action === 'artist:open') await player.selectArtist(artist.name)
  if (action === 'artist:play') await player.playTrackCollection(tracks)
  if (action === 'artist:shuffle') await player.playTrackCollection(tracks, true)
  if (action === 'artist:queue') await player.addTracksToQueue(tracks)
  if (action.startsWith('artist:playlist:')) await player.addTracksToPlaylist(tracks, Number(action.split(':').at(-1)))
  if (action === 'artist:info') {
    await player.selectArtist(artist.name)
    await loadOnlineArtistProfile(artist.name)
  }
  try {
    if (action === 'artist:photo') await chooseArtistPhoto(artist.name)
    if (action === 'artist:reset-photo') await resetArtistPhoto(artist.name)
  } catch (error) {
    player.notify(error instanceof Error ? error.message : '未能更新艺术家照片。', 'error')
  }
  if (action === 'artist:source') await openArtistSource(profile.sourceUrl)
}

async function openFolderMenu(folder: LibraryFolderCard, event: MouseEvent) {
  event.preventDefault()
  if (folderSelectionMode.value && !selectedFolderIds.value.includes(folderId(folder))) setFolderSelection(folder, true)
  const targets = folderSelectionMode.value
    ? state.libraryFolders.filter((item) => selectedFolderIds.value.includes(folderId(item)))
    : [folder]
  const multiple = targets.length > 1
  try {
    const tracks = await getFolderSelectionTracks(targets)
    const pluginActions = await player.getPluginContextActions(tracks)
    const dopItem = pluginMenuItem('folder:dop', 'iPod', pluginActions.dop, player.pluginIntegrations.dop.installed, menuIcons.device)
    const action = await openPopup([
      { id: 'folder:header', label: multiple ? `已选择 ${targets.length} 个文件夹` : folder.name, iconSvg: menuIcons.folder, enabled: false },
      { type: 'separator' },
      { id: 'folder:select', label: folderSelectionMode.value ? '退出文件夹选择' : '选择文件夹', iconSvg: menuIcons.info },
      { id: 'folder:open', label: '打开文件夹', iconSvg: menuIcons.folder, enabled: !multiple },
      { id: 'folder:play', label: multiple ? `播放 ${targets.length} 个文件夹` : '播放文件夹', iconSvg: menuIcons.play, enabled: tracks.length > 0 },
      { id: 'folder:shuffle', label: multiple ? `随机播放 ${targets.length} 个文件夹` : '随机播放文件夹', iconSvg: menuIcons.shuffle, enabled: tracks.length > 0 },
      { id: 'folder:queue', label: multiple ? `将 ${targets.length} 个文件夹添加到队列` : '添加文件夹到队列', iconSvg: menuIcons.queue, enabled: tracks.length > 0 },
      { type: 'separator' },
      { id: 'folder:playlist', label: multiple ? `将 ${targets.length} 个文件夹添加到播放列表` : '添加文件夹到播放列表', iconSvg: menuIcons.playlist, enabled: tracks.length > 0 && state.playlists.length > 0, submenu: playlistSubmenu('folder:playlist') },
      ...(dopItem ? [{ type: 'separator' } as ContextMenuItem, dopItem] : []),
      { id: 'folder:location', label: '在资源管理器中显示', iconSvg: menuIcons.folder, enabled: !multiple && Boolean(folder.absolutePath) },
      { type: 'separator' },
      { id: 'folder:properties', label: multiple ? '文件夹曲目属性' : '文件夹属性', iconSvg: menuIcons.info, enabled: tracks.length > 0 },
    ], event)
    if (!action) return
    if (action === 'folder:select') {
      if (folderSelectionMode.value) cancelFolderSelection()
      else {
        folderSelectionMode.value = true
        selectedFolderIds.value = [folderId(folder)]
      }
      return
    }
    if (action === 'folder:open') await player.selectLibraryFolder(folder)
    if (action === 'folder:play') await player.playTrackCollection(tracks)
    if (action === 'folder:shuffle') await player.playTrackCollection(tracks, true)
    if (action === 'folder:queue') await player.addTracksToQueue(tracks)
    if (action.startsWith('folder:playlist:')) await player.addTracksToPlaylist(tracks, Number(action.split(':').at(-1)))
    if (action === 'folder:location') await player.showFolderInExplorer(folder)
    if (action === 'folder:properties') await openInspector('properties', tracks)
    await runSelectedPluginAction(action, 'folder:dop', pluginActions.dop, tracks)
  } catch (error) {
    player.notify(error instanceof Error ? error.message : '无法打开文件夹菜单。', 'error')
  }
}

async function openPlaylistMenu(playlist: PlaylistInfo, event: MouseEvent) {
  const writable = !playlist.isLocked && !playlist.isAutoplaylist
  const action = await openPopup([
    { id: 'playlist:header', label: playlist.name, enabled: false, iconSvg: menuIcons.playlist },
    { type: 'separator' },
    { id: 'playlist:open', label: '打开播放列表', iconSvg: menuIcons.album },
    { id: 'playlist:play', label: '从头播放', iconSvg: menuIcons.play, enabled: playlist.trackCount > 0 },
    { id: 'playlist:shuffle', label: '随机播放', iconSvg: menuIcons.shuffle, enabled: playlist.trackCount > 0 },
    { id: 'playlist:move-top', label: '移到最上方', iconSvg: menuIcons.move, enabled: state.playlists.at(0)?.index !== playlist.index },
    { type: 'separator' },
    { id: 'playlist:duplicate', label: '复制播放列表', iconSvg: menuIcons.copy },
    { id: 'playlist:undo', label: '撤销上次更改', iconSvg: menuIcons.undo, enabled: writable },
    { id: 'playlist:sort-title', label: '按标题排序', iconSvg: menuIcons.sort, enabled: writable },
    { id: 'playlist:sort-album', label: '按专辑 / 音轨排序', iconSvg: menuIcons.sortAlbum, enabled: writable },
    { id: 'playlist:remove-duplicates', label: '移除重复项', iconSvg: menuIcons.deduplicate, enabled: writable && playlist.trackCount > 0 },
    { id: 'playlist:remove-invalid', label: '移除无效项', iconSvg: menuIcons.invalid, enabled: writable && playlist.trackCount > 0 },
    ...(player.pluginIntegrations.dop.installed ? [{ type: 'separator' } as ContextMenuItem, { id: 'playlist:ipod', label: '发送播放列表到 iPod…', iconSvg: menuIcons.device }] : []),
    { type: 'separator' },
    { id: 'playlist:clear', label: '清空播放列表', iconSvg: menuIcons.remove, enabled: writable && playlist.trackCount > 0 },
    { id: 'playlist:remove', label: '删除播放列表', iconSvg: menuIcons.remove, enabled: !playlist.isLocked },
  ], event)
  if (action === 'playlist:open') await player.selectActivePlaylist(playlist.index)
  if (action === 'playlist:play') await player.playPlaylist(playlist.index)
  if (action === 'playlist:shuffle') await player.playPlaylist(playlist.index, true)
  if (action === 'playlist:move-top') await player.movePlaylistToTop(playlist.index)
  if (action === 'playlist:duplicate') await player.duplicatePlaylist(playlist.index)
  if (action === 'playlist:undo') await player.undoPlaylistChange(playlist.index)
  if (action === 'playlist:sort-title') await player.sortPlaylist(playlist.index, '%title%')
  if (action === 'playlist:sort-album') await player.sortPlaylist(playlist.index, '%album artist%|%date%|%album%|%discnumber%|%tracknumber%')
  if (action === 'playlist:remove-duplicates') await player.runNativePlaylistCleanup(playlist.index, 'duplicates')
  if (action === 'playlist:remove-invalid') await player.runNativePlaylistCleanup(playlist.index, 'invalid')
  if (action === 'playlist:ipod') await player.runIpodMainAction('sendPlaylists')
  if (action === 'playlist:clear') await player.clearPlaylist(playlist.index)
  if (action === 'playlist:remove') await player.removePlaylist(playlist.index)
}

async function openQueueMenu(index: number, event: MouseEvent) {
  const item = state.queue[index]
  if (!item) return
  const action = await openPopup([
    { id: 'queue:header', type: 'nowplaying', title: item.title, subtitle: `${item.artist} · ${item.album} · ${item.queueSource === 'explicit' ? '播放队列' : '当前播放列表'}` },
    { type: 'separator' },
    { id: 'queue:play', label: '立即播放', iconSvg: menuIcons.play },
    { id: 'queue:top', label: item.queueSource === 'explicit' ? '移到队首' : '设为下一首', iconSvg: menuIcons.next, enabled: item.queueSource === 'playlist' || item.sourceIndex > 0 },
    { id: 'queue:remove', label: '从队列移除', iconSvg: menuIcons.remove, enabled: item.queueSource === 'explicit' },
    { type: 'separator' },
    { id: 'queue:clear', label: '清空队列', iconSvg: menuIcons.remove, enabled: state.queue.some((entry) => entry.queueSource === 'explicit') },
  ], event)
  if (action === 'queue:play') await player.playQueueItem(index)
  if (action === 'queue:top') await player.moveQueueItemToTop(index)
  if (action === 'queue:remove') await player.removeQueueItem(index)
  if (action === 'queue:clear') await player.clearQueue()
}

async function runTrackAction(action: () => Promise<unknown>) {
  trackMenu.open = false
  await action()
}

async function removeTrackMenuTracks() {
  const route = state.route
  if (route.view !== 'playlist' || !trackMenu.tracks.length) return
  await player.removeTracksFromPlaylist(trackMenu.tracks, route.playlistIndex)
}

async function handlePlayTrack(track: DisplayTrack, index?: number) {
  await player.playTrack(track, index)
}

function isExternalDrag(event: DragEvent) {
  return nativeDragFiles || Array.from(event.dataTransfer?.types ?? []).includes('Files')
}
function finishExternalDrag() {
  dragState.active = false; dragState.depth = 0; dragState.marker = false; nativeDragFiles = false
  if (externalHoverTimer) clearTimeout(externalHoverTimer)
  externalHoverTimer = null; externalHoverIndex = -1
  if (externalScrollFrame) cancelAnimationFrame(externalScrollFrame)
  externalScrollFrame = 0; externalScrollElement = null
}
function markExternalDrop(element: HTMLElement, line?: number) {
  const rect = element.getBoundingClientRect()
  Object.assign(dragState, { marker: true, left: rect.left + (line == null ? 0 : 8), top: line ?? rect.top, width: Math.max(0, rect.width - (line == null ? 0 : 16)), height: line == null ? rect.height : 3 })
}
function externalDropTarget(x: number, y: number): ExternalDropTarget {
  dragState.marker = false
  const hit = document.elementFromPoint(x, y)
  if (!hit || hit.closest('.modal-backdrop, .track-inspector-scrim, .context-menu')) return { kind: 'reject', reason: '请先关闭当前弹出界面再拖放。' }
  const card = hit.closest<HTMLElement>('[data-external-play-target]')
  if (card) { markExternalDrop(card); return { kind: 'temporary' } }
  const row = hit.closest<HTMLElement>('.playlist-nav__item[data-playlist-index]')
  if (row) {
    const index = Number(row.dataset.playlistIndex), playlist = state.playlists.find(item => item.index === index)
    if (!playlist || row.dataset.playlistName && row.dataset.playlistName !== playlist.name) return { kind: 'reject', reason: '播放列表已变化。' }
    const rect = row.getBoundingClientRect(), zone = sidebarDropZone(y, rect.top, rect.height)
    const identity = { index, name: playlist.name }
    if (zone !== 'append') { markExternalDrop(row, zone === 'before' ? rect.top : rect.bottom); return { kind: 'create', anchor: identity, after: zone === 'after' } }
    markExternalDrop(row)
    if (playlist.isLocked || playlist.isAutoplaylist) return { kind: 'reject', reason: '此播放列表不可写。' }
    return { kind: 'append', playlist: identity }
  }
  const navigation = hit.closest<HTMLElement>('.playlist-nav')
  if (navigation) {
    const last = [...navigation.querySelectorAll<HTMLElement>('.playlist-nav__item')].at(-1)
    if (last) {
      const index = Number(last.dataset.playlistIndex), playlist = state.playlists.find(item => item.index === index)
      if (playlist) { markExternalDrop(last, last.getBoundingClientRect().bottom); return { kind: 'create', anchor: { index, name: playlist.name }, after: true } }
    }
    markExternalDrop(navigation); return { kind: 'create' }
  }
  const list = hit.closest<HTMLElement>('.track-list[data-playlist-index]')
  if (list) {
    if (scenePending.value || sceneSwitching.value || displayedScene.value.route.view !== 'playlist') return { kind: 'reject', reason: '等待播放列表加载完成后再插入。' }
    const index = Number(list.dataset.playlistIndex), playlist = state.playlists.find(item => item.index === index)
    if (displayedScene.value.route.playlistIndex !== index || displayedScene.value.route.playlistName !== playlist?.name) return { kind: 'reject', reason: '当前列表位置已变化，请等待界面更新。' }
    if (!playlist || playlist.isLocked || playlist.isAutoplaylist) return { kind: 'reject', reason: '此列表不支持插入音乐。' }
    const trackRow = hit.closest<HTMLElement>('.track-row[data-track-index]')
    if (!trackRow) { markExternalDrop(list, list.getBoundingClientRect().bottom); return { kind: 'append', playlist: { index, name: playlist.name } } }
    const track = state.visibleTracks[Number(trackRow.dataset.trackIndex)]
    const sourceIndex = trackRow.dataset.sourceIndex == null ? track?.sourceIndex : Number(trackRow.dataset.sourceIndex)
    const key = trackRow.dataset.trackIdentity ? decodeURIComponent(trackRow.dataset.trackIdentity) : trackKey(track)
    if (sourceIndex == null || !Number.isInteger(sourceIndex) || !key) return { kind: 'reject', reason: '无法定位原播放列表歌曲。' }
    const rect = trackRow.getBoundingClientRect(), after = y >= rect.top + rect.height / 2
    markExternalDrop(trackRow, after ? rect.bottom : rect.top)
    return { kind: 'insert', playlist: { index, name: playlist.name }, sourceIndex, key, after }
  }
  if (hit.closest('.track-list')) return { kind: 'reject', reason: '仅播放列表支持插入歌曲，请拖到左侧歌单或左下卡片。' }
  return { kind: 'open' }
}
function updateExternalHover(target: ExternalDropTarget, x: number, y: number) {
  const index = target.kind === 'append' ? target.playlist.index : -1
  if (index !== externalHoverIndex) {
    if (externalHoverTimer) clearTimeout(externalHoverTimer)
    externalHoverIndex = index
    if (index >= 0) externalHoverTimer = setTimeout(() => { externalHoverTimer = null; if (dragState.active) selectPrimaryPlaylist(index) }, 700)
  }
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('.playlist-nav, .workspace-scroll') ?? null
  externalPoint = { x, y }; externalScrollElement = element
  const rect = element?.getBoundingClientRect()
  externalScrollDelta = rect && y < rect.top + 40 ? -9 : rect && y > rect.bottom - 40 ? 9 : 0
  if (!externalScrollFrame && externalScrollDelta) {
    const scroll = () => {
      externalScrollFrame = 0
      if (!dragState.active || !externalScrollElement || !externalScrollDelta) return
      externalScrollElement.scrollTop += externalScrollDelta
      const current = externalDropTarget(externalPoint.x, externalPoint.y)
      dragState.label = externalDropLabel(current); dragState.rejected = current.kind === 'reject'
      externalScrollFrame = requestAnimationFrame(scroll)
    }
    externalScrollFrame = requestAnimationFrame(scroll)
  }
}
function onDragEnter(event: DragEvent) {
  if (!state.connected || !isExternalDrag(event)) return
  event.preventDefault()
  dragState.depth += 1
  dragState.active = true
}

function onDragOver(event: DragEvent) {
  if (!state.connected || !isExternalDrag(event)) return
  event.preventDefault()
  const target: ExternalDropTarget = state.dndSupported ? externalDropTarget(event.clientX, event.clientY) : { kind: 'reject', reason: '此窗口无法取得真实文件路径。' }
  dragState.active = true; dragState.label = externalDropLabel(target); dragState.rejected = target.kind === 'reject'
  if (event.dataTransfer) event.dataTransfer.dropEffect = dragState.rejected ? 'none' : 'copy'
  updateExternalHover(target, event.clientX, event.clientY)
}

function onDragLeave(event: DragEvent) {
  if (!state.connected || !isExternalDrag(event)) return
  event.preventDefault()
  dragState.depth = Math.max(0, dragState.depth - 1)
  if (!dragState.depth) finishExternalDrag()
}

function onDrop(event: DragEvent) {
  if (!state.connected || !isExternalDrag(event)) return
  event.preventDefault()
  const target: ExternalDropTarget = state.dndSupported ? externalDropTarget(event.clientX, event.clientY) : { kind: 'reject', reason: '此窗口不支持文件拖放。' }
  dragState.clickUntil = Date.now() + 350
  finishExternalDrag()
  void externalDrop.html(target)
}
</script>

<template>
  <AboutDialog v-if="aboutOpen" :connected="state.connected" @close="aboutOpen = false" />
  <MiniPlayer
    v-if="miniMode"
    :track="state.currentTrack"
    :artwork="state.currentArtwork"
    :is-playing="state.isPlaying"
    :position="state.position"
    :duration="state.duration"
    :volume="state.volume"
    :muted="state.muted"
    :can-seek="state.canSeek"
    @toggle="player.togglePlayback"
    @next="player.next"
    @previous="player.previous"
    @seek="player.seek"
    @mute="player.toggleMute"
    @drag="player.startWindowDrag"
    @close="player.restoreMainPlayer"
  />
  <div v-else class="app-shell" :class="{ 'immersive-fullscreen-active': immersiveFullscreenTarget }" :style="immersiveShellStyle" @contextmenu.prevent>
    <AppSidebar
      :view="state.view"
      :playlists="state.playlists"
       :active-playlist="state.browsingPlaylist ?? state.activePlaylist"
       :search="state.search"
       :ipod-available="player.pluginIntegrations.dop.installed"
       :track-playlist-hover-index="trackPlaylistHoverIndex"
       :track-playlist-hover-phase="trackPlaylistHoverPhase"
       :track-favourites-hover-phase="trackFavouritesHoverPhase"
      @navigate="navigatePrimary"
      @playlist="selectPrimaryPlaylist"
      @search="player.setSearch"
      @submit-search="submitPrimarySearch"
      @clear-search="clearPrimarySearch"
       @playlist-menu="openPlaylistMenu"
       @reorder-playlists="player.reorderPlaylists"
       @send-playlist-to-ipod="requestPlaylistIpodTransfer"
       @create-playlist="state.dialog = 'createPlaylist'"
      @favourites="showFavourites"
      @theme-settings="openThemeSettings"
    />

    <div class="workspace">
      <AppTopbar
        :connected="state.connected"
        :search="state.search"
        :search-busy="state.searchLoading"
        :can-go-back="state.canGoBack"
        :can-go-forward="state.canGoForward"
        :output-devices="outputDevices"
        :output-loading="outputLoading"
        :connection-label="connectionLabel"
        :connection-transitioning="connectionTransitioning"
        :library-scanning="state.libraryStatus.scanning === true"
        :ipod-available="player.pluginIntegrations.dop.installed"
        @search="player.setSearch"
        @submit-search="submitPrimarySearch"
        @clear-search="clearPrimarySearch"
        @back="goBackPrimary"
        @forward="goForwardPrimary"
        @refresh="player.refreshLibrary"
        @preferences="player.showPreferences"
        @reload="player.reloadInterface"
        @rescan="player.rescanLibrary"
        @load-output-devices="loadOutputDevices"
        @select-output-device="selectOutputDevice"
        @desktop-lyrics="player.toggleDesktopLyrics"
        @mini-player="player.openMiniPlayer"
        @ipod-manager="player.openIpodManager"
        @drag="player.startWindowDrag"
        @maximize="player.toggleWindowMaximize"
      />
      <div class="workspace-scroll"
        :class="{ 'workspace-scroll--layout-switch': ['albums', 'artists'].includes(displayedScene.route.view), 'workspace-scroll--index-rail': state.alphabetIndexView && ['albums', 'artists'].includes(displayedScene.route.view) }"
        :data-browsing-playlist-index="state.route.view === 'playlist' ? state.route.playlistIndex : undefined"
        :data-route-pending="scenePending" :aria-busy="scenePending">
        <div class="route-page" :inert="(scenePending || sceneSwitching) && trackDragRouteKey === null">
          <Transition name="route-scene" :mode="sceneAnimationEnabled ? 'out-in' : 'default'" :css="sceneAnimationEnabled"
            @before-leave="sceneSwitching = true" @enter="enterScene"
            @after-enter="sceneSwitching = false" @after-leave="finishSceneLeave"
            @enter-cancelled="sceneSwitching = false" @leave-cancelled="sceneSwitching = false">
            <KeepAlive :max="trackDragRouteKey === null ? 8 : undefined">
              <RouteScene :key="displayedScene.cacheKey" :scene="displayedScene" :controls="sceneControls"
                @action="player.runIpodMainAction" @refresh="player.refreshIpodDeviceStatus"
                @preferences="player.showPreferences" @playlist="selectPrimaryPlaylist"
                @navigate="navigatePrimary" @back="goBackPrimary"
                @artist="player.selectArtist" @artist-menu="openArtistMenu"
                @folder="player.selectLibraryFolder" @folder-menu="openFolderMenu"
                @folder-selection="setFolderSelection" @cancel-folder-selection="cancelFolderSelection"
                @open-album="openPrimaryAlbum" @album-menu="openAlbumMenu" @play-album="player.playAlbum"
                @play-track="handlePlayTrack" @track-menu="openTrackMenu" @shuffle="player.shuffleCurrent"
                @play-collection="player.playCurrentCollection"
                @open-files="player.openFiles" @open-folder="player.openFolder" @clear-search="clearPrimarySearch"
                @selection="selectedTracks = $event" @add-to-playlist="player.addTracksToPlaylist"
                @move-to-playlist="player.moveTracksToPlaylist" @remove-from-playlist="player.removeTracksFromPlaylist"
                @insert-into-playlist="player.insertTracksIntoPlaylist"
                @playlist-hover="handleTrackPlaylistHover" @drag-state="handleTrackDragState"
                @set-favourites="player.setTracksFavourite" @favourites-hover="handleTrackFavouritesHover"
                @add-to-ipod="player.sendTracksToIpod"
                @filter-facet-change="player.setLibraryFilterFacet" @filter-rule-add="player.addLibraryFilterRule"
                @filter-rule-update="player.updateLibraryFilterRule" @filter-rule-remove="player.removeLibraryFilterRule"
                @clear-filters="player.clearLibraryFilters" @reorder="player.reorderPlaylistTrack"
                @album-selection="setAlbumSelection" @cancel-album-selection="cancelAlbumSelection"
                @alphabet-index-view="player.setAlphabetIndexView" />
            </KeepAlive>
          </Transition>
        </div>
      </div>
    </div>

    <NowPlayingPanel
      :open="state.nowPlayingOpen"
      :airplay="player.airplayState.active"
      :remote-pending="player.airplayState.pending"
      :remote-message="player.airplayState.message || (player.airplayState.artworkPending ? '正在补读发送端封面，保留最近图片' : '')"
      :artwork-revision="player.airplayState.artworkRevision"
      :airplay-artwork-pending="player.airplayState.artworkPending"
      @artwork-error="player.retryAirplayArtwork"
      @next="player.next"
      @previous="player.previous"
      :track="state.currentTrack"
      :artwork="state.currentArtwork"
      :is-playing="state.isPlaying"
      :playback-state="state.playbackState"
      :can-seek="state.canSeek"
      :position="state.position"
      :duration="state.duration"
      :lyrics="state.lyrics"
      :lyrics-synced="state.lyricsSynced"
      :playback-tracks="state.playbackTracks"
      :playback-plan-ids="state.playbackPlanIds"
      :playback-track-index="state.playbackTrackIndex"
      :playback-preview-id="state.playbackPreviewId"
      :playback-preview-pending="state.playbackPreviewPending"
      :playback-preview-request="state.playbackPreviewRequest"
      :playback-browse-index="state.playbackBrowseIndex"
      :playback-browse-track="state.playbackBrowseTrack"
      :playback-window-deferred="state.playbackWindowDeferred"
      :shuffle-busy="state.shuffleBusy"
      :shuffle-pending="state.shufflePending"
      :shuffle-staged="state.shuffleStaged"
      :shuffle-source-name="state.shuffleSourceName"
      :fullscreen="state.isFullscreen"
      :fullscreen-progress="immersiveFullscreenProgress"
      @close="player.closeNowPlaying"
      @toggle="player.togglePlayback"
      @seek="player.seek"
      @seek-resume="player.seekAndPlay"
      @favourite="player.toggleFavourite"
      @play-track="player.playPlaybackTrack"
      @browse-track="player.browsePlaybackTrack"
      @browse-position="player.browsePlaybackPosition"
      @begin-browse="player.beginPlaybackBrowse"
      @focus-state="player.setPlaybackFocusState"
      @shuffle="player.shufflePlaybackPlan"
      @restore-order="player.restorePlaybackPlan"
    />

    <Transition name="queue-card">
      <QueuePopover
        v-if="queueOpen"
        :queue="state.queue"
        :playback-order="state.playbackOrder"
        :shuffle-pending="state.shufflePending"
        :shuffle-staged="state.shuffleStaged"
        :shuffle-source-name="state.shuffleSourceName"
        @close="queueOpen = false"
        @play="player.playQueueItem"
        @remove="player.removeQueueItem"
        @move="player.moveQueueItemToTop"
        @clear="player.clearQueue"
        @menu="openQueueMenu"
      />
    </Transition>

    <PlayerBar
      :track="state.currentTrack"
      :artwork="state.currentArtwork"
      :is-playing="state.isPlaying"
      :position="state.position"
      :duration="state.duration"
      :volume="state.volume"
      :muted="state.muted"
      :can-seek="state.canSeek"
      :playback-order="state.playbackOrder"
      :shuffle-busy="state.shuffleBusy"
      :shuffle-pending="state.shufflePending"
      :shuffle-staged="state.shuffleStaged"
      :now-playing-open="state.nowPlayingOpen"
      :airplay="player.airplayState.active"
      :remote-message="player.airplayState.message"
      :fullscreen="state.isFullscreen"
      :queue-open="queueOpen"
      @toggle="player.togglePlayback"
      @next="player.next"
      @previous="player.previous"
      @seek="player.seek"
      @volume="player.setVolume"
      @mute="player.toggleMute"
      @order="player.cyclePlaybackOrder"
      @immersive="openNowPlaying"
      @fullscreen-immersive="openFullscreenNowPlaying"
      @queue="toggleQueue"
      @menu="(track, event) => openTrackMenu(track, -1, event)"
    />

    <CreatePlaylistDialog
      v-if="state.dialog === 'createPlaylist'"
      @close="state.dialog = null"
      @create="createPlaylistFromDialog"
    />

    <TrackActionMenu
      v-if="trackMenu.open && trackMenu.track"
      :track="trackMenu.track"
      :index="trackMenu.index"
      :view="state.view"
       :active-playlist="state.browsingPlaylist ?? state.activePlaylist"
       :playlists="state.playlists"
       :batch="trackMenu.tracks.length > 1"
       :track-count="trackMenu.tracks.length"
       :connected="state.connected"
      :x="trackMenu.x"
      :y="trackMenu.y"
      @close="trackMenu.open = false"
      @play="runTrackAction(() => handlePlayTrack(trackMenu.track!, trackMenu.index))"
      @play-next="runTrackAction(() => player.playNext(trackMenu.track!))"
       @queue="runTrackAction(() => player.addTracksToQueue(trackMenu.tracks))"
       @playlist="(playlistIndex) => runTrackAction(() => player.addTracksToPlaylist(trackMenu.tracks, playlistIndex))"
      @favourite="runTrackAction(() => player.toggleFavourite(trackMenu.track!))"
      @album="runTrackAction(() => player.openTrackAlbum(trackMenu.track!))"
      @location="runTrackAction(() => player.showInExplorer(trackMenu.track!))"
        @remove="runTrackAction(removeTrackMenuTracks)"
       @properties="runTrackAction(() => openInspector('properties', trackMenu.tracks))"
       @edit-metadata="runTrackAction(() => openInspector('edit', trackMenu.tracks))"
    />

    <TrackInspector
      v-if="inspector.open"
      :mode="inspector.mode"
      :tracks="inspector.tracks"
      :details="inspector.details"
      :album="inspector.album"
      :loading="inspector.loading"
      :busy="inspector.busy"
      @close="inspector.open = false"
      @native-properties="player.showNativeTrackProperties(inspector.tracks)"
      @save="saveInspectorMetadata"
      @rating="setInspectorRating"
      @scan-replay-gain="scanInspectorReplayGain"
      @clear-replay-gain="clearInspectorReplayGain"
      @embed-artwork="embedInspectorArtwork"
      @remove-artwork="removeInspectorArtwork"
    />

    <FileOperationDialog v-if="fileDialog.open && fileDialog.track" :track="fileDialog.track" :mode="fileDialog.mode" :target="fileDialog.target" :busy="fileDialog.busy" @close="fileDialog.open = false" @rename="renameFile" @move="confirmMoveFile" @delete="deleteFile" />

    <ThemeSettings v-if="themeSettingsOpen" :connected="state.connected" @close="themeSettingsOpen = false" />
    <LightFieldSettingsDialog v-if="lightSettingsOpen" :connected="state.connected" :fullscreen="state.isFullscreen && state.nowPlayingOpen" @close="lightSettingsOpen = false" />
    <div v-if="ipodPlaylistConfirmation" class="modal-backdrop" @click.self="ipodPlaylistConfirmation = null">
      <section class="create-playlist-dialog ipod-transfer-confirmation" role="dialog" aria-modal="true" aria-labelledby="ipod-transfer-title">
        <header><span><Info :size="20" /></span><div><strong id="ipod-transfer-title">发送曲目到 iPod</strong><small>{{ ipodPlaylistConfirmation.name }}</small></div></header>
        <p>将此播放列表中的全部曲目发送到已连接的 iPod。</p>
        <p>不会创建或同步同名 iPod 播放列表，也不会修改原播放列表和本地文件。</p>
        <footer><button class="secondary-button" @click="ipodPlaylistConfirmation = null">取消</button><button class="primary-button" @click="confirmPlaylistIpodTransfer">发送全部曲目</button></footer>
      </section>
    </div>
    <CoverflowPerformanceDialog v-if="coverflowPerformanceReport" :report="coverflowPerformanceReport" @close="coverflowPerformanceReport = null" />

    <Teleport to="body"><div v-if="dragState.active && dragState.marker" class="external-drop-marker" :class="{ rejected: dragState.rejected }" :style="{ left: `${dragState.left}px`, top: `${dragState.top}px`, width: `${dragState.width}px`, height: `${dragState.height}px` }" />
      <div v-if="dragState.active" class="external-drop-hint" :class="{ rejected: dragState.rejected }"><FileMusic :size="20" /><span>{{ dragState.label || '拖到播放列表、歌曲之间或左下卡片' }}</span></div></Teleport>

    <Transition name="toast">
      <div v-if="state.toast" class="app-toast" :class="`app-toast--${state.toast.tone}`">
        <CheckCircle2 v-if="state.toast.tone === 'success'" :size="18" />
        <AlertCircle v-else-if="state.toast.tone === 'error'" :size="18" />
        <Info v-else :size="18" />
        <span>{{ state.toast.message }}</span>
      </div>
    </Transition>
  </div>
</template>
