<script setup lang="ts">
import { computed, ref } from 'vue'
import { Album, Clock3, Folder, Grid3X3, HardDrive, Library, ListTree, Music2, Play, Shuffle, Users } from '@lucide/vue'
import type { ArtistInfo, LibraryStats } from 'foo-webview-sdk'
import type { AlbumCard, ArtistCard, DisplayTrack, LibraryFolderCard, ViewId, ViewRoute } from '../types/music'
import AlbumGrid from './AlbumGrid.vue'
import AlphabetIndexRail from './AlphabetIndexRail.vue'
import TrackList from './TrackList.vue'
import { useAlphabetGroups, useAlphabetNavigation } from '../utils/alphabetIndex'
import { animateLayoutReorder } from '../utils/layoutTransition'

const props = defineProps<{
  route: ViewRoute
  stats: LibraryStats
  artists: ArtistCard[]
  folders: LibraryFolderCard[]
  albums: AlbumCard[]
  tracks: DisplayTrack[]
  currentTrack: DisplayTrack | null
  isPlaying: boolean
  loading: boolean
  folderSelectionMode: boolean
  selectedFolderIds: string[]
  alphabetIndexView: boolean
  dragActive?: boolean
}>()

const emit = defineEmits<{
  navigate: [view: ViewId]
  artist: [name: string]
  artistMenu: [artist: ArtistInfo, event: MouseEvent]
  folder: [folder: LibraryFolderCard]
  folderMenu: [folder: LibraryFolderCard, event: MouseEvent]
  folderSelection: [folder: LibraryFolderCard, selected: boolean]
  cancelFolderSelection: []
  openAlbum: [album: AlbumCard]
  albumMenu: [album: AlbumCard, event: MouseEvent]
  playTrack: [track: DisplayTrack, index: number]
  trackMenu: [track: DisplayTrack, index: number, event: MouseEvent]
  addToPlaylist: [tracks: DisplayTrack[], playlistIndex: number]
  insertIntoPlaylist: [tracks: DisplayTrack[], sourcePlaylistIndex: number | null, destinationPlaylistIndex: number, targetIndex: number, after: boolean, move: boolean]
  playlistHover: [playlistIndex: number | null]
  dragState: [active: boolean]
  addToIpod: [tracks: DisplayTrack[]]
  selection: [tracks: DisplayTrack[]]
  shuffle: []
  back: []
  alphabetIndexView: [enabled: boolean]
}>()

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const days = Math.floor(hours / 24)
  return days ? `${days} 天 ${hours % 24} 小时` : `${hours} 小时`
}

function formatSize(bytes: number) {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`
}

const artistArtwork = computed(() => {
  const artwork: Record<string, string> = {}
  props.albums.forEach((album) => {
    if (!artwork[album.artist] && album.artworkUrl) artwork[album.artist] = album.artworkUrl
  })
  return artwork
})
const artistGroups = useAlphabetGroups(() => props.artists, (artist) => artist.name, (artist) => artist.sortName ?? '')
const orderedArtists = computed(() => artistGroups.value.flatMap((group) => group.items))
const artistLetters = computed(() => artistGroups.value.map((group) => group.letter))
const { activeLetter: activeArtistLetter, registerGroup: registerArtistGroup, jumpToLetter: jumpToArtistLetter } = useAlphabetNavigation()
const viewRoot = ref<HTMLElement | null>(null)
const layoutAnimating = ref(false)

async function toggleAlphabetIndexView() {
  if (layoutAnimating.value) return
  layoutAnimating.value = true
  try {
    await animateLayoutReorder(viewRoot.value, () => emit('alphabetIndexView', !props.alphabetIndexView))
  } finally {
    layoutAnimating.value = false
  }
}

function folderId(folder: LibraryFolderCard) {
  return `${folder.rootId}\u0000${folder.pathId}`
}

function isFolderSelected(folder: LibraryFolderCard) {
  return props.selectedFolderIds.includes(folderId(folder))
}

function openFolder(folder: LibraryFolderCard) {
  if (props.folderSelectionMode) emit('folderSelection', folder, !isFolderSelected(folder))
  else emit('folder', folder)
}
</script>

<template>
  <main ref="viewRoot" class="library-view media-library-view">
    <div v-if="loading" class="library-loading"><span /><span /><span /><small>正在整理媒体库…</small></div>

    <template v-else-if="route.view === 'overview'">
      <section class="page-heading"><p class="eyebrow">媒体库</p><h1>概览</h1><p>从收藏规模、播放时长和最近添加快速进入你的音乐。</p></section>
      <section class="library-stat-grid">
        <button @click="emit('navigate', 'songs')"><span><Music2 :size="19" /></span><strong>{{ stats.totalTracks.toLocaleString() }}</strong><small>首歌曲</small></button>
        <button @click="emit('navigate', 'albums')"><span><Album :size="19" /></span><strong>{{ stats.totalAlbums.toLocaleString() }}</strong><small>张专辑</small></button>
        <button @click="emit('navigate', 'artists')"><span><Users :size="19" /></span><strong>{{ stats.totalArtists.toLocaleString() }}</strong><small>位艺术家</small></button>
        <div><span><Clock3 :size="19" /></span><strong>{{ formatDuration(stats.totalDuration) }}</strong><small>总播放时长</small></div>
        <div><span><HardDrive :size="19" /></span><strong>{{ formatSize(stats.totalSize) }}</strong><small>媒体文件大小</small></div>
      </section>
      <section class="content-section">
        <div class="section-heading"><div><p class="eyebrow">音乐收藏</p><h2>专辑速览</h2></div><button @click="emit('navigate', 'albums')">查看全部</button></div>
        <AlbumGrid :albums="albums" :limit="6" @open="emit('openAlbum', $event)" @menu="(album, event) => emit('albumMenu', album, event)" />
      </section>
      <section class="content-section content-section--tracks">
        <div class="section-heading"><div><p class="eyebrow">最近添加</p><h2>新入库曲目</h2></div><button @click="emit('navigate', 'songs')">管理歌曲</button></div>
        <TrackList v-show="tracks.length || dragActive" :tracks="tracks.slice(0, 10)" :current-track="currentTrack" :is-playing="isPlaying" @play="(track, index) => emit('playTrack', track, index)" @menu="(track, index, event) => emit('trackMenu', track, index, event)" @selection="emit('selection', $event)" @add-to-playlist="(selected, playlistIndex) => emit('addToPlaylist', selected, playlistIndex)" @insert-into-playlist="(selected, sourcePlaylistIndex, destinationPlaylistIndex, targetIndex, after, move) => emit('insertIntoPlaylist', selected, sourcePlaylistIndex, destinationPlaylistIndex, targetIndex, after, move)" @playlist-hover="emit('playlistHover', $event)" @drag-state="emit('dragState', $event)" @add-to-ipod="emit('addToIpod', $event)" />
      </section>
    </template>

    <template v-else-if="route.view === 'artists'">
      <section class="page-heading page-heading--row"><div><p class="eyebrow">媒体库</p><h1>艺术家</h1><p>共 {{ artists.length }} 位艺术家，点按卡片查看其全部曲目。</p></div><button class="secondary-button view-mode-toggle" :class="{ active: alphabetIndexView, 'is-animating': layoutAnimating }" :disabled="layoutAnimating" @click="toggleAlphabetIndexView"><span class="view-mode-toggle__icon"><ListTree :class="{ visible: alphabetIndexView }" :size="16" /><Grid3X3 :class="{ visible: !alphabetIndexView }" :size="16" /></span>{{ alphabetIndexView ? '索引视图' : '网格视图' }}</button></section>
      <div v-if="alphabetIndexView" class="alphabet-browser">
        <div class="alphabet-browser__groups">
          <section v-for="group in artistGroups" :key="group.letter" :ref="(element) => registerArtistGroup(group.letter, element)" class="alphabet-group">
            <header class="alphabet-group__heading" data-layout-chrome="heading"><strong>{{ group.letter }}</strong><span /></header>
            <div class="library-card-grid">
              <button v-for="artist in group.items" :key="artist.name" class="artist-browser-card" :data-layout-key="`artist:${artist.name}`" @click="emit('artist', artist.name)" @contextmenu.prevent.stop="emit('artistMenu', artist, $event)">
                <span class="artist-browser-card__art" :style="artistArtwork[artist.name] ? { backgroundImage: `url(${artistArtwork[artist.name]})` } : {}"><i v-if="!artistArtwork[artist.name]">{{ artist.name.slice(0, 1).toLocaleUpperCase() }}</i></span>
                <strong>{{ artist.name }}</strong><small>{{ artist.trackCount }} 首曲目 · {{ artist.albumCount }} 张专辑</small>
              </button>
            </div>
          </section>
        </div>
        <AlphabetIndexRail data-layout-chrome="rail" :available="artistLetters" :active="activeArtistLetter" @select="jumpToArtistLetter" />
      </div>
      <section v-else class="library-card-grid">
        <button v-for="artist in orderedArtists" :key="artist.name" class="artist-browser-card" :data-layout-key="`artist:${artist.name}`" @click="emit('artist', artist.name)" @contextmenu.prevent.stop="emit('artistMenu', artist, $event)">
          <span class="artist-browser-card__art" :style="artistArtwork[artist.name] ? { backgroundImage: `url(${artistArtwork[artist.name]})` } : {}"><i v-if="!artistArtwork[artist.name]">{{ artist.name.slice(0, 1).toLocaleUpperCase() }}</i></span>
          <strong>{{ artist.name }}</strong><small>{{ artist.trackCount }} 首曲目 · {{ artist.albumCount }} 张专辑</small>
        </button>
      </section>
    </template>

    <template v-else-if="route.view === 'folders'">
      <section class="page-heading page-heading--row"><div><p class="eyebrow">媒体库</p><h1>{{ folderSelectionMode ? `已选择 ${selectedFolderIds.length} 个文件夹` : '文件夹' }}</h1><p>按 foobar2000 已配置的媒体库根目录浏览。</p></div><button v-if="folderSelectionMode" class="secondary-button" @click="emit('cancelFolderSelection')">退出选择</button></section>
      <section class="library-card-grid library-card-grid--folders">
        <button v-for="folder in folders" :key="folderId(folder)" class="folder-browser-card" :class="{ selected: isFolderSelected(folder), 'selection-mode': folderSelectionMode }" @click="openFolder(folder)" @contextmenu.prevent.stop="emit('folderMenu', folder, $event)"><span><Folder :size="28" /></span><strong>{{ folder.name }}</strong><small>{{ folder.trackCount }} 首曲目</small><code>{{ folder.absolutePath }}</code><label class="folder-browser-card__select" @click.stop><input type="checkbox" :checked="isFolderSelected(folder)" :aria-label="`选择文件夹 ${folder.name}`" @change="emit('folderSelection', folder, ($event.target as HTMLInputElement).checked)"></label></button>
      </section>
    </template>

    <template v-else-if="route.view === 'artist' || route.view === 'folder'">
      <section class="page-heading page-heading--row">
        <div><button class="media-library-back" @click="emit('back')">返回</button><p class="eyebrow">{{ route.view === 'artist' ? '艺术家' : '文件夹' }}</p><h1>{{ route.view === 'artist' ? route.artist : folderSelectionMode ? `已选择 ${selectedFolderIds.length} 个文件夹` : route.name }}</h1><p>{{ tracks.length }} 首曲目<template v-if="route.view === 'folder'"> · {{ folders.length }} 个子文件夹</template></p></div>
        <div class="page-heading__actions"><button v-if="route.view === 'folder' && folderSelectionMode" class="secondary-button" @click="emit('cancelFolderSelection')">退出选择</button><button class="secondary-button" @click="emit('shuffle')"><Shuffle :size="17" />随机播放</button><button v-if="tracks.length" class="round-play" aria-label="播放全部" @click="emit('playTrack', tracks[0], 0)"><Play :size="22" fill="currentColor" /></button></div>
      </section>
      <section v-if="route.view === 'folder' && folders.length" class="content-section media-library-subfolders"><div class="section-heading"><div><p class="eyebrow">当前目录</p><h2>子文件夹</h2></div></div><div class="library-card-grid library-card-grid--folders"><button v-for="folder in folders" :key="folderId(folder)" class="folder-browser-card" :class="{ selected: isFolderSelected(folder), 'selection-mode': folderSelectionMode }" @click="openFolder(folder)" @contextmenu.prevent.stop="emit('folderMenu', folder, $event)"><span><Folder :size="25" /></span><strong>{{ folder.name }}</strong><small>{{ folder.trackCount }} 首曲目</small><label class="folder-browser-card__select" @click.stop><input type="checkbox" :checked="isFolderSelected(folder)" :aria-label="`选择文件夹 ${folder.name}`" @change="emit('folderSelection', folder, ($event.target as HTMLInputElement).checked)"></label></button></div></section>
      <TrackList v-show="tracks.length || dragActive" :tracks="tracks" :current-track="currentTrack" :is-playing="isPlaying" @play="(track, index) => emit('playTrack', track, index)" @menu="(track, index, event) => emit('trackMenu', track, index, event)" @selection="emit('selection', $event)" @add-to-playlist="(selected, playlistIndex) => emit('addToPlaylist', selected, playlistIndex)" @insert-into-playlist="(selected, sourcePlaylistIndex, destinationPlaylistIndex, targetIndex, after, move) => emit('insertIntoPlaylist', selected, sourcePlaylistIndex, destinationPlaylistIndex, targetIndex, after, move)" @playlist-hover="emit('playlistHover', $event)" @drag-state="emit('dragState', $event)" @add-to-ipod="emit('addToIpod', $event)" />
      <div v-if="!tracks.length && !dragActive" class="collection-empty"><Library :size="30" /><strong>这里没有可显示的曲目</strong><span>返回上一级并选择其他艺术家或文件夹。</span></div>
    </template>
  </main>
</template>
