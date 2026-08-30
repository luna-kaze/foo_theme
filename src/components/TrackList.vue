<script setup lang="ts">
import { Heart, MoreHorizontal, Pause, Play, Volume2 } from '@lucide/vue'
import type { DisplayTrack } from '../types/music'
import { formatTime } from '../utils/format'
import ArtworkImage from './ArtworkImage.vue'
import { isSameTrack, trackKey } from '../utils/track'
import { ref, watch } from 'vue'

const props = defineProps<{
  tracks: DisplayTrack[]
  currentTrack: DisplayTrack | null
  isPlaying: boolean
  compact?: boolean
  reorderable?: boolean
  customColumnLabel?: string
}>()

const emit = defineEmits<{
  play: [track: DisplayTrack, index: number]
  menu: [track: DisplayTrack, index: number, event: MouseEvent]
  selection: [tracks: DisplayTrack[]]
  reorder: [from: number, to: number]
}>()

const selected = ref(new Set<number>())
let anchorIndex = -1
let dragIndex = -1

function publishSelection() {
  emit('selection', props.tracks.filter((_, index) => selected.value.has(index)))
}

function toggleSelection(index: number, event: Event) {
  const next = new Set(selected.value)
  if ((event.currentTarget as HTMLInputElement).checked) next.add(index)
  else next.delete(index)
  selected.value = next
  anchorIndex = index
  publishSelection()
}

function toggleAllSelection(event: Event) {
  selected.value = (event.currentTarget as HTMLInputElement).checked
    ? new Set(props.tracks.map((_, index) => index))
    : new Set()
  anchorIndex = -1
  publishSelection()
}

function selectRow(track: DisplayTrack, index: number, event: MouseEvent) {
  if (event.shiftKey && anchorIndex >= 0) {
    const next = new Set(selected.value)
    for (let cursor = Math.min(anchorIndex, index); cursor <= Math.max(anchorIndex, index); cursor += 1) next.add(cursor)
    selected.value = next
    publishSelection()
    return
  }
  if (event.ctrlKey || event.metaKey) {
    const next = new Set(selected.value)
    if (next.has(index)) next.delete(index); else next.add(index)
    selected.value = next
    anchorIndex = index
    publishSelection()
    return
  }
  selected.value = new Set()
  anchorIndex = index
  publishSelection()
  emit('play', track, index)
}

function openMenu(track: DisplayTrack, index: number, event: MouseEvent) {
  if (!selected.value.has(index)) {
    selected.value = new Set([index])
    anchorIndex = index
    publishSelection()
  }
  emit('menu', track, index, event)
}

function selectAll(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'a') return
  event.preventDefault()
  event.stopPropagation()
  selected.value = new Set(props.tracks.map((_, index) => index))
  publishSelection()
}

function beginDrag(index: number, event: DragEvent) {
  if (!props.reorderable) return
  dragIndex = index
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function dropRow(index: number, event: DragEvent) {
  if (!props.reorderable || dragIndex < 0 || dragIndex === index) return
  event.preventDefault()
  emit('reorder', dragIndex, index)
  dragIndex = -1
}

watch(() => props.tracks, () => {
  selected.value = new Set()
  anchorIndex = -1
  publishSelection()
})

function isCurrent(track: DisplayTrack, currentTrack: DisplayTrack | null) {
  return isSameTrack(track, currentTrack)
}
</script>

<template>
  <div class="track-list" :class="{ compact, 'has-custom-column': customColumnLabel }" tabindex="-1" @keydown="selectAll">
    <div class="track-list__header">
      <span class="track-select"><input type="checkbox" aria-label="选择全部曲目" :checked="tracks.length > 0 && selected.size === tracks.length" :indeterminate="selected.size > 0 && selected.size < tracks.length" @click.stop @change="toggleAllSelection" /></span><span>#</span><span>标题</span><span>专辑</span><span>年份</span><span v-if="customColumnLabel">{{ customColumnLabel }}</span><span>时长</span><span />
    </div>
    <div
      v-for="(track, index) in tracks"
      :key="`${trackKey(track)}-${index}`"
      class="track-row"
      :class="{ current: isCurrent(track, currentTrack), selected: selected.has(index) }"
      role="button"
      tabindex="0"
      :draggable="reorderable"
      @click="selectRow(track, index, $event)"
      @keydown.enter.self.stop="emit('play', track, index)"
      @keydown.space.self.stop.prevent="emit('play', track, index)"
      @contextmenu.prevent="openMenu(track, index, $event)"
      @dragstart="beginDrag(index, $event)"
      @dragover.prevent
      @drop="dropRow(index, $event)"
      @dragend="dragIndex = -1"
    >
      <span class="track-select"><input type="checkbox" :aria-label="`选择 ${track.title || '未命名曲目'}`" :checked="selected.has(index)" @click.stop @change="toggleSelection(index, $event)" /></span>
      <span class="track-row__index">
        <Volume2 v-if="isCurrent(track, currentTrack) && isPlaying" :size="15" />
        <span v-else>{{ index + 1 }}</span>
        <i class="track-row__play" @click.stop="emit('play', track, index)">
          <Pause v-if="isCurrent(track, currentTrack) && isPlaying" :size="14" fill="currentColor" />
          <Play v-else :size="14" fill="currentColor" />
        </i>
      </span>
      <span class="track-row__title">
        <ArtworkImage :src="track.artworkUrl" :alt="`${track.album} 封面`" />
        <span><strong>{{ track.title || '未命名曲目' }}</strong><small>{{ track.artist || '未知艺人' }}</small></span>
      </span>
      <span class="track-row__album">{{ track.album || '未知专辑' }}</span>
      <span>{{ track.date?.slice(0, 4) || '—' }}</span>
      <span v-if="customColumnLabel" class="track-row__custom">{{ track.customValue || '—' }}</span>
      <span class="track-row__duration">{{ formatTime(track.duration) }}</span>
      <span class="track-row__more">
        <Heart v-if="Number(track.rating ?? 0) === 5" :size="13" fill="currentColor" class="track-row__favourite" />
        <button aria-label="曲目操作" @keydown.stop @click.stop="openMenu(track, index, $event)"><MoreHorizontal :size="17" /></button>
      </span>
    </div>
  </div>
</template>
