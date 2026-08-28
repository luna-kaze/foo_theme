<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { AudioLines, ChevronLeft, ChevronRight, Maximize, MoreHorizontal, PanelTopOpen, RefreshCw, Search, Settings, ScanSearch, Subtitles, X } from '@lucide/vue'

defineProps<{
  connected: boolean
  search: string
  canGoBack: boolean
  canGoForward: boolean
}>()

const emit = defineEmits<{
  search: [value: string]
  submitSearch: []
  clearSearch: []
  back: []
  forward: []
  refresh: []
  preferences: []
  fullscreen: []
  reload: []
  rescan: []
  outputDevices: [event: MouseEvent]
  desktopLyrics: []
  miniPlayer: []
}>()

const menuOpen = ref(false)
const root = ref<HTMLElement | null>(null)

function run(action: 'refresh' | 'preferences' | 'fullscreen' | 'reload' | 'rescan' | 'desktopLyrics' | 'miniPlayer') {
  if (action === 'refresh') emit('refresh')
  if (action === 'preferences') emit('preferences')
  if (action === 'fullscreen') emit('fullscreen')
  if (action === 'reload') emit('reload')
  if (action === 'rescan') emit('rescan')
  if (action === 'desktopLyrics') emit('desktopLyrics')
  if (action === 'miniPlayer') emit('miniPlayer')
  menuOpen.value = false
}

function navigate(direction: 'back' | 'forward') {
  if (direction === 'back') emit('back')
  if (direction === 'forward') emit('forward')
  menuOpen.value = false
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) menuOpen.value = false
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <header ref="root" class="topbar">
    <div class="history-buttons">
      <button aria-label="后退" :disabled="!canGoBack" @click="navigate('back')"><ChevronLeft :size="19" /></button>
      <button aria-label="前进" :disabled="!canGoForward" @click="navigate('forward')"><ChevronRight :size="19" /></button>
    </div>
    <form class="topbar-search" role="search" @submit.prevent="emit('submitSearch')">
      <button class="topbar-search__submit" type="submit" aria-label="搜索音乐库"><Search :size="16" /></button>
      <input
        type="search"
        placeholder="搜索歌曲、艺人或专辑"
        :value="search"
        @input="emit('search', ($event.target as HTMLInputElement).value)"
        @search="emit('search', ($event.target as HTMLInputElement).value)"
      />
      <button v-if="search" class="topbar-search__clear" type="button" aria-label="清除搜索" @click="emit('clearSearch')"><X :size="14" /></button>
      <kbd v-else>Ctrl K</kbd>
    </form>
    <div class="topbar-actions">
      <span class="connection-pill" :class="{ online: connected }">
        <i />{{ connected ? 'foobar2000' : '预览模式' }}
      </span>
      <button aria-label="更多选项" :class="{ active: menuOpen }" @click="menuOpen = !menuOpen"><MoreHorizontal :size="19" /></button>
      <div v-if="menuOpen" class="topbar-menu">
        <button @click="run('refresh')"><RefreshCw :size="16" /><span>刷新音乐库</span></button>
        <button @click="run('rescan')"><ScanSearch :size="16" /><span>重新扫描音乐库</span></button>
        <button @click="run('preferences')"><Settings :size="16" /><span>首选项</span></button>
        <button @click="emit('outputDevices', $event); menuOpen = false"><AudioLines :size="16" /><span>输出设备</span></button>
        <button @click="run('desktopLyrics')"><Subtitles :size="16" /><span>桌面歌词</span></button>
        <button @click="run('miniPlayer')"><PanelTopOpen :size="16" /><span>迷你播放器</span></button>
        <button @click="run('fullscreen')"><Maximize :size="16" /><span>切换全屏</span></button>
        <button @click="run('reload')"><RefreshCw :size="16" /><span>重新加载界面</span></button>
      </div>
    </div>
  </header>
</template>
