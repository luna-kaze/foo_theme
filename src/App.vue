<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'
import { AlertCircle, CheckCircle2, FileMusic, Info } from '@lucide/vue'
import AppSidebar from './components/AppSidebar.vue'
import AppTopbar from './components/AppTopbar.vue'
import CreatePlaylistDialog from './components/CreatePlaylistDialog.vue'
import LibraryView from './components/LibraryView.vue'
import NowPlayingPanel from './components/NowPlayingPanel.vue'
import PlayerBar from './components/PlayerBar.vue'
import TrackActionMenu from './components/TrackActionMenu.vue'
import { useFoobar } from './composables/useFoobar'
import type { PlaylistInfo } from 'foo-webview-sdk'
import type { AlbumCard, DisplayTrack, ViewId } from './types/music'
import { menuIcons, showContextMenu, type ContextMenuItem } from './utils/contextMenu'
import { isSameTrack } from './utils/track'

const player = useFoobar()
const { state, filteredAlbums } = player
const trackMenu = reactive({ open: false, track: null as DisplayTrack | null, index: -1, x: 0, y: 0 })
const dragState = reactive({ active: false, depth: 0 })

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const editing = target?.matches('input, textarea, [contenteditable="true"]')

  if (event.ctrlKey && event.key.toLocaleLowerCase() === 'k') {
    event.preventDefault()
    document.querySelector<HTMLInputElement>('.topbar-search input')?.focus()
    return
  }
  if (event.key === 'Escape') {
    state.nowPlayingOpen = false
    state.dialog = null
    trackMenu.open = false
    return
  }
  if (editing) return
  if (event.code === 'Space') {
    event.preventDefault()
    void player.togglePlayback()
  }
  if (event.key === 'MediaPlayPause') void player.togglePlayback()
  if (event.key === 'MediaTrackNext') void player.next()
  if (event.key === 'MediaTrackPrevious') void player.previous()
}

onMounted(() => {
  void player.initialize()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
  player.dispose()
})

function openNowPlaying(tab: 'lyrics' | 'queue') {
  if (state.nowPlayingOpen && state.nowPlayingTab !== tab) {
    state.nowPlayingTab = tab
    return
  }
  player.toggleNowPlaying(tab)
}

function closeSecondaryUi() {
  state.nowPlayingOpen = false
  state.dialog = null
  trackMenu.open = false
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

function showRadio() {
  closeSecondaryUi()
  void player.loadRadio()
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

function playlistSubmenu(prefix: string): ContextMenuItem[] {
  return state.playlists.slice(0, 80).map((playlist) => ({
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
  if (state.connected) {
    trackMenu.open = false
    try {
      const items: ContextMenuItem[] = [
        { id: 'track:album', type: 'nowplaying', cover: track.artworkUrl, title: track.title, subtitle: `${track.artist} · ${track.album}` },
        { type: 'separator' },
        { id: 'track:play', label: '立即播放', iconSvg: menuIcons.play },
        { id: 'track:next', label: '下一首播放', iconSvg: menuIcons.next },
        { id: 'track:queue', label: '添加到队列', iconSvg: menuIcons.queue },
        { type: 'separator' },
        { id: 'track:favourite', label: Number(track.rating ?? 0) > 0 ? '取消收藏' : '添加到收藏', checked: Number(track.rating ?? 0) > 0, iconSvg: menuIcons.heart },
        { id: 'track:playlist', label: '添加到播放列表', iconSvg: menuIcons.playlist, enabled: state.playlists.length > 0, submenu: playlistSubmenu('track:playlist') },
        { type: 'separator' },
        { id: 'track:album', label: '前往专辑', iconSvg: menuIcons.album },
        { id: 'track:location', label: '显示文件位置', iconSvg: menuIcons.folder, enabled: Boolean(track.path) },
      ]
      if (state.view === 'playlist') {
        items.push({ type: 'separator' }, { id: 'track:remove', label: `从“${state.activePlaylist?.name ?? '播放列表'}”移除`, iconSvg: menuIcons.remove })
      }
      const action = await openPopup(items, event)
      if (!action) return
      if (action === 'track:play') await handlePlayTrack(track, index)
      if (action === 'track:next') await player.playNext(track)
      if (action === 'track:queue') await player.addToQueue(track)
      if (action === 'track:favourite') await player.toggleFavourite(track)
      if (action === 'track:album') await player.openTrackAlbum(track)
      if (action === 'track:location') await player.showInExplorer(track)
      if (action === 'track:remove') await player.removePlaylistTrack(track, index)
      if (action.startsWith('track:playlist:')) await player.addToPlaylist(track, Number(action.split(':').at(-1)))
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
    { id: 'album:open', type: 'nowplaying', cover: album.artworkUrl, title: album.name, subtitle: `${album.artist}${album.year ? ` · ${album.year}` : ''}` },
    { type: 'separator' },
    { id: 'album:open', label: '打开专辑', iconSvg: menuIcons.album },
    { id: 'album:play', label: '播放专辑', iconSvg: menuIcons.play },
    { id: 'album:shuffle', label: '随机播放专辑', iconSvg: menuIcons.shuffle },
    { id: 'album:queue', label: '将专辑添加到队列', iconSvg: menuIcons.queue },
    { type: 'separator' },
    { id: 'album:playlist', label: '将专辑添加到播放列表', iconSvg: menuIcons.playlist, enabled: state.playlists.length > 0, submenu: playlistSubmenu('album:playlist') },
  ], event)
  if (action === 'album:open') await player.selectAlbum(album)
  if (action === 'album:play') await player.playAlbum(album)
  if (action === 'album:shuffle') await player.shuffleAlbum(album)
  if (action === 'album:queue') await player.queueAlbum(album)
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
    { type: 'separator' },
    { id: 'playlist:clear', label: '清空播放列表', iconSvg: menuIcons.remove, enabled: writable && playlist.trackCount > 0 },
    { id: 'playlist:remove', label: '删除播放列表', iconSvg: menuIcons.remove, enabled: !playlist.isLocked },
  ], event)
  if (action === 'playlist:open') await player.selectActivePlaylist(playlist.index)
  if (action === 'playlist:play') await player.playPlaylist(playlist.index)
  if (action === 'playlist:shuffle') await player.playPlaylist(playlist.index, true)
  if (action === 'playlist:duplicate') await player.duplicatePlaylist(playlist.index)
  if (action === 'playlist:undo') await player.undoPlaylistChange(playlist.index)
  if (action === 'playlist:clear') await player.clearPlaylist(playlist.index)
  if (action === 'playlist:remove') await player.removePlaylist(playlist.index)
}

async function openQueueMenu(index: number, event: MouseEvent) {
  const item = state.queue[index]
  if (!item) return
  const action = await openPopup([
    { id: 'queue:play', type: 'nowplaying', title: item.title, subtitle: `${item.artist} · ${item.album} · ${item.queueSource === 'explicit' ? '播放队列' : '当前播放列表'}` },
    { type: 'separator' },
    { id: 'queue:play', label: '立即播放', iconSvg: menuIcons.play },
    { id: 'queue:top', label: item.queueSource === 'explicit' ? '移到队首' : '设为下一首', iconSvg: menuIcons.next, enabled: item.queueSource === 'playlist' || item.sourceIndex > 0 },
    { id: 'queue:remove', label: '从队列移除', iconSvg: menuIcons.remove, enabled: item.queueSource === 'explicit' },
    { type: 'separator' },
    { id: 'queue:clear', label: '清空队列', iconSvg: menuIcons.remove, enabled: state.queue.some((entry) => entry.queueSource === 'explicit') },
  ], event)
  if (action === 'queue:play') await handlePlayTrack(item)
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
  const current = isSameTrack(state.currentTrack, track)
  if (current && state.isPlaying) await player.togglePlayback()
  else await player.playTrack(track, index)
}

function onDragEnter(event: DragEvent) {
  if (!state.connected) return
  event.preventDefault()
  dragState.depth += 1
  dragState.active = true
}

function onDragOver(event: DragEvent) {
  if (!state.connected) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(event: DragEvent) {
  if (!state.connected) return
  event.preventDefault()
  dragState.depth = Math.max(0, dragState.depth - 1)
  if (!dragState.depth) dragState.active = false
}

function onDrop(event: DragEvent) {
  if (!state.connected) return
  event.preventDefault()
  dragState.depth = 0
  dragState.active = false
}
</script>

<template>
  <div class="app-shell" @contextmenu="openAppMenu">
    <AppSidebar
      :view="state.view"
      :playlists="state.playlists"
      :active-playlist="state.activePlaylist"
      :search="state.search"
      :importing="state.importing"
      @navigate="navigatePrimary"
      @playlist="selectPrimaryPlaylist"
      @search="player.setSearch"
      @submit-search="submitPrimarySearch"
      @open-files="player.openFiles"
      @playlist-menu="openPlaylistMenu"
      @create-playlist="state.dialog = 'createPlaylist'"
      @favourites="showFavourites"
      @radio="showRadio"
    />

    <div class="workspace">
      <AppTopbar
        :connected="state.connected"
        :search="state.search"
        :can-go-back="state.canGoBack"
        :can-go-forward="state.canGoForward"
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
      />
      <div class="workspace-scroll">
        <LibraryView
          :view="state.view"
          :albums="filteredAlbums"
          :tracks="state.visibleTracks"
          :current-track="state.currentTrack"
          :active-playlist="state.activePlaylist"
          :selected-album="state.selectedAlbum"
          :is-playing="state.isPlaying"
          :loading="state.loading"
          :search="state.search"
          :search-loading="state.searchLoading"
          :importing="state.importing"
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
        />
      </div>
    </div>

    <NowPlayingPanel
      :open="state.nowPlayingOpen"
      :track="state.currentTrack"
      :artwork="state.currentArtwork"
      :is-playing="state.isPlaying"
      :position="state.position"
      :duration="state.duration"
      :lyrics="state.lyrics"
      :lyrics-synced="state.lyricsSynced"
      :queue="state.queue"
      :tab="state.nowPlayingTab"
      @close="player.closeNowPlaying"
      @toggle="player.togglePlayback"
      @next="player.next"
      @previous="player.previous"
      @seek="player.seek"
      @tab="state.nowPlayingTab = $event"
      @favourite="player.toggleFavourite"
      @play-queue="state.queue[$event] && handlePlayTrack(state.queue[$event])"
      @remove-queue="player.removeQueueItem"
      @move-queue="player.moveQueueItemToTop"
      @clear-queue="player.clearQueue"
      @queue-menu="openQueueMenu"
    />

    <PlayerBar
      :track="state.currentTrack"
      :artwork="state.currentArtwork"
      :is-playing="state.isPlaying"
      :position="state.position"
      :duration="state.duration"
      :volume="state.volume"
      :muted="state.muted"
      :playback-order="state.playbackOrder"
      :now-playing-open="state.nowPlayingOpen"
      @toggle="player.togglePlayback"
      @next="player.next"
      @previous="player.previous"
      @seek="player.seek"
      @volume="player.setVolume"
      @mute="player.toggleMute"
      @order="player.cyclePlaybackOrder"
      @now-playing="openNowPlaying"
      @menu="(track, event) => openTrackMenu(track, -1, event)"
    />

    <CreatePlaylistDialog
      v-if="state.dialog === 'createPlaylist'"
      @close="state.dialog = null"
      @create="player.createPlaylist"
    />

    <TrackActionMenu
      v-if="trackMenu.open && trackMenu.track"
      :track="trackMenu.track"
      :index="trackMenu.index"
      :view="state.view"
      :active-playlist="state.activePlaylist"
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
    />

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
