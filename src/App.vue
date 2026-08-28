<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { AlertCircle, CheckCircle2, FileMusic, Info } from '@lucide/vue'
import AppSidebar from './components/AppSidebar.vue'
import AppTopbar from './components/AppTopbar.vue'
import CreatePlaylistDialog from './components/CreatePlaylistDialog.vue'
import LibraryView from './components/LibraryView.vue'
import MiniPlayer from './components/MiniPlayer.vue'
import NowPlayingPanel from './components/NowPlayingPanel.vue'
import PlayerBar from './components/PlayerBar.vue'
import QueuePopover from './components/QueuePopover.vue'
import TrackInspector from './components/TrackInspector.vue'
import FileOperationDialog from './components/FileOperationDialog.vue'
import TrackActionMenu from './components/TrackActionMenu.vue'
import { useFoobar } from './composables/useFoobar'
import type { OutputDevice, PlaylistInfo } from 'foo-webview-sdk'
import type { AlbumCard, DisplayTrack, TrackDetails, ViewId } from './types/music'
import { menuIcons, showContextMenu, type ContextMenuItem } from './utils/contextMenu'
import { isSameTrack } from './utils/track'

const player = useFoobar()
const { state, filteredAlbums, libraryFilterOptions } = player
const miniMode = new URLSearchParams(window.location.search).get('mode') === 'mini'
const trackMenu = reactive({ open: false, track: null as DisplayTrack | null, index: -1, x: 0, y: 0 })
const dragState = reactive({ active: false, depth: 0 })
const queueOpen = ref(false)
const outputDevices = ref<OutputDevice[]>([])
const outputLoading = ref(false)
const connectionLabel = ref('foobar2000')
const connectionTransitioning = ref(false)
let airplayTimer: ReturnType<typeof setTimeout> | null = null
const selectedTracks = ref<DisplayTrack[]>([])
const inspector = reactive({ open: false, mode: 'properties' as 'properties' | 'edit', tracks: [] as DisplayTrack[], album: null as AlbumCard | null, details: [] as TrackDetails[], loading: false, busy: false, request: 0 })
const fileDialog = reactive({ open: false, mode: 'rename' as 'rename' | 'move' | 'delete', track: null as DisplayTrack | null, target: '', busy: false })

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
  const target = event.target as HTMLElement | null
  const interactive = target?.closest('button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="slider"]')

  if (event.ctrlKey && event.key.toLocaleLowerCase() === 'k') {
    event.preventDefault()
    document.querySelector<HTMLInputElement>('.topbar-search input')?.focus()
    return
  }
  if (event.key === 'F11') {
    event.preventDefault()
    void player.toggleFullscreen()
    return
  }
  if (event.key === 'Escape') {
    state.nowPlayingOpen = false
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

onMounted(() => {
  void player.initialize()
  if (miniMode) document.body.classList.add('mini-window')
  window.addEventListener('keydown', onKeydown)
  if (miniMode) return
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
})

onBeforeUnmount(() => {
  document.body.classList.remove('mini-window')
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
  player.dispose()
  if (airplayTimer) clearTimeout(airplayTimer)
})

function openNowPlaying() {
  queueOpen.value = false
  player.toggleNowPlaying('lyrics')
}

function toggleQueue() {
  queueOpen.value = !queueOpen.value
  trackMenu.open = false
}

function closeSecondaryUi() {
  state.nowPlayingOpen = false
  state.dialog = null
  trackMenu.open = false
  queueOpen.value = false
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
  void player.goBack()
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
  closeSecondaryUi()
  void player.selectAlbum(album)
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

function playlistSubmenu(prefix: string): ContextMenuItem[] {
  return state.playlists.map((playlist) => ({
    id: `${prefix}:${playlist.index}`,
    label: playlist.name,
    enabled: !playlist.isLocked && !playlist.isAutoplaylist,
  }))
}

async function openPopup(items: ContextMenuItem[], event: MouseEvent) {
  try {
    return await showContextMenu(items, event)
  } catch (error) {
    player.notify(error instanceof Error ? error.message : '无法打开右键菜单。', 'error')
    return null
  }
}

async function openTrackMenu(track: DisplayTrack, index: number, event: MouseEvent) {
  const targets = selectedTracks.value.some((item) => isSameTrack(item, track)) ? selectedTracks.value : [track]
  if (state.connected) {
    trackMenu.open = false
    try {
      const items: ContextMenuItem[] = [
        { id: 'track:header', type: 'nowplaying', cover: track.artworkUrl, title: targets.length > 1 ? `已选择 ${targets.length} 首曲目` : track.title, subtitle: targets.length > 1 ? '批量操作' : `${track.artist} · ${track.album}` },
        { type: 'separator' },
        { id: 'track:play', label: '立即播放', iconSvg: menuIcons.play },
        { id: 'track:next', label: '下一首播放', iconSvg: menuIcons.next },
        { id: 'track:queue', label: '添加到队列', iconSvg: menuIcons.queue },
        { type: 'separator' },
        { id: 'track:favourite', label: Number(track.rating ?? 0) === 5 ? '取消收藏' : '添加到收藏', checked: Number(track.rating ?? 0) === 5, iconSvg: menuIcons.heart },
        { id: 'track:playlist', label: '添加到播放列表', iconSvg: menuIcons.playlist, enabled: state.playlists.length > 0, submenu: playlistSubmenu('track:playlist') },
        { type: 'separator' },
        { id: 'track:album', label: '前往专辑', iconSvg: menuIcons.album },
        { id: 'track:location', label: '显示文件位置', iconSvg: menuIcons.folder, enabled: Boolean(track.path) },
        { type: 'separator' },
        { id: 'track:properties', label: '属性', iconSvg: menuIcons.info },
        { id: 'track:edit', label: '编辑标签', iconSvg: menuIcons.edit },
        { id: 'track:rename', label: '重命名文件', iconSvg: menuIcons.edit, enabled: track.subsong == null && !track.path.includes('://') },
        { id: 'track:move', label: '移动文件', iconSvg: menuIcons.folder, enabled: track.subsong == null && !track.path.includes('://') },
        { id: 'track:delete-file', label: '移动文件到回收站', iconSvg: menuIcons.remove, enabled: track.subsong == null && !track.path.includes('://') },
      ]
      if (state.view === 'playlist' && index >= 0) {
        items.push({ type: 'separator' }, { id: 'track:remove', label: `从“${state.activePlaylist?.name ?? '播放列表'}”移除`, iconSvg: menuIcons.remove })
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
      if (action === 'track:rename') openFileDialog('rename', track)
      if (action === 'track:move') await moveFile(track)
      if (action === 'track:delete-file') openFileDialog('delete', track)
      if (action === 'track:remove') await player.removePlaylistTrack(track, index)
      if (action.startsWith('track:playlist:')) await player.addTracksToPlaylist(targets, Number(action.split(':').at(-1)))
    } catch (error) {
      player.notify(error instanceof Error ? error.message : '无法打开右键菜单。', 'error')
    }
    return
  }

  const target = event.currentTarget as HTMLElement | null
  const rect = target?.getBoundingClientRect()
  trackMenu.track = track
  trackMenu.index = index
  trackMenu.x = event.clientX || rect?.right || 20
  trackMenu.y = event.clientY || rect?.bottom || 20
  trackMenu.open = true
}

async function openAlbumMenu(album: AlbumCard, event: MouseEvent) {
  event.preventDefault()
  if (!state.connected) {
    await player.selectAlbum(album)
    return
  }
  const action = await openPopup([
    { id: 'album:header', type: 'nowplaying', cover: album.artworkUrl, title: album.name, subtitle: `${album.artist}${album.year ? ` · ${album.year}` : ''}` },
    { type: 'separator' },
    { id: 'album:open', label: '打开专辑', iconSvg: menuIcons.album },
    { id: 'album:play', label: '播放专辑', iconSvg: menuIcons.play },
    { id: 'album:shuffle', label: '随机播放专辑', iconSvg: menuIcons.shuffle },
    { id: 'album:queue', label: '将专辑添加到队列', iconSvg: menuIcons.queue },
    { type: 'separator' },
    { id: 'album:playlist', label: '将专辑添加到播放列表', iconSvg: menuIcons.playlist, enabled: state.playlists.length > 0, submenu: playlistSubmenu('album:playlist') },
    { type: 'separator' },
    { id: 'album:properties', label: '专辑属性', iconSvg: menuIcons.info },
  ], event)
  if (action === 'album:open') await player.selectAlbum(album)
  if (action === 'album:play') await player.playAlbum(album)
  if (action === 'album:shuffle') await player.shuffleAlbum(album)
  if (action === 'album:queue') await player.queueAlbum(album)
  if (action === 'album:properties') await openInspector('properties', await player.getAlbumTracks(album), album)
  if (action?.startsWith('album:playlist:')) await player.addAlbumToPlaylist(album, Number(action.split(':').at(-1)))
}

async function openPlaylistMenu(playlist: PlaylistInfo, event: MouseEvent) {
  const writable = !playlist.isLocked && !playlist.isAutoplaylist
  const action = await openPopup([
    { id: 'playlist:open', label: playlist.name, enabled: false, iconSvg: menuIcons.playlist },
    { type: 'separator' },
    { id: 'playlist:open', label: '打开播放列表', iconSvg: menuIcons.album },
    { id: 'playlist:play', label: '从头播放', iconSvg: menuIcons.play, enabled: playlist.trackCount > 0 },
    { id: 'playlist:shuffle', label: '随机播放', iconSvg: menuIcons.shuffle, enabled: playlist.trackCount > 0 },
    { type: 'separator' },
    { id: 'playlist:duplicate', label: '复制播放列表', iconSvg: menuIcons.copy },
    { id: 'playlist:undo', label: '撤销上次更改', iconSvg: menuIcons.refresh, enabled: writable },
    { id: 'playlist:sort-title', label: '按标题排序', iconSvg: menuIcons.refresh, enabled: writable },
    { id: 'playlist:sort-album', label: '按专辑 / 音轨排序', iconSvg: menuIcons.album, enabled: writable },
    { type: 'separator' },
    { id: 'playlist:clear', label: '清空播放列表', iconSvg: menuIcons.remove, enabled: writable && playlist.trackCount > 0 },
    { id: 'playlist:remove', label: '删除播放列表', iconSvg: menuIcons.remove, enabled: !playlist.isLocked },
  ], event)
  if (action === 'playlist:open') await player.selectActivePlaylist(playlist.index)
  if (action === 'playlist:play') await player.playPlaylist(playlist.index)
  if (action === 'playlist:shuffle') await player.playPlaylist(playlist.index, true)
  if (action === 'playlist:duplicate') await player.duplicatePlaylist(playlist.index)
  if (action === 'playlist:undo') await player.undoPlaylistChange(playlist.index)
  if (action === 'playlist:sort-title') await player.sortPlaylist(playlist.index, '%title%')
  if (action === 'playlist:sort-album') await player.sortPlaylist(playlist.index, '%album artist%|%date%|%album%|%discnumber%|%tracknumber%')
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

async function openAppMenu(event: MouseEvent) {
  if (event.defaultPrevented || !state.connected) return
  event.preventDefault()
  const action = await openPopup([
    { id: 'app:search', label: '搜索音乐库', iconSvg: menuIcons.search },
    { type: 'separator' },
    { id: 'app:refresh', label: '刷新音乐库', iconSvg: menuIcons.refresh },
    { id: 'app:rescan', label: '重新扫描音乐库', iconSvg: menuIcons.refresh },
    { id: 'app:preferences', label: '首选项', iconSvg: menuIcons.settings },
  ], event)
  if (action === 'app:search') document.querySelector<HTMLInputElement>('.topbar-search input')?.focus()
  if (action === 'app:refresh') await player.refreshLibrary()
  if (action === 'app:rescan') await player.rescanLibrary()
  if (action === 'app:preferences') await player.showPreferences()
}

async function runTrackAction(action: () => Promise<unknown>) {
  trackMenu.open = false
  await action()
}

async function handlePlayTrack(track: DisplayTrack, index?: number) {
  await player.playTrack(track, index)
}

function onDragEnter(event: DragEvent) {
  if (!state.connected || !state.dndSupported) return
  event.preventDefault()
  dragState.depth += 1
  dragState.active = true
}

function onDragOver(event: DragEvent) {
  if (!state.connected || !state.dndSupported) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(event: DragEvent) {
  if (!state.connected || !state.dndSupported) return
  event.preventDefault()
  dragState.depth = Math.max(0, dragState.depth - 1)
  if (!dragState.depth) dragState.active = false
}

function onDrop(event: DragEvent) {
  if (!state.connected || !state.dndSupported) return
  event.preventDefault()
  dragState.depth = 0
  dragState.active = false
}
</script>

<template>
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
    @close="player.closeWindow"
  />
  <div v-else class="app-shell" @contextmenu="openAppMenu" @dblclick.stop.prevent>
    <AppSidebar
      :view="state.view"
      :playlists="state.playlists"
      :active-playlist="state.browsingPlaylist ?? state.activePlaylist"
      :search="state.search"
      @navigate="navigatePrimary"
      @playlist="selectPrimaryPlaylist"
      @search="player.setSearch"
      @submit-search="submitPrimarySearch"
      @playlist-menu="openPlaylistMenu"
      @create-playlist="state.dialog = 'createPlaylist'"
      @favourites="showFavourites"
    />

    <div class="workspace">
      <AppTopbar
        :connected="state.connected"
        :search="state.search"
        :can-go-back="state.canGoBack"
        :can-go-forward="state.canGoForward"
        :output-devices="outputDevices"
        :output-loading="outputLoading"
        :connection-label="connectionLabel"
        :connection-transitioning="connectionTransitioning"
        :library-scanning="state.libraryStatus.scanning === true"
        @search="player.setSearch"
        @submit-search="submitPrimarySearch"
        @clear-search="clearPrimarySearch"
        @back="goBackPrimary"
        @forward="goForwardPrimary"
        @refresh="player.refreshLibrary"
        @preferences="player.showPreferences"
        @fullscreen="player.toggleFullscreen"
        @reload="player.reloadInterface"
        @rescan="player.rescanLibrary"
        @load-output-devices="loadOutputDevices"
        @select-output-device="selectOutputDevice"
        @desktop-lyrics="player.toggleDesktopLyrics"
        @mini-player="player.openMiniPlayer"
      />
      <div class="workspace-scroll">
        <LibraryView
          :view="state.view"
          :albums="filteredAlbums"
          :tracks="state.visibleTracks"
          :current-track="state.currentTrack"
          :active-playlist="state.browsingPlaylist ?? state.activePlaylist"
          :selected-album="state.selectedAlbum"
          :is-playing="state.isPlaying"
          :loading="state.loading"
          :search="state.search"
          :search-loading="state.searchLoading"
          :importing="state.importing"
          :library-filters="state.libraryFilters"
          :filter-options="libraryFilterOptions"
          :custom-column="state.customColumn"
          @navigate="navigatePrimary"
          @back="goBackPrimary"
          @open-album="openPrimaryAlbum"
          @play-album="player.playAlbum"
          @play-track="handlePlayTrack"
          @shuffle="player.shuffleCurrent"
          @track-menu="openTrackMenu"
          @album-menu="openAlbumMenu"
          @open-files="player.openFiles"
          @open-folder="player.openFolder"
          @clear-search="clearPrimarySearch"
          @selection="selectedTracks = $event"
          @filter-change="player.setLibraryFilter"
          @clear-filters="player.clearLibraryFilters"
          @reorder="player.reorderPlaylistTrack"
          @custom-column="player.applyCustomColumn"
        />
      </div>
    </div>

    <NowPlayingPanel
      :open="state.nowPlayingOpen"
      :track="state.currentTrack"
      :artwork="state.currentArtwork"
      :is-playing="state.isPlaying"
      :playback-state="state.playbackState"
      :can-seek="state.canSeek"
      :position="state.position"
      :duration="state.duration"
      :lyrics="state.lyrics"
      :lyrics-synced="state.lyricsSynced"
      :queue="state.queue"
      :history="state.playbackHistory"
      @close="player.closeNowPlaying"
      @toggle="player.togglePlayback"
      @seek="player.seek"
      @seek-resume="player.seekAndPlay"
      @favourite="player.toggleFavourite"
      @play-queue="player.playQueueItem"
      @play-history="player.playHistoryTrack"
    />

    <Transition name="queue-card">
      <QueuePopover
        v-if="queueOpen"
        :queue="state.queue"
        :playback-order="state.playbackOrder"
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
      :now-playing-open="state.nowPlayingOpen"
      :queue-open="queueOpen"
      @toggle="player.togglePlayback"
      @next="player.next"
      @previous="player.previous"
      @seek="player.seek"
      @volume="player.setVolume"
      @mute="player.toggleMute"
      @order="player.cyclePlaybackOrder"
      @immersive="openNowPlaying"
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
      :connected="state.connected"
      :x="trackMenu.x"
      :y="trackMenu.y"
      @close="trackMenu.open = false"
      @play="runTrackAction(() => handlePlayTrack(trackMenu.track!, trackMenu.index))"
      @play-next="runTrackAction(() => player.playNext(trackMenu.track!))"
      @queue="runTrackAction(() => player.addToQueue(trackMenu.track!))"
      @playlist="runTrackAction(() => player.addToPlaylist(trackMenu.track!, $event))"
      @favourite="runTrackAction(() => player.toggleFavourite(trackMenu.track!))"
      @album="runTrackAction(() => player.openTrackAlbum(trackMenu.track!))"
      @location="runTrackAction(() => player.showInExplorer(trackMenu.track!))"
      @remove="runTrackAction(() => player.removePlaylistTrack(trackMenu.track!, trackMenu.index))"
      @properties="runTrackAction(() => openInspector('properties', [trackMenu.track!]))"
      @edit-metadata="runTrackAction(() => openInspector('edit', [trackMenu.track!]))"
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
      @save="saveInspectorMetadata"
      @rating="setInspectorRating"
      @scan-replay-gain="scanInspectorReplayGain"
      @clear-replay-gain="clearInspectorReplayGain"
      @embed-artwork="embedInspectorArtwork"
      @remove-artwork="removeInspectorArtwork"
    />

    <FileOperationDialog v-if="fileDialog.open && fileDialog.track" :track="fileDialog.track" :mode="fileDialog.mode" :target="fileDialog.target" :busy="fileDialog.busy" @close="fileDialog.open = false" @rename="renameFile" @move="confirmMoveFile" @delete="deleteFile" />

    <Transition name="drop-overlay">
      <div v-if="dragState.active" class="drop-overlay">
        <div><FileMusic :size="34" /><strong>拖放以打开音乐</strong><span>文件和文件夹将添加到“已打开的音乐”。</span></div>
      </div>
    </Transition>

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
