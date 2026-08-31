<script setup lang="ts">
import { Album, BarChart3, Folder, Heart, Home, ListMusic, Music2, Plus, Search, Smartphone, Users } from '@lucide/vue'
import type { PlaylistInfo } from 'foo-webview-sdk'
import type { ViewId } from '../types/music'
import foobarLogo from '../assets/foobar2000.png'

defineProps<{
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
}>()
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
          :class="{ active: view === 'playlist' && activePlaylist?.index === playlist.index }"
          @click="emit('playlist', playlist.index)"
          @contextmenu.prevent.stop="emit('playlistMenu', playlist, $event)"
        >
          <ListMusic :size="16" />
          <span>{{ playlist.name }}</span>
        </button>
      </nav>
    </div>

    <div class="sidebar-spacer" />
    <div class="sidebar-shortcuts">
      <button :class="{ active: view === 'favourites' }" @click="emit('favourites')"><Heart :size="17" /><span>收藏</span></button>
    </div>
  </aside>
</template>
