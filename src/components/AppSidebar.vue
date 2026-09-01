<script setup lang="ts">
import { Album, BarChart3, Folder, GripVertical, Heart, Home, ListMusic, Music2, Plus, Search, Smartphone, Users } from '@lucide/vue'
import { computed, onBeforeUnmount, ref } from 'vue'
import type { PlaylistInfo } from 'foo-webview-sdk'
import type { ViewId } from '../types/music'
import foobarLogo from '../assets/foobar2000.png'

const props = defineProps<{
  view: ViewId
  playlists: PlaylistInfo[]
  activePlaylist: PlaylistInfo | null
  search: string
  ipodAvailable: boolean
}>()

const emit = defineEmits<{
  navigate: [view: ViewId]
  playlist: [index: number]
  search: [value: string]
  submitSearch: []
  createPlaylist: []
  favourites: []
  playlistMenu: [playlist: PlaylistInfo, event: MouseEvent]
  reorderPlaylists: [order: number[]]
}>()

const draggingPlaylist = ref<PlaylistInfo | null>(null)
const dragX = ref(0)
const dragY = ref(0)
const dragOffsetX = ref(0)
const dragOffsetY = ref(0)
const dropIndex = ref(-1)
const dropAfter = ref(false)
const dropIndicator = ref({ left: 0, top: 0, width: 0, visible: false })
const previewStyle = computed(() => ({
  width: '260px',
  transform: `translate3d(${Math.max(10, dragX.value - dragOffsetX.value)}px, ${dragY.value - dragOffsetY.value}px, 0)`,
}))
const indicatorStyle = computed(() => ({
  left: `${dropIndicator.value.left}px`,
  top: `${dropIndicator.value.top}px`,
  width: `${dropIndicator.value.width}px`,
}))
let playlistNav: HTMLElement | null = null
let suppressPlaylistClick = false

function stopPlaylistDrag() {
  window.removeEventListener('pointermove', updatePlaylistDrag)
  window.removeEventListener('pointerup', finishPlaylistDrag)
  draggingPlaylist.value = null
  dropIndicator.value.visible = false
  playlistNav = null
}

function updatePlaylistDrag(event: PointerEvent) {
  event.preventDefault()
  dragX.value = event.clientX
  dragY.value = event.clientY
  if (!playlistNav) return
  const previewTop = event.clientY - dragOffsetY.value
  const rows = [...playlistNav.querySelectorAll<HTMLElement>('.playlist-nav__item[data-playlist-index]')]
  const row = rows.find((item) => previewTop < item.getBoundingClientRect().bottom)
  const target = row ?? rows.at(-1)
  if (!target) return
  const index = Number(target.dataset.playlistIndex)
  if (!Number.isInteger(index) || index < 0) return
  const bounds = target.getBoundingClientRect()
  dropIndex.value = index
  dropAfter.value = !row
  dropIndicator.value = { left: bounds.left + 8, top: row ? bounds.top : bounds.bottom, width: Math.max(0, bounds.width - 16), visible: true }
}

function finishPlaylistDrag() {
  const dragged = draggingPlaylist.value
  const targetIndex = dropIndex.value
  const after = dropAfter.value
  stopPlaylistDrag()
  if (!dragged || targetIndex < 0) return
  const order = props.playlists.map((playlist) => playlist.index)
  const from = order.indexOf(dragged.index)
  const targetPosition = order.indexOf(targetIndex)
  if (from < 0 || targetPosition < 0) return
  let destination = targetPosition + (after ? 1 : 0)
  const [moved] = order.splice(from, 1)
  if (from < destination) destination -= 1
  order.splice(destination, 0, moved)
  if (order.every((index, position) => index === props.playlists[position]?.index)) return
  suppressPlaylistClick = true
  window.setTimeout(() => { suppressPlaylistClick = false }, 0)
  emit('reorderPlaylists', order)
}

function beginPlaylistDrag(playlist: PlaylistInfo, event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  draggingPlaylist.value = playlist
  dragX.value = event.clientX
  dragY.value = event.clientY
  const row = (event.currentTarget as Element).closest<HTMLElement>('.playlist-nav__item')
  const bounds = row?.getBoundingClientRect()
  if (bounds) {
    dragOffsetX.value = event.clientX - bounds.left
    dragOffsetY.value = event.clientY - bounds.top
  }
  playlistNav = row?.closest<HTMLElement>('.playlist-nav') ?? null
  window.addEventListener('pointermove', updatePlaylistDrag)
  window.addEventListener('pointerup', finishPlaylistDrag)
  updatePlaylistDrag(event)
}

function selectPlaylist(index: number, event: MouseEvent) {
  if (suppressPlaylistClick) {
    event.preventDefault()
    return
  }
  emit('playlist', index)
}

onBeforeUnmount(stopPlaylistDrag)
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand__mark"><img :src="foobarLogo" alt="" draggable="false" /></span>
      <span class="brand__name">foobar2000</span>
    </div>

    <form class="sidebar-search" role="search" @submit.prevent="emit('submitSearch')">
      <button type="submit" aria-label="搜索音乐库"><Search :size="15" /></button>
      <input type="search" placeholder="搜索音乐库" :value="search" @input="emit('search', ($event.target as HTMLInputElement).value)" />
    </form>

    <nav class="sidebar-nav" aria-label="主导航">
      <button :class="{ active: view === 'home' }" @click="emit('navigate', 'home')">
        <Home :size="18" />
        <span>主页</span>
      </button>
      <p class="sidebar-nav__label">媒体库</p>
      <button :class="{ active: view === 'overview' }" @click="emit('navigate', 'overview')">
        <BarChart3 :size="18" />
        <span>概览</span>
      </button>
      <button :class="{ active: view === 'artists' || view === 'artist' }" @click="emit('navigate', 'artists')">
        <Users :size="18" />
        <span>艺术家</span>
      </button>
      <button :class="{ active: view === 'albums' || view === 'album' }" @click="emit('navigate', 'albums')">
        <Album :size="18" />
        <span>专辑</span>
      </button>
      <button :class="{ active: view === 'songs' }" @click="emit('navigate', 'songs')">
        <Music2 :size="18" />
        <span>歌曲</span>
      </button>
      <button :class="{ active: view === 'folders' || view === 'folder' }" @click="emit('navigate', 'folders')">
        <Folder :size="18" />
        <span>文件夹</span>
      </button>
      <template v-if="ipodAvailable">
        <p class="sidebar-nav__label">设备</p>
        <button :class="{ active: view === 'ipod' }" @click="emit('navigate', 'ipod')">
          <Smartphone :size="18" />
          <span>iPod</span>
        </button>
      </template>
    </nav>

    <div class="sidebar-section">
      <div class="sidebar-section__title">
        <span>播放列表</span>
        <button aria-label="新建播放列表" @click="emit('createPlaylist')"><Plus :size="15" /></button>
      </div>
      <nav class="playlist-nav" aria-label="播放列表">
        <button
          v-for="playlist in playlists"
          :key="playlist.index"
          class="playlist-nav__item"
          :data-playlist-index="playlist.index"
          :data-playlist-name="playlist.name"
          :class="{ active: view === 'playlist' && activePlaylist?.index === playlist.index }"
          @click="selectPlaylist(playlist.index, $event)"
          @contextmenu.prevent.stop="emit('playlistMenu', playlist, $event)"
        >
          <ListMusic :size="16" />
          <span>{{ playlist.name }}</span>
          <GripVertical class="playlist-nav__drag-handle" :size="15" aria-label="拖动排序" @pointerdown.stop="beginPlaylistDrag(playlist, $event)" />
        </button>
      </nav>
    </div>

    <div class="sidebar-spacer" />
    <div class="sidebar-shortcuts">
      <button :class="{ active: view === 'favourites' }" @click="emit('favourites')"><Heart :size="17" /><span>收藏</span></button>
    </div>
    <Teleport to="body">
      <div v-if="dropIndicator.visible" class="playlist-drop-indicator" :style="indicatorStyle"><i /></div>
      <Transition name="playlist-drag-preview">
        <div v-if="draggingPlaylist" class="playlist-drag-preview" :style="previewStyle"><GripVertical :size="15" /><ListMusic :size="16" /><span>{{ draggingPlaylist.name }}</span></div>
      </Transition>
    </Teleport>
  </aside>
</template>
