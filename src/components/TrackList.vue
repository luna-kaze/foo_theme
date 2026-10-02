<script setup lang="ts">
import { GripVertical, Heart, MoreHorizontal, Trash2, Volume2 } from '@lucide/vue'
import type { DisplayTrack } from '../types/music'
import { formatTime } from '../utils/format'
import ArtworkImage from './ArtworkImage.vue'
import { isSameTrack, trackKey } from '../utils/track'
import { computed, onActivated, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  tracks: DisplayTrack[]
  currentTrack: DisplayTrack | null
  isPlaying: boolean
  compact?: boolean
  reorderable?: boolean
  playlistIndex?: number
  favourites?: boolean
  customColumnLabel?: string
}>()

const emit = defineEmits<{
  play: [track: DisplayTrack, index: number]
  menu: [track: DisplayTrack, index: number, event: MouseEvent]
  selection: [tracks: DisplayTrack[]]
  reorder: [from: number, to: number, after: boolean, selectedIndexes: number[]]
  addToPlaylist: [tracks: DisplayTrack[], playlistIndex: number]
  moveToPlaylist: [tracks: DisplayTrack[], sourcePlaylistIndex: number, destinationPlaylistIndex: number]
  removeFromPlaylist: [tracks: DisplayTrack[], playlistIndex: number]
  insertIntoPlaylist: [tracks: DisplayTrack[], sourcePlaylistIndex: number | null, destinationPlaylistIndex: number, targetIndex: number, after: boolean, move: boolean]
  playlistHover: [playlistIndex: number | null]
  dragState: [active: boolean]
  addToIpod: [tracks: DisplayTrack[]]
  setFavourites: [tracks: DisplayTrack[], favourite: boolean]
  favouritesHover: [hovering: boolean]
}>()

const selected = ref(new Set<number>())
const listRoot = ref<HTMLElement | null>(null)
let anchorIndex = -1
let wheelSelectionStart = -1
let wheelSelectionFrame = 0
let wheelSelectionPoint = { x: 0, y: 0 }
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
const draggedTrackCount = ref(0)
const draggedIndexes = ref(new Set<number>())
const draggedTracks = ref<DisplayTrack[]>([])
const dragFragments = ref<Array<{ id: string; track: DisplayTrack; offsetX: number; offsetY: number; width: number; layer: number }>>([])
const mergePhase = ref(false)
const mergedPreview = ref(false)
const targetPlaylist = ref<{ index: number; name: string } | null>(null)
const targetIpod = ref(false)
const targetTrash = ref(false)
const targetFavourites = ref(false)
const trashDropComplete = ref(false)
const dragMovesTracks = ref(false)
const dragSourcePlaylistIndex = ref<number | null>(null)
const dragSourceFavourites = ref(false)
const dragPointerId = ref<number | null>(null)
const dropPlaylistIndex = ref<number | null>(null)
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
let trashCompleteTimer: ReturnType<typeof setTimeout> | null = null
let autoScrollFrame = 0
let autoScrollViewport: HTMLElement | null = null
const autoScrollEdge = 56

function clearTrackDropTarget() {
  dropIndex.value = -1
  dropAfter.value = false
  dropIndicator.value.visible = false
}

function stopAutoScroll() {
  if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame)
  autoScrollFrame = 0
  autoScrollViewport = null
}

function releaseDragPointerCapture() {
  if (dragList && dragPointerId.value != null && dragList.hasPointerCapture(dragPointerId.value)) dragList.releasePointerCapture(dragPointerId.value)
}

function updateAutoScroll(viewport: HTMLElement, clientY: number) {
  const bounds = viewport.getBoundingClientRect()
  const withinTopEdge = clientY >= bounds.top && clientY < bounds.top + autoScrollEdge
  const withinBottomEdge = clientY <= bounds.bottom && clientY > bounds.bottom - autoScrollEdge
  if (!withinTopEdge && !withinBottomEdge) {
    stopAutoScroll()
    return
  }
  autoScrollViewport = viewport
  if (autoScrollFrame) return
  const scroll = () => {
    const currentViewport = autoScrollViewport
    if (!currentViewport || !dragging.value) {
      stopAutoScroll()
      return
    }
    const currentBounds = currentViewport.getBoundingClientRect()
    const topDistance = dragY.value - currentBounds.top
    const bottomDistance = currentBounds.bottom - dragY.value
    const direction = topDistance >= 0 && topDistance < autoScrollEdge ? -1 : bottomDistance >= 0 && bottomDistance < autoScrollEdge ? 1 : 0
    if (!direction) {
      stopAutoScroll()
      return
    }
    const edgeDistance = direction < 0 ? topDistance : bottomDistance
    const speed = Math.ceil(4 + (1 - edgeDistance / autoScrollEdge) * 16)
    const previousTop = currentViewport.scrollTop
    currentViewport.scrollTop += direction * speed
    if (currentViewport.scrollTop === previousTop) {
      stopAutoScroll()
      return
    }
    updateTrackDropTarget(dragX.value, dragY.value)
    autoScrollFrame = requestAnimationFrame(scroll)
  }
  autoScrollFrame = requestAnimationFrame(scroll)
}

function fragmentStyle(fragment: { offsetX: number; offsetY: number; width: number; layer: number }) {
  const visualLayer = Math.min(fragment.layer + 1, 2)
  return {
    width: `${fragment.width}px`,
    transform: mergePhase.value
      ? `translate3d(${visualLayer * 8}px, ${visualLayer * 6}px, 0)`
      : `translate3d(${fragment.offsetX}px, ${fragment.offsetY}px, 0)`,
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
  resetWheelSelection()
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

function selectWithWheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) {
    resetWheelSelection()
    return
  }
  const hoveredIndex = trackIndexAt(event.clientX, event.clientY)
  if (!Number.isInteger(hoveredIndex) || hoveredIndex < 0) return
  event.preventDefault()
  if (wheelSelectionStart < 0) wheelSelectionStart = hoveredIndex
  wheelSelectionPoint = { x: event.clientX, y: event.clientY }
  const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? globalThis.innerHeight : 1
  document.querySelector<HTMLElement>('.workspace-scroll')?.scrollBy({ top: event.deltaY * multiplier, left: event.deltaX * multiplier })
  if (wheelSelectionFrame) return
  wheelSelectionFrame = requestAnimationFrame(() => {
    wheelSelectionFrame = 0
    const start = wheelSelectionStart
    const end = trackIndexAt(wheelSelectionPoint.x, wheelSelectionPoint.y)
    wheelSelectionStart = -1
    if (start < 0 || end < 0) return
    const next = new Set(selected.value)
    for (let index = Math.min(start, end); index <= Math.max(start, end); index += 1) next.add(index)
    selected.value = next
    anchorIndex = end
    publishSelection()
  })
}

function trackIndexAt(x: number, y: number) {
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('.track-row[data-track-index]')
  const index = Number(row?.dataset.trackIndex)
  return Number.isInteger(index) ? index : -1
}

function resetWheelSelection() {
  wheelSelectionStart = -1
  if (wheelSelectionFrame) cancelAnimationFrame(wheelSelectionFrame)
  wheelSelectionFrame = 0
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
  const wasDragging = dragging.value
  if (dragging.value) emit('dragState', false)
  window.removeEventListener('pointermove', updateReorderDrag)
  window.removeEventListener('pointerup', finishReorderDrag)
  window.removeEventListener('pointercancel', cancelReorderDrag)
  window.removeEventListener('foo-theme:track-drag-route-change', releaseDragPointerCapture)
  stopAutoScroll()
  releaseDragPointerCapture()
  dragIndex.value = -1
  clearTrackDropTarget()
  playlistDropIndicator.value.visible = false
  targetPlaylist.value = null
  targetIpod.value = false
  targetTrash.value = false
  targetFavourites.value = false
  dropPlaylistIndex.value = null
  dragMovesTracks.value = false
  dragSourcePlaylistIndex.value = null
  dragSourceFavourites.value = false
  dragPointerId.value = null
  draggedTrackCount.value = 0
  draggedIndexes.value = new Set()
  draggedTracks.value = []
  dragFragments.value = []
  mergePhase.value = false
  mergedPreview.value = false
  if (mergeFrame) cancelAnimationFrame(mergeFrame)
  mergeFrame = 0
  if (mergeTimer) clearTimeout(mergeTimer)
  mergeTimer = null
  dragList = null
  if (wasDragging && listRoot.value?.isConnected && listRoot.value.getClientRects().length) publishSelection()
  dragging.value = false
  dragPreviewTrack.value = null
}

function updateReorderDrag(event: PointerEvent) {
  if (event.pointerId !== dragPointerId.value) return
  event.preventDefault()
  updateTrackDropTarget(event.clientX, event.clientY)
}

function updateTrackDropTarget(clientX: number, clientY: number) {
  dragX.value = clientX
  dragY.value = clientY
  const hit = document.elementFromPoint(clientX, clientY)
  const playlistRow = hit?.closest<HTMLElement>('.playlist-nav__item[data-playlist-index]')
  const ipodTarget = hit?.closest<HTMLElement>('[data-ipod-drop-target]')
  const trashTarget = hit?.closest<HTMLElement>('[data-track-trash-target]')
  const favouriteTarget = hit?.closest<HTMLElement>('[data-favourites-drop-target]')
  if (trashTarget && (dragSourceFavourites.value || props.reorderable && props.playlistIndex != null)) {
    stopAutoScroll()
    targetTrash.value = true
    targetIpod.value = false
    targetPlaylist.value = null
    targetFavourites.value = false
    dropPlaylistIndex.value = null
    playlistDropIndicator.value.visible = false
    dropIndicator.value.visible = false
    emit('playlistHover', null)
    emit('favouritesHover', false)
    return
  }
  targetTrash.value = false
  targetFavourites.value = false
  if (favouriteTarget) {
    const sidebar = favouriteTarget.dataset.favouritesDropTarget === 'sidebar'
    const viewport = favouriteTarget.closest<HTMLElement>('.workspace-scroll')
    if (sidebar || viewport?.dataset.routePending !== 'true') {
      stopAutoScroll()
      targetFavourites.value = true
      targetIpod.value = false
      targetPlaylist.value = null
      dropPlaylistIndex.value = null
      clearTrackDropTarget()
      const bounds = favouriteTarget.getBoundingClientRect()
      playlistDropIndicator.value = { left: bounds.left + 3, top: bounds.top + 2, width: Math.max(0, bounds.width - 6), height: Math.max(0, bounds.height - 4), visible: sidebar }
      emit('playlistHover', null)
      emit('favouritesHover', sidebar)
      return
    }
  }
  emit('favouritesHover', false)
  if (ipodTarget) {
    stopAutoScroll()
    const bounds = ipodTarget.getBoundingClientRect()
    targetIpod.value = true
    targetPlaylist.value = null
    dropPlaylistIndex.value = null
    playlistDropIndicator.value = { left: bounds.left + 3, top: bounds.top + 2, width: Math.max(0, bounds.width - 6), height: Math.max(0, bounds.height - 4), visible: true }
    dropIndicator.value.visible = false
    emit('playlistHover', null)
    return
  }
  const playlistIndex = Number(playlistRow?.dataset.playlistIndex)
  if (Number.isInteger(playlistIndex) && playlistIndex >= 0 && playlistRow) {
    stopAutoScroll()
    const bounds = playlistRow.getBoundingClientRect()
    targetPlaylist.value = { index: playlistIndex, name: playlistRow.dataset.playlistName ?? '播放列表' }
    targetIpod.value = false
    dropPlaylistIndex.value = null
    playlistDropIndicator.value = { left: bounds.left + 3, top: bounds.top + 2, width: Math.max(0, bounds.width - 6), height: Math.max(0, bounds.height - 4), visible: true }
    dropIndicator.value.visible = false
    const browsingIndex = Number(document.querySelector<HTMLElement>('.workspace-scroll')?.dataset.browsingPlaylistIndex)
    emit('playlistHover', playlistIndex === browsingIndex ? null : playlistIndex)
    return
  }
  targetPlaylist.value = null
  targetIpod.value = false
  playlistDropIndicator.value.visible = false
  emit('playlistHover', null)
  const targetList = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.track-list')
  if (!targetList) {
    stopAutoScroll()
    clearTrackDropTarget()
    dropPlaylistIndex.value = null
    return
  }
  const targetListPlaylistIndex = Number(targetList.dataset.playlistIndex)
  dropPlaylistIndex.value = Number.isInteger(targetListPlaylistIndex) && targetListPlaylistIndex >= 0 ? targetListPlaylistIndex : null
  const viewport = targetList.closest<HTMLElement>('.workspace-scroll')
  const listBounds = targetList.getBoundingClientRect()
  const viewportBounds = viewport?.getBoundingClientRect()
  const withinList = viewport?.dataset.routePending !== 'true' && viewportBounds
    && clientX >= listBounds.left
    && clientX <= listBounds.right
    && clientY >= Math.max(viewportBounds.top, listBounds.top)
    && clientY <= Math.min(viewportBounds.bottom, listBounds.bottom)
  if (!withinList || !viewport) {
    stopAutoScroll()
    clearTrackDropTarget()
    dropPlaylistIndex.value = null
    return
  }
  updateAutoScroll(viewport, clientY)
  const rows = [...targetList.querySelectorAll<HTMLElement>('.track-row[data-reorder-index]')]
  // Use the same pointer coordinate for both the target row and its boundary.
  // The lifted preview offset must not shift an upper-half drop to another row.
  const row = rows.find((item) => clientY < item.getBoundingClientRect().bottom)
  const target = row ?? rows.at(-1)
  if (!target) {
    const header = targetList.querySelector<HTMLElement>('.track-list__header')
    if (!header) return
    const bounds = header.getBoundingClientRect()
    dropIndex.value = 0
    dropAfter.value = false
    dropIndicator.value = { left: bounds.left + 11, top: bounds.bottom, width: Math.max(0, bounds.width - 22), visible: true }
    return
  }
  const bounds = target.getBoundingClientRect()
  const index = Number(target.dataset.reorderIndex)
  if (!Number.isInteger(index) || index < 0) return
  const after = !row || clientY >= bounds.top + bounds.height / 2
  dropIndex.value = index
  dropAfter.value = after
  dropIndicator.value = {
    left: bounds.left + 11,
    top: Math.max(viewportBounds.top + 3, Math.min(viewportBounds.bottom - 3, after ? bounds.bottom : bounds.top)),
    width: Math.max(0, bounds.width - 22),
    visible: true,
  }
}

function finishReorderDrag(event: PointerEvent) {
  if (event.pointerId !== dragPointerId.value) return
  // Re-check the actual release position, including the final edge-scroll step.
  updateTrackDropTarget(event.clientX, event.clientY)
  const from = dragIndex.value
  const to = dropIndex.value
  const after = dropAfter.value
  const playlist = targetPlaylist.value
  const ipod = targetIpod.value
  const trash = targetTrash.value
  const favourite = targetFavourites.value
  const sourceFavourites = dragSourceFavourites.value
  const move = dragMovesTracks.value
  const sourcePlaylistIndex = dragSourcePlaylistIndex.value
  const destinationPlaylistIndex = dropPlaylistIndex.value ?? props.playlistIndex ?? null
  const foreignPlaylist = sourcePlaylistIndex != null && destinationPlaylistIndex != null && sourcePlaylistIndex !== destinationPlaylistIndex
  const externalSource = sourcePlaylistIndex == null
  const tracks = (trash || favourite || ipod || foreignPlaylist || externalSource || (playlist && playlist.index !== sourcePlaylistIndex))
    ? draggedTracks.value
    : []
  const selectedIndexes = [...draggedIndexes.value].sort((a, b) => a - b)
  const moved = dragging.value && from >= 0 && to >= 0 && (selectedIndexes.length > 1 || from !== to)
  stopReorderDrag()
  if (trash && tracks.length && (sourceFavourites || sourcePlaylistIndex != null)) {
    trashDropComplete.value = true
    if (trashCompleteTimer) clearTimeout(trashCompleteTimer)
    trashCompleteTimer = setTimeout(() => { trashDropComplete.value = false }, 460)
    if (sourceFavourites) emit('setFavourites', tracks, false)
    else if (sourcePlaylistIndex != null) emit('removeFromPlaylist', tracks, sourcePlaylistIndex)
    return
  }
  if (favourite && tracks.length) {
    emit('setFavourites', tracks, true)
    return
  }
  if (ipod && tracks.length) {
    emit('addToIpod', tracks)
    return
  }
  if ((foreignPlaylist || externalSource) && tracks.length && destinationPlaylistIndex != null && to >= 0) {
    suppressClick = true
    window.setTimeout(() => { suppressClick = false }, 0)
    emit('insertIntoPlaylist', tracks, sourcePlaylistIndex, destinationPlaylistIndex, to, after, move)
    return
  }
  if (playlist && playlist.index !== sourcePlaylistIndex && tracks.length) {
    suppressClick = true
    window.setTimeout(() => { suppressClick = false }, 0)
    if (move && sourcePlaylistIndex != null) emit('moveToPlaylist', tracks, sourcePlaylistIndex, playlist.index)
    else emit('addToPlaylist', tracks, playlist.index)
    return
  }
  if (!props.reorderable) return
  if (!moved) return
  suppressClick = true
  window.setTimeout(() => { suppressClick = false }, 0)
  emit('reorder', from, to, after, selectedIndexes)
}

function cancelReorderDrag(event: PointerEvent) {
  if (event.pointerId !== dragPointerId.value) return
  stopReorderDrag()
}

function beginTrackDrag(index: number, event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  dragIndex.value = index
  dragMovesTracks.value = event.shiftKey && Boolean(props.reorderable)
  dragSourcePlaylistIndex.value = props.playlistIndex ?? null
  dragSourceFavourites.value = Boolean(props.favourites)
  dragPointerId.value = event.pointerId
  dropIndex.value = index
  draggedIndexes.value = selected.value.has(index) ? new Set(selected.value) : new Set([index])
  draggedTracks.value = props.tracks.filter((_, trackIndex) => draggedIndexes.value.has(trackIndex))
  draggedTrackCount.value = draggedIndexes.value.size
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
  if (dragList) dragList.setPointerCapture(event.pointerId)
  dragFragments.value = []
  if (bounds && dragList) {
    let leftOutside = index <= 0
    let rightOutside = index >= props.tracks.length - 1
    let aboveCount = 0
    let belowCount = 0
    for (let distance = 1; (aboveCount < 5 && !leftOutside) || (belowCount < 5 && !rightOutside); distance += 1) {
      for (const [trackIndex, direction] of [[index - distance, 'above'], [index + distance, 'below']] as const) {
        if (direction === 'above' && aboveCount >= 5) continue
        if (direction === 'below' && belowCount >= 5) continue
        if (trackIndex < 0) { leftOutside = true; continue }
        if (trackIndex >= props.tracks.length) { rightOutside = true; continue }
        const source = dragList.children.item(trackIndex + 1) as HTMLElement | null
        const sourceBounds = source?.getBoundingClientRect()
        if (!sourceBounds) continue
        if (trackIndex < index && sourceBounds.bottom <= 0) leftOutside = true
        if (trackIndex > index && sourceBounds.top >= window.innerHeight) rightOutside = true
        if (sourceBounds.bottom <= 0 || sourceBounds.top >= window.innerHeight || !draggedIndexes.value.has(trackIndex)) continue
        const track = props.tracks[trackIndex]
        if (!track) continue
        dragFragments.value.push({ id: `${trackKey(track)}-${trackIndex}`, track, offsetX: sourceBounds.left - bounds.left, offsetY: sourceBounds.top - bounds.top, width: sourceBounds.width, layer: dragFragments.value.length })
        if (direction === 'above') aboveCount += 1
        else belowCount += 1
      }
    }
  }
  dragging.value = true
  emit('dragState', true)
  updateReorderDrag(event)
  window.addEventListener('pointermove', updateReorderDrag)
  window.addEventListener('pointerup', finishReorderDrag)
  window.addEventListener('pointercancel', cancelReorderDrag)
  window.addEventListener('foo-theme:track-drag-route-change', releaseDragPointerCapture)
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
  if (dragging.value) return
  selected.value = new Set()
  anchorIndex = -1
  publishSelection()
})

watch(() => props.playlistIndex, (index, previous) => {
  if (!dragging.value || index === previous) return
  // Selection indexes belong to the source playlist and must not color same-index target rows.
  selected.value = new Set()
  anchorIndex = -1
  publishSelection()
  clearTrackDropTarget()
  targetPlaylist.value = null
})

onBeforeUnmount(() => {
  resetWheelSelection()
  if (trashCompleteTimer) clearTimeout(trashCompleteTimer)
  stopReorderDrag()
})

onActivated(() => {
  if (!dragging.value && listRoot.value?.getClientRects().length) publishSelection()
})

function isCurrent(track: DisplayTrack, currentTrack: DisplayTrack | null) {
  return isSameTrack(track, currentTrack)
}
</script>

<template>
  <div ref="listRoot" class="track-list" :class="{ compact, reorderable, 'has-custom-column': customColumnLabel }" :data-playlist-index="playlistIndex" tabindex="-1" @keydown="selectAll" @wheel="selectWithWheel">
    <div class="track-list__header">
      <span class="track-select"><input type="checkbox" aria-label="选择全部曲目" :checked="tracks.length > 0 && selected.size === tracks.length" :indeterminate="selected.size > 0 && selected.size < tracks.length" @click.stop @change="toggleAllSelection" /></span><span>#</span><span>标题</span><span>专辑</span><span>年份</span><span v-if="customColumnLabel">{{ customColumnLabel }}</span><span>时长</span><span />
    </div>
    <div
      v-for="(track, index) in tracks"
      :key="`${trackKey(track)}-${index}`"
       class="track-row"
         :class="{ current: isCurrent(track, currentTrack), selected: selected.has(index), 'drag-source': dragging && dragSourcePlaylistIndex === playlistIndex && dragIndex === index, 'dragged-item': dragging && dragSourcePlaylistIndex === playlistIndex && draggedIndexes.has(index) }"
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
          <GripVertical class="track-row__drag-handle" :size="17" aria-label="拖动到播放列表；按住 Shift 移动曲目" @pointerdown.stop="beginTrackDrag(index, $event)" />
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
        <Heart v-if="track.isFavourite" :size="13" fill="currentColor" class="track-row__favourite" />
        <button aria-label="曲目操作" @keydown.stop @click.stop="openMenu(track, index, $event)"><MoreHorizontal :size="17" /></button>
      </span>
    </div>
    <div v-if="favourites || reorderable && playlistIndex != null" class="track-list__tail" aria-hidden="true" />
    <Teleport to="body">
      <div v-if="dropIndicator.visible" class="track-drop-indicator" :style="dropIndicatorStyle"><i /></div>
      <div v-if="playlistDropIndicator.visible && !targetPlaylist" class="track-playlist-drop-target" :style="playlistDropIndicatorStyle" />
      <Transition name="track-trash-drop">
        <div v-if="(dragging && (dragSourceFavourites || reorderable && playlistIndex != null)) || trashDropComplete" class="track-trash-drop" :class="{ 'is-active': targetTrash, 'is-complete': trashDropComplete }" data-track-trash-target>
          <Trash2 :size="24" :aria-label="dragSourceFavourites ? '拖到此处取消收藏' : '拖到此处从播放列表移除'" />
        </div>
      </Transition>
      <div v-if="dragFragments.length" class="track-drag-fragments" :style="dragPreviewStyle">
        <div v-for="fragment in dragFragments" :key="fragment.id" class="track-drag-fragment" :style="fragmentStyle(fragment)"><ArtworkImage :src="fragment.track.artworkUrl" :alt="`${fragment.track.album} 封面`" /><span><strong>{{ fragment.track.title || '未命名曲目' }}</strong><small>{{ fragment.track.artist || '未知艺人' }}</small></span></div>
      </div>
      <Transition name="track-drag-preview">
        <div v-if="dragging && dragPreviewTrack" class="track-drag-preview-stack" :style="dragPreviewStyle">
          <i v-for="layer in mergedPreview ? Math.min(draggedTrackCount - 1, 2) : 0" :key="layer" class="track-drag-preview-stack__layer" :style="{ '--layer': layer }" />
          <div class="track-drag-preview" :class="{ 'is-playlist-target': targetPlaylist || targetFavourites }">
            <span class="track-drag-preview__grip"><GripVertical :size="17" /></span>
            <span class="track-drag-preview__index">{{ dragIndex + 1 }}</span>
            <span class="track-drag-preview__title"><ArtworkImage :src="dragPreviewTrack.artworkUrl" :alt="`${dragPreviewTrack.album} 封面`" /><span><strong>{{ dragPreviewTrack.title || '未命名曲目' }}</strong><small>{{ dragPreviewTrack.artist || '未知艺人' }}</small></span></span>
            <span class="track-drag-preview__album">{{ dragPreviewTrack.album || '未知专辑' }}</span>
            <span class="track-drag-preview__year">{{ dragPreviewTrack.date?.slice(0, 4) || '—' }}</span>
            <span class="track-drag-preview__duration">{{ formatTime(dragPreviewTrack.duration) }}</span>
            <span v-if="targetFavourites || dragMovesTracks || draggedTrackCount > 1" class="track-drag-preview__badges">
              <b v-if="targetFavourites">添加收藏</b>
              <b v-else-if="dragMovesTracks" class="is-moving">移动中</b>
              <b v-if="draggedTrackCount > 1">{{ draggedTrackCount }} 首曲目</b>
            </span>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
