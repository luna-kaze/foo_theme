<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowLeft, AudioLines, Check, ChevronLeft, ChevronRight, MoreHorizontal, PanelTopOpen, RefreshCw, Search, Settings, Smartphone, ScanSearch, Subtitles, X } from '@lucide/vue'
import type { OutputDevice } from 'foo-webview-sdk'

defineProps<{
  connected: boolean
  search: string
  searchBusy: boolean
  canGoBack: boolean
  canGoForward: boolean
  outputDevices: OutputDevice[]
  outputLoading: boolean
  connectionLabel: string
  connectionTransitioning: boolean
  libraryScanning: boolean
  ipodAvailable: boolean
}>()

const emit = defineEmits<{
  search: [value: string]
  submitSearch: []
  clearSearch: []
  back: []
  forward: []
  refresh: []
  preferences: []
  reload: []
  rescan: []
  loadOutputDevices: []
  selectOutputDevice: [device: OutputDevice]
  desktopLyrics: []
  miniPlayer: []
  drag: []
  maximize: []
  ipodManager: []
}>()

const menuOpen = ref(false)
const outputOpen = ref(false)
const root = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
let dragCandidate: { pointerId: number; x: number; y: number } | null = null

function clearSearch() {
  emit('clearSearch')
  searchInput.value?.focus({ preventScroll: true })
}

function run(action: 'refresh' | 'preferences' | 'reload' | 'rescan' | 'desktopLyrics' | 'miniPlayer' | 'ipodManager') {
  if (action === 'refresh') emit('refresh')
  if (action === 'preferences') emit('preferences')
  if (action === 'reload') emit('reload')
  if (action === 'rescan') emit('rescan')
  if (action === 'desktopLyrics') emit('desktopLyrics')
  if (action === 'miniPlayer') emit('miniPlayer')
  if (action === 'ipodManager') emit('ipodManager')
  menuOpen.value = false
}

function navigate(direction: 'back' | 'forward') {
  if (direction === 'back') emit('back')
  if (direction === 'forward') emit('forward')
  menuOpen.value = false
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) {
    menuOpen.value = false
    outputOpen.value = false
  }
}

function openOutputs() {
  outputOpen.value = true
  emit('loadOutputDevices')
}

function selectOutput(device: OutputDevice) {
  emit('selectOutputDevice', device)
  menuOpen.value = false
  outputOpen.value = false
}

function prepareDrag(event: PointerEvent) {
  if (event.button !== 0) return
  const target = event.target as HTMLElement
  if (target.closest('button, input, form, select, a, [role="button"], [role="menu"]')) return
  dragCandidate = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
}

function onDocumentPointerMove(event: PointerEvent) {
  if (!dragCandidate || event.pointerId !== dragCandidate.pointerId) return
  if (Math.hypot(event.clientX - dragCandidate.x, event.clientY - dragCandidate.y) < 5) return
  dragCandidate = null
  emit('drag')
}

function cancelDragCandidate(event: PointerEvent) {
  if (dragCandidate?.pointerId === event.pointerId) dragCandidate = null
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('pointermove', onDocumentPointerMove)
  document.addEventListener('pointerup', cancelDragCandidate)
  document.addEventListener('pointercancel', cancelDragCandidate)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('pointermove', onDocumentPointerMove)
  document.removeEventListener('pointerup', cancelDragCandidate)
  document.removeEventListener('pointercancel', cancelDragCandidate)
})
</script>

<template>
  <header ref="root" class="topbar" @pointerdown="prepareDrag" @dblclick.stop.prevent="emit('maximize')">
    <div class="history-buttons">
      <button aria-label="后退" :disabled="!canGoBack" @click="navigate('back')"><ChevronLeft :size="19" /></button>
      <button aria-label="前进" :disabled="!canGoForward" @click="navigate('forward')"><ChevronRight :size="19" /></button>
    </div>
    <form class="topbar-search" :class="{ 'is-searching': searchBusy }" :aria-busy="searchBusy" role="search" @submit.prevent="emit('submitSearch')" @dblclick.stop>
      <button class="topbar-search__submit" type="submit" aria-label="搜索音乐库"><Search :size="16" /></button>
      <input
        ref="searchInput"
        type="search"
        placeholder="搜索歌曲、艺人或专辑"
        :value="search"
        @input="emit('search', ($event.target as HTMLInputElement).value)"
      />
      <span class="topbar-search__trailing">
        <Transition name="search-clear" mode="out-in">
          <button v-if="search" key="clear" class="topbar-search__clear" type="button" aria-label="清除搜索" @click="clearSearch"><X :size="14" /></button>
          <kbd v-else key="hint">Ctrl K</kbd>
        </Transition>
      </span>
    </form>
    <div class="topbar-actions">
      <span class="connection-pill" :class="{ online: connected && !connectionTransitioning, transitioning: connectionTransitioning }">
        <i />{{ connected ? `${connectionLabel}${libraryScanning ? ' · 扫描中' : ''}` : '预览模式' }}
      </span>
      <button aria-label="更多选项" :class="{ active: menuOpen }" @click="menuOpen = !menuOpen"><MoreHorizontal :size="19" /></button>
      <div v-if="menuOpen" class="topbar-menu" :class="{ 'topbar-menu--outputs': outputOpen }">
        <template v-if="outputOpen">
          <button class="topbar-menu__back" @click="outputOpen = false"><ArrowLeft :size="16" /><span>输出设备</span></button>
          <span class="topbar-menu__separator" />
          <div v-if="outputLoading" class="topbar-menu__status">正在读取设备…</div>
          <div v-else-if="!outputDevices.length" class="topbar-menu__status">没有可用的输出设备</div>
          <template v-else>
            <button v-for="device in outputDevices" :key="`${device.outputId}:${device.deviceId}`" class="topbar-menu__device" @click="selectOutput(device)">
              <Check :size="14" :class="{ hidden: !device.isCurrent }" />
              <span>{{ device.name }}</span>
            </button>
          </template>
        </template>
        <template v-else>
          <button @click="run('refresh')"><RefreshCw :size="16" /><span>刷新音乐库</span></button>
          <button @click="run('rescan')"><ScanSearch :size="16" /><span>重新扫描音乐库</span></button>
          <button @click="run('preferences')"><Settings :size="16" /><span>首选项</span></button>
          <button @click="openOutputs"><AudioLines :size="16" /><span>输出设备</span></button>
          <button @click="run('desktopLyrics')"><Subtitles :size="16" /><span>桌面歌词</span></button>
          <button v-if="ipodAvailable" @click="run('ipodManager')"><Smartphone :size="16" /><span>iPod 管理器</span></button>
          <button @click="run('miniPlayer')"><PanelTopOpen :size="16" /><span>迷你播放器</span></button>
          <button @click="run('reload')"><RefreshCw :size="16" /><span>重新加载界面</span></button>
        </template>
      </div>
    </div>
  </header>
</template>
