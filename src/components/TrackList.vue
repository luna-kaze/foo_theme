<script setup lang="ts">
import { GripVertical, Heart, MoreHorizontal, Volume2 } from '@lucide/vue'
import type { DisplayTrack } from '../types/music'
import { formatTime } from '../utils/format'
import ArtworkImage from './ArtworkImage.vue'
import { isSameTrack, trackKey } from '../utils/track'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  tracks: DisplayTrack[]
  currentTrack: DisplayTrack | null
  isPlaying: boolean
  compact?: boolean
  reorderable?: boolean
  playlistIndex?: number
  customColumnLabel?: string
}>()

const emit = defineEmits<{
  play: [track: DisplayTrack, index: number]
  menu: [track: DisplayTrack, index: number, event: MouseEvent]
  selection: [tracks: DisplayTrack[]]
  reorder: [from: number, to: number, after: boolean]
  addToPlaylist: [tracks: DisplayTrack[], playlistIndex: number]
}>()

const selected = ref(new Set<number>())
let anchorIndex = -1
const dragIndex = ref(-1)
const dropIndex = ref(-1)
let suppressClick = false
const dragging = ref(false)
const dropAfter = ref(false)
const dragX = ref(0)
const dragY = ref(0)
const dragWidth = ref(710)
const dragOffsetX = ref(0)
const dragOffsetY = ref(0)
const dropIndicator = ref({ left: 0, top: 0, width: 0, visible: false })
const dragPreviewTrack = ref<DisplayTrack | null>(null)
const draggedTracks = ref<DisplayTrack[]>([])
const dragFragments = ref<Array<{ id: string; track: DisplayTrack; x: number; y: number; width: number; layer: number }>>([])
const mergePhase = ref(false)
const mergedPreview = ref(false)
const targetPlaylist = ref<{ index: number; name: string } | null>(null)
const playlistDropIndicator = ref({ left: 0, top: 0, width: 0, height: 0, visible: false })
const dragPreviewStyle = computed(() => ({
  width: `${Math.min(dragWidth.value, globalThis.innerWidth - 24)}px`,
  transform: `translate3d(${Math.max(12, dragX.value - dragOffsetX.value)}px, ${dragY.value - dragOffsetY.value}px, 0)`,
}))
const dropIndicatorStyle = computed(() => ({
  left: `${dropIndicator.value.left}px`,
  top: `${dropIndicator.value.top}px`,
  width: `${dropIndicator.value.width}px`,
}))
const playlistDropIndicatorStyle = computed(() => ({
  left: `${playlistDropIndicator.value.left}px`,
  top: `${playlistDropIndicator.value.top}px`,
  width: `${playlistDropIndicator.value.width}px`,
  height: `${playlistDropIndicator.value.height}px`,
}))
let dragList: HTMLElement | null = null
let mergeFrame = 0
let mergeTimer: ReturnType<typeof setTimeout> | null = null

function fragmentStyle(fragment: { x: number; y: number; width: number; layer: number }) {
  const visualLayer = Math.min(fragment.layer + 1, 2)
  const targetX = Math.max(12, dragX.value - dragOffsetX.value) + visualLayer * 8
  const targetY = dragY.value - dragOffsetY.value + visualLayer * 6
  return {
    left: `${fragment.x}px`,
    top: `${fragment.y}px`,
    width: `${fragment.width}px`,
    transform: mergePhase.value ? `translate3d(${targetX - fragment.x}px, ${targetY - fragment.y}px, 0)` : 'translate3d(0, 0, 0)',
  }
}

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
  if (suppressClick) {
    event.preventDefault()
    return
  }
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
  selected.value = new Set([index])
  anchorIndex = index
  publishSelection()
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

function stopReorderDrag() {
  window.removeEventListener('pointermove', updateReorderDrag)
  window.removeEventListener('pointerup', finishReorderDrag)
  dragIndex.value = -1
  dropIndex.value = -1
  dropAfter.value = false
  dropIndicator.value.visible = false
  playlistDropIndicator.value.visible = false
  targetPlaylist.value = null
  draggedTracks.value = []
  dragFragments.value = []
  mergePhase.value = false
  mergedPreview.value = false
  if (mergeFrame) cancelAnimationFrame(mergeFrame)
  mergeFrame = 0
  if (mergeTimer) clearTimeout(mergeTimer)
  mergeTimer = null
  dragList = null
  dragging.value = false
  dragPreviewTrack.value = null
}

function updateReorderDrag(event: PointerEvent) {
  event.preventDefault()
  dragX.value = event.clientX
  dragY.value = event.clientY
  const playlistRow = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.playlist-nav__item[data-playlist-index]')
  const playlistIndex = Number(playlistRow?.dataset.playlistIndex)
  if (Number.isInteger(playlistIndex) && playlistIndex >= 0 && playlistRow) {
    const bounds = playlistRow.getBoundingClientRect()
    targetPlaylist.value = { index: playlistIndex, name: playlistRow.dataset.playlistName ?? '播放列表' }
    playlistDropIndicator.value = { left: bounds.left + 3, top: bounds.top + 2, width: Math.max(0, bounds.width - 6), height: Math.max(0, bounds.height - 4), visible: true }
    dropIndicator.value.visible = false
    return
  }
  targetPlaylist.value = null
  playlistDropIndicator.value.visible = false
  if (!dragList) return
  const previewTop = event.clientY - dragOffsetY.value
  const rows = [...dragList.querySelectorAll<HTMLElement>('.track-row[data-reorder-index]')]
  const row = rows.find((item) => previewTop < item.getBoundingClientRect().bottom)
  const target = row ?? rows.at(-1)
  if (!target) return
  const bounds = target.getBoundingClientRect()
  const index = Number(target.dataset.reorderIndex)
  if (!Number.isInteger(index) || index < 0) return
  const afterLast = !row
  dropIndex.value = index
  dropAfter.value = afterLast
  dropIndicator.value = {
    left: bounds.left + 11,
    top: afterLast ? bounds.bottom : bounds.top,
    width: Math.max(0, bounds.width - 22),
    visible: true,
  }
}

function finishReorderDrag() {
  const from = dragIndex.value
  const to = dropIndex.value
  const after = dropAfter.value
  const playlist = targetPlaylist.value
  const tracks = draggedTracks.value
  const moved = dragging.value && from >= 0 && to >= 0 && from !== to
  stopReorderDrag()
  if (playlist && playlist.index !== props.playlistIndex && tracks.length) {
    suppressClick = true
    window.setTimeout(() => { suppressClick = false }, 0)
    emit('addToPlaylist', tracks, playlist.index)
    return
  }
  if (!props.reorderable) return
  if (!moved) return
  suppressClick = true
  window.setTimeout(() => { suppressClick = false }, 0)
  emit('reorder', from, to, after)
}

function beginTrackDrag(index: number, event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  dragIndex.value = index
  dropIndex.value = index
  draggedTracks.value = selected.value.has(index)
    ? props.tracks.filter((_, trackIndex) => selected.value.has(trackIndex))
    : [props.tracks[index]].filter((track): track is DisplayTrack => Boolean(track))
  dragPreviewTrack.value = props.tracks[index] ?? null
  dragX.value = event.clientX
  dragY.value = event.clientY
  const row = (event.currentTarget as Element).closest<HTMLElement>('.track-row')
  const bounds = row?.getBoundingClientRect()
  if (bounds) {
    dragWidth.value = bounds.width
    dragOffsetX.value = event.clientX - bounds.left
    dragOffsetY.value = event.clientY - bounds.top
  }
  dragList = (event.currentTarget as Element).closest<HTMLElement>('.track-list')
  const selectedIndexes = selected.value.has(index) ? [...selected.value] : [index]
  dragFragments.value = selectedIndexes
    .filter((trackIndex) => trackIndex !== index)
    .map((trackIndex, layer) => {
      const source = dragList?.querySelector<HTMLElement>(`.track-row[data-track-index="${trackIndex}"]`)
      const sourceBounds = source?.getBoundingClientRect()
      const track = props.tracks[trackIndex]
      if (!sourceBounds || !track || sourceBounds.bottom <= 0 || sourceBounds.top >= window.innerHeight) return null
      return { id: `${trackKey(track)}-${trackIndex}`, track, x: sourceBounds.left, y: sourceBounds.top, width: sourceBounds.width, layer }
    })
    .filter((fragment): fragment is NonNullable<typeof fragment> => Boolean(fragment))
    .slice(0, 3)
  dragging.value = true
  updateReorderDrag(event)
  window.addEventListener('pointermove', updateReorderDrag)
  window.addEventListener('pointerup', finishReorderDrag)
  if (!dragFragments.value.length) {
    mergedPreview.value = true
    return
  }
  mergeFrame = requestAnimationFrame(() => {
    mergeFrame = requestAnimationFrame(() => { mergePhase.value = true })
  })
  mergeTimer = setTimeout(() => {
    dragFragments.value = []
    mergedPreview.value = true
  }, 640)
}

watch(() => props.tracks, () => {
  selected.value = new Set()
  anchorIndex = -1
  publishSelection()
})

onBeforeUnmount(stopReorderDrag)

function isCurrent(track: DisplayTrack, currentTrack: DisplayTrack | null) {
  return isSameTrack(track, currentTrack)
}
</script>

<template>
  <div class="track-list" :class="{ compact, reorderable, 'has-custom-column': customColumnLabel }" tabindex="-1" @keydown="selectAll">
    <div class="track-list__header">
      <span class="track-select"><input type="checkbox" aria-label="选择全部曲目" :checked="tracks.length > 0 && selected.size === tracks.length" :indeterminate="selected.size > 0 && selected.size < tracks.length" @click.stop @change="toggleAllSelection" /></span><span>#</span><span>标题</span><span>专辑</span><span>年份</span><span v-if="customColumnLabel">{{ customColumnLabel }}</span><span>时长</span><span />
    </div>
    <div
      v-for="(track, index) in tracks"
      :key="`${trackKey(track)}-${index}`"
       class="track-row"
       :class="{ current: isCurrent(track, currentTrack), selected: selected.has(index), 'drag-source': dragging && dragIndex === index }"
       :data-reorder-index="reorderable ? index : undefined"
       :data-track-index="index"
      role="button"
       tabindex="0"
       @click="selectRow(track, index, $event)"
       @dblclick="emit('play', track, index)"
      @keydown.enter.self.stop="emit('play', track, index)"
      @keydown.space.self.stop.prevent="emit('play', track, index)"
      @contextmenu.prevent="openMenu(track, index, $event)"
    >
      <span class="track-select"><input type="checkbox" :aria-label="`选择 ${track.title || '未命名曲目'}`" :checked="selected.has(index)" @click.stop @change="toggleSelection(index, $event)" /></span>
       <span class="track-row__index">
          <GripVertical class="track-row__drag-handle" :size="17" aria-label="拖动到播放列表" @pointerdown.stop="beginTrackDrag(index, $event)" />
         <Volume2 v-if="isCurrent(track, currentTrack) && isPlaying" :size="15" />
         <span v-else>{{ index + 1 }}</span>
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
    <Teleport to="body">
      <div v-if="dropIndicator.visible" class="track-drop-indicator" :style="dropIndicatorStyle"><i /></div>
      <div v-if="playlistDropIndicator.visible" class="track-playlist-drop-target" :style="playlistDropIndicatorStyle" />
      <div v-for="fragment in dragFragments" :key="fragment.id" class="track-drag-fragment" :style="fragmentStyle(fragment)"><ArtworkImage :src="fragment.track.artworkUrl" :alt="`${fragment.track.album} 封面`" /><span><strong>{{ fragment.track.title || '未命名曲目' }}</strong><small>{{ fragment.track.artist || '未知艺人' }}</small></span></div>
      <Transition name="track-drag-preview">
        <div v-if="dragging && dragPreviewTrack" class="track-drag-preview-stack" :style="dragPreviewStyle">
          <i v-for="layer in mergedPreview ? Math.min(draggedTracks.length - 1, 2) : 0" :key="layer" class="track-drag-preview-stack__layer" :style="{ '--layer': layer }" />
          <div class="track-drag-preview" :class="{ 'is-playlist-target': targetPlaylist }">
            <span class="track-drag-preview__grip"><GripVertical :size="17" /></span>
            <span class="track-drag-preview__index">{{ dragIndex + 1 }}</span>
            <span class="track-drag-preview__title"><ArtworkImage :src="dragPreviewTrack.artworkUrl" :alt="`${dragPreviewTrack.album} 封面`" /><span><strong>{{ dragPreviewTrack.title || '未命名曲目' }}</strong><small>{{ dragPreviewTrack.artist || '未知艺人' }}</small></span></span>
            <span class="track-drag-preview__album">{{ dragPreviewTrack.album || '未知专辑' }}</span>
            <span class="track-drag-preview__year">{{ dragPreviewTrack.date?.slice(0, 4) || '—' }}</span>
            <span class="track-drag-preview__duration">{{ formatTime(dragPreviewTrack.duration) }}</span>
            <b v-if="draggedTracks.length > 1" class="track-drag-preview__count">{{ draggedTracks.length }} 首曲目</b>
            <b v-if="targetPlaylist" class="track-drag-preview__target">添加至 {{ targetPlaylist.name }}</b>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
