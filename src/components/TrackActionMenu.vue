<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, Disc3, Edit3, FolderOpen, Heart, Info, ListEnd, ListPlus, ListStart, Play, Trash2, X } from '@lucide/vue'
import type { DisplayTrack, ViewId } from '../types/music'
import type { PlaylistInfo } from 'foo-webview-sdk'
import ArtworkImage from './ArtworkImage.vue'

const props = defineProps<{
  track: DisplayTrack
  index: number
  view: ViewId
  activePlaylist: PlaylistInfo | null
  playlists: PlaylistInfo[]
  batch: boolean
  trackCount: number
  connected: boolean
  x: number
  y: number
}>()

const position = computed(() => ({
  left: `${Math.max(10, Math.min(props.x, globalThis.innerWidth - 318))}px`,
  top: `${Math.max(10, Math.min(props.y, globalThis.innerHeight - 560))}px`,
}))

const playlistsOpen = ref(false)

const emit = defineEmits<{
  close: []
  play: []
  playNext: []
  queue: []
  playlist: [index: number]
  favourite: []
  album: []
  location: []
  remove: []
  properties: []
  editMetadata: []
}>()
</script>

<template>
  <div class="track-menu-scrim" @mousedown="emit('close')">
    <div class="track-action-menu" :style="position" @mousedown.stop>
      <header class="track-action-menu__header">
        <ArtworkImage :src="track.artworkUrl" :alt="`${track.album} 封面`" />
        <div><strong>{{ batch ? `已选择 ${trackCount} 首曲目` : track.title }}</strong><small>{{ batch ? '批量操作' : `${track.artist} · ${track.album}` }}</small></div>
        <button aria-label="关闭" @click="emit('close')"><X :size="15" /></button>
      </header>
      <div v-if="!batch" class="track-action-menu__group">
        <button @click="emit('play')"><Play :size="16" /><span>立即播放</span><kbd>Enter</kbd></button>
        <button @click="emit('playNext')"><ListStart :size="16" /><span>下一首播放</span></button>
        <button @click="emit('queue')"><ListEnd :size="16" /><span>添加到队列</span></button>
      </div>
      <div v-else class="track-action-menu__group">
        <button @click="emit('queue')"><ListEnd :size="16" /><span>将 {{ trackCount }} 首曲目添加到队列</span></button>
      </div>
      <div class="track-action-menu__group">
        <button v-if="!batch" @click="emit('favourite')"><Heart :size="16" :fill="track.isFavourite ? 'currentColor' : 'none'" /><span>{{ track.isFavourite ? '取消收藏' : '添加到收藏' }}</span></button>
        <button :disabled="!playlists.length" @click="playlistsOpen = !playlistsOpen"><ListPlus :size="16" /><span>{{ batch ? `将 ${trackCount} 首曲目添加到播放列表` : '添加到播放列表' }}</span><ChevronRight :size="15" :class="{ rotated: playlistsOpen }" /></button>
        <div v-if="playlistsOpen" class="track-action-menu__playlists">
          <button v-for="playlist in playlists" :key="playlist.index" :disabled="playlist.isLocked || playlist.isAutoplaylist" @click="emit('playlist', playlist.index)">
            <span>{{ playlist.name }}</span><small>{{ playlist.trackCount }} 首</small>
          </button>
        </div>
      </div>
      <div class="track-action-menu__group">
        <button @click="emit('properties')"><Info :size="16" /><span>属性</span></button>
        <button :disabled="!connected" @click="emit('editMetadata')"><Edit3 :size="16" /><span>编辑标签</span></button>
        <button v-if="!batch" @click="emit('album')"><Disc3 :size="16" /><span>前往专辑</span></button>
        <button v-if="!batch" :disabled="!connected || !track.path" @click="emit('location')"><FolderOpen :size="16" /><span>显示文件位置</span></button>
      </div>
      <div v-if="view === 'playlist' && index >= 0" class="track-action-menu__group">
        <button class="danger" @click="emit('remove')"><Trash2 :size="16" /><span>{{ batch ? `从“${activePlaylist?.name ?? '播放列表'}”移除 ${trackCount} 首曲目` : `从“${activePlaylist?.name ?? '播放列表'}”移除` }}</span></button>
      </div>
    </div>
  </div>
</template>
