<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Eye, EyeOff, Heart, Layers3, LocateFixed, Mic2, Rows3, X } from '@lucide/vue'
import type { DisplayTrack, ParsedLyric } from '../types/music'
import { formatTime } from '../utils/format'
import ArtworkImage from './ArtworkImage.vue'
import { trackKey } from '../utils/track'

const props = defineProps<{
  open: boolean
  track: DisplayTrack | null
  artwork: string
  isPlaying: boolean
  playbackState: 'stopped' | 'playing' | 'paused'
  canSeek: boolean
  position: number
  duration: number
  lyrics: ParsedLyric[]
  lyricsSynced: boolean
  playbackTracks: DisplayTrack[]
  playbackTrackIndex: number
}>()

const emit = defineEmits<{
  close: []
  toggle: []
  seek: [position: number]
  seekResume: [position: number]
  favourite: [track: DisplayTrack]
  playTrack: [track: DisplayTrack]
}>()

const mode = ref<'standard' | 'coverflow'>('standard')
const modeTransition = ref<'retracting-standard' | 'packing-standard' | 'unpacking-standard' | 'packing-coverflow' | 'unpacking-coverflow' | 'handoff-standard' | 'handoff-coverflow' | null>(null)
const coverForward = ref(false)
const lyricsView = ref<HTMLElement | null>(null)
const lyricRows = ref<Array<HTMLElement | null>>([])
const autoFollowPaused = ref(false)
const scrubPosition = ref<number | null>(null)
const tonearmDragging = ref(false)
const tonearmWillPause = ref(false)
const tonearmDragAngle = ref<number | null>(null)
const recordZone = ref<HTMLElement | null>(null)
const coverflowView = ref<HTMLElement | null>(null)
const coverflowIndex = ref(0)
const lyricsVisible = ref(true)
const handoffCover = reactive({ visible: false, top: 0, left: 0, width: 0, height: 0 })
type StandardCoverSnapshot = { key: string; artwork: string; album: string; expanded: boolean }
const standardCover = ref<StandardCoverSnapshot>({ key: trackKey(props.track) || 'empty', artwork: props.artwork || props.track?.artworkUrl || '', album: props.track?.album || '当前专辑', expanded: false })
const pendingStandardCover = ref<StandardCoverSnapshot | null>(null)
const standardCoverVisible = ref(true)
let lastCoverflowPointer = { index: -1, time: 0, x: 0, y: 0 }
let resumeTimer: ReturnType<typeof setTimeout> | null = null
let modeTimer: ReturnType<typeof setTimeout> | null = null
let standardCoverTimer: ReturnType<typeof setTimeout> | null = null
let standardCoverLeaveDeadline = 0
let standardCoverGeneration = 0
let standardCoverLastChangeAt = 0
let standardCoverBurstCount = 0
const standardCoverLeaveMs = 400
const standardCoverGapMs = 140
const standardCoverIdleMs = 500
const standardCoverBurstIdleMs = 760
const standardCoverBurstWindowMs = 900

const activeLyric = computed(() => {
  if (!props.lyrics.some((line) => line.time >= 0)) return -1
  let low = 0
  let high = props.lyrics.length - 1
  let result = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (props.lyrics[middle].time <= props.position) {
      result = middle
      low = middle + 1
    } else high = middle - 1
  }
  return result
})

const playbackProgress = computed(() => {
  const position = scrubPosition.value ?? props.position
  return props.duration > 0 ? Math.min(1, Math.max(0, position / props.duration)) : 0
})

const tonearmAngle = computed(() => tonearmDragAngle.value ?? (props.playbackState === 'playing' ? 3 + playbackProgress.value * 33 : -10))

type CoverflowItem = {
  track: DisplayTrack
  artwork: string
  current: boolean
  key: string
}

const coverflowItems = computed<CoverflowItem[]>(() => props.playbackTracks.map((track, index) => ({
    track,
    artwork: index === props.playbackTrackIndex ? props.artwork || track.artworkUrl || '' : track.artworkUrl || '',
    current: index === props.playbackTrackIndex,
    key: `playlist:${track.sourceIndex ?? index}:${trackKey(track)}`,
  })))

const selectedCoverflow = computed(() => coverflowItems.value[coverflowIndex.value] ?? null)
const currentCoverflowIndex = computed(() => Math.max(0, props.playbackTrackIndex))
const backgroundArtwork = computed(() => modeTransition.value ? props.artwork : mode.value === 'coverflow' ? selectedCoverflow.value?.artwork || props.artwork : props.artwork)
const handoffCoverStyle = computed(() => ({
  top: `${handoffCover.top}px`,
  left: `${handoffCover.left}px`,
  width: `${handoffCover.width}px`,
  height: `${handoffCover.height}px`,
}))

type CoverRect = { top: number; left: number; width: number; height: number }

function readRect(element: Element | null): CoverRect | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

function fallbackCenterRect(): CoverRect {
  const size = Math.min(390, Math.max(230, window.innerWidth * .26))
  return { top: (window.innerHeight - size) / 2, left: (window.innerWidth - size) / 2, width: size, height: size }
}

function setHandoffRect(rect: CoverRect) {
  Object.assign(handoffCover, rect)
}

function waitForMode(milliseconds: number) {
  return new Promise<void>((resolve) => {
    modeTimer = setTimeout(resolve, milliseconds)
  })
}

async function waitForPaint() {
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

async function extractHandoffCover(target: CoverRect) {
  await waitForPaint()
  const element = document.querySelector<HTMLElement>('.immersive-handoff-cover')
  if (!element) {
    setHandoffRect(target)
    return
  }
  const animation = element.animate([
    { top: `${handoffCover.top}px`, left: `${handoffCover.left}px`, width: `${handoffCover.width}px`, height: `${handoffCover.height}px`, transform: 'scale(.96)' },
    { top: `${target.top - 24}px`, left: `${target.left + 68}px`, width: `${target.width}px`, height: `${target.height}px`, transform: 'scale(1.035)', offset: .56 },
    { top: `${target.top}px`, left: `${target.left}px`, width: `${target.width}px`, height: `${target.height}px`, transform: 'scale(1)' },
  ], { duration: 640, easing: 'cubic-bezier(.18,.82,.16,1)', fill: 'forwards' })
  await animation.finished.catch(() => undefined)
  setHandoffRect(target)
  animation.cancel()
}

function setLyricRow(element: unknown, index: number) {
  lyricRows.value[index] = element instanceof HTMLElement ? element : null
}

function scrollToActive(behavior: ScrollBehavior = 'smooth') {
  if (!props.open || mode.value !== 'standard' || activeLyric.value < 0 || autoFollowPaused.value) return
  const container = lyricsView.value
  const row = lyricRows.value[activeLyric.value]
  if (!container || !row) return
  const containerRect = container.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const rowTop = rowRect.top - containerRect.top + container.scrollTop
  container.scrollTo({
    top: Math.max(0, rowTop - container.clientHeight / 2 + rowRect.height / 2),
    behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior,
  })
}

function pauseAutoFollow() {
  if (!props.lyrics.some((line) => line.time >= 0)) return
  autoFollowPaused.value = true
  if (resumeTimer) clearTimeout(resumeTimer)
  resumeTimer = setTimeout(resumeAutoFollow, 3500)
}

function resumeAutoFollow() {
  if (resumeTimer) clearTimeout(resumeTimer)
  autoFollowPaused.value = false
  void nextTick(() => scrollToActive())
}

function seekLyric(line: ParsedLyric) {
  if (line.time < 0 || !props.lyricsSynced || !props.canSeek) return
  emit('seek', line.time)
  resumeAutoFollow()
}

function toggleCoverPosition() {
  if (lyricsVisible.value) return
  coverForward.value = !coverForward.value
  if (standardCover.value.key === trackKey(props.track)) standardCover.value.expanded = coverForward.value
}

function finishStandardCoverChange() {
  coverForward.value = false
  standardCover.value.expanded = false
}

function currentStandardCover(): StandardCoverSnapshot {
  return {
    key: trackKey(props.track) || 'empty',
    artwork: props.artwork || props.track?.artworkUrl || '',
    album: props.track?.album || '当前专辑',
    expanded: false,
  }
}

function flushPendingStandardCover(generation: number) {
  if (generation !== standardCoverGeneration || !pendingStandardCover.value) return
  const now = performance.now()
  const idle = standardCoverBurstCount >= 2 ? standardCoverBurstIdleMs : standardCoverIdleMs
  const readyAt = Math.max(standardCoverLeaveDeadline + standardCoverGapMs, standardCoverLastChangeAt + idle)
  if (now + 4 < readyAt) {
    standardCoverTimer = setTimeout(() => flushPendingStandardCover(generation), readyAt - now)
    return
  }
  standardCover.value = pendingStandardCover.value
  pendingStandardCover.value = null
  standardCoverVisible.value = true
  standardCoverTimer = null
  standardCoverBurstCount = 0
}

function scheduleStandardCoverChange() {
  const nextCover = currentStandardCover()
  const generation = ++standardCoverGeneration
  if (mode.value !== 'standard' || !props.open) {
    standardCover.value = nextCover
    pendingStandardCover.value = null
    standardCoverVisible.value = true
    standardCoverBurstCount = 0
    standardCoverLastChangeAt = 0
    return
  }
  pendingStandardCover.value = nextCover
  const now = performance.now()
  standardCoverBurstCount = now - standardCoverLastChangeAt <= standardCoverBurstWindowMs ? standardCoverBurstCount + 1 : 1
  standardCoverLastChangeAt = now
  if (standardCoverVisible.value) {
    standardCover.value.expanded = coverForward.value
    standardCoverVisible.value = false
    standardCoverLeaveDeadline = now + standardCoverLeaveMs
  }
  if (standardCoverTimer) clearTimeout(standardCoverTimer)
  const idle = standardCoverBurstCount >= 2 ? standardCoverBurstIdleMs : standardCoverIdleMs
  const showAt = Math.max(standardCoverLeaveDeadline + standardCoverGapMs, now + idle)
  standardCoverTimer = setTimeout(() => flushPendingStandardCover(generation), Math.max(0, showAt - now))
}

function updateTonearm(event: PointerEvent) {
  const zone = recordZone.value
  if (!zone || !tonearmDragging.value) return
  const rect = zone.getBoundingClientRect()
  const pivotX = rect.right - rect.width * 0.03 - 27
  const pivotY = rect.top + rect.height * 0.13
  const dx = event.clientX - pivotX
  const dy = event.clientY - pivotY
  const rawAngle = Math.atan2(-dx, Math.max(1, dy)) * 180 / Math.PI
  const angle = Math.min(36, Math.max(-10, rawAngle))
  tonearmDragAngle.value = angle
  tonearmWillPause.value = angle < -5
  scrubPosition.value = tonearmWillPause.value ? null : (Math.max(3, angle) - 3) / 33 * props.duration
}

function beginTonearm(event: PointerEvent) {
  if (!props.duration || !props.canSeek) return
  tonearmDragging.value = true
  tonearmWillPause.value = false
  tonearmDragAngle.value = tonearmAngle.value
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  updateTonearm(event)
}

function finishTonearm(event: PointerEvent) {
  if (!tonearmDragging.value) return
  updateTonearm(event)
  if (tonearmWillPause.value) {
    if (props.isPlaying) emit('toggle')
  } else if (scrubPosition.value != null) {
    if (props.isPlaying) emit('seek', scrubPosition.value)
    else emit('seekResume', scrubPosition.value)
  }
  tonearmDragging.value = false
  tonearmWillPause.value = false
  tonearmDragAngle.value = null
  scrubPosition.value = null
}

function cancelTonearm() {
  tonearmDragging.value = false
  tonearmWillPause.value = false
  tonearmDragAngle.value = null
  scrubPosition.value = null
}

function moveCoverflow(direction: number) {
  lastCoverflowPointer = { index: -1, time: 0, x: 0, y: 0 }
  coverflowIndex.value = Math.min(coverflowItems.value.length - 1, Math.max(0, coverflowIndex.value + direction))
}

function selectCoverflow(index: number) {
  coverflowIndex.value = index
}

function activateCoverflow(index: number) {
  const item = coverflowItems.value[index]
  if (!item) return
  coverflowIndex.value = index
  if (item.current) emit('toggle')
  else emit('playTrack', item.track)
}

function coverflowIndexAtPointer(event: PointerEvent) {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-cover-index]') : null
  if (target) return Number(target.dataset.coverIndex)
  const cards = [...(coverflowView.value?.querySelectorAll<HTMLElement>('[data-cover-index]:not(.far)') ?? [])]
  let closest = -1
  let closestDistance = Number.POSITIVE_INFINITY
  cards.forEach((card) => {
    const rect = card.getBoundingClientRect()
    const distance = Math.hypot(event.clientX - (rect.left + rect.right) / 2, event.clientY - (rect.top + rect.bottom) / 2)
    if (distance < closestDistance) {
      closest = Number(card.dataset.coverIndex)
      closestDistance = distance
    }
  })
  return closest
}

function handleCoverflowPointer(event: PointerEvent) {
  if (event.button !== 0) return
  const now = performance.now()
  const elapsed = now - lastCoverflowPointer.time
  const distance = Math.hypot(event.clientX - lastCoverflowPointer.x, event.clientY - lastCoverflowPointer.y)
  if (lastCoverflowPointer.index >= 0 && elapsed <= 420 && distance <= 48) {
    const targetIndex = lastCoverflowPointer.index
    lastCoverflowPointer = { index: -1, time: 0, x: 0, y: 0 }
    activateCoverflow(targetIndex)
    return
  }
  const index = coverflowIndexAtPointer(event)
  if (index < 0) return
  lastCoverflowPointer = { index, time: now, x: event.clientX, y: event.clientY }
  selectCoverflow(index)
}

async function setMode(nextMode: 'standard' | 'coverflow') {
  if (mode.value === nextMode || modeTransition.value) return
  lastCoverflowPointer = { index: -1, time: 0, x: 0, y: 0 }
  cancelTonearm()
  if (nextMode === 'coverflow') {
    if (coverForward.value) {
      modeTransition.value = 'retracting-standard'
      coverForward.value = false
      await waitForMode(680)
    }
    modeTransition.value = 'packing-standard'
    await waitForMode(640)
    const packedSleeve = readRect(document.querySelector('.immersive-standard .album-sleeve')) ?? fallbackCenterRect()
    setHandoffRect(packedSleeve)
    handoffCover.visible = true
    await waitForPaint()
    coverflowIndex.value = currentCoverflowIndex.value
    mode.value = 'coverflow'
    modeTransition.value = 'handoff-coverflow'
    await waitForPaint()
    handoffCover.visible = false
    modeTransition.value = 'unpacking-coverflow'
    await waitForMode(500)
    modeTransition.value = null
    return
  }
  coverForward.value = false
  modeTransition.value = 'packing-coverflow'
  await waitForMode(640)
  const currentRect = readRect(document.querySelector('.coverflow-card.current')) ?? fallbackCenterRect()
  const centerRect = readRect(document.querySelector('.coverflow-card.active')) ?? fallbackCenterRect()
  if (coverflowIndex.value !== currentCoverflowIndex.value) {
    await waitForMode(300)
  }
  setHandoffRect(currentRect)
  handoffCover.visible = true
  await waitForPaint()
  if (coverflowIndex.value !== currentCoverflowIndex.value) {
    await extractHandoffCover(centerRect)
  }
  else setHandoffRect(centerRect)
  coverflowIndex.value = currentCoverflowIndex.value
  standardCover.value = currentStandardCover()
  standardCoverVisible.value = true
  mode.value = 'standard'
  modeTransition.value = 'handoff-standard'
  await waitForPaint()
  handoffCover.visible = false
  modeTransition.value = 'unpacking-standard'
  await waitForMode(640)
  modeTransition.value = null
  void nextTick(() => scrollToActive('auto'))
}

function onCoverflowWheel(event: WheelEvent) {
  if (Math.abs(event.deltaY) < 4 && Math.abs(event.deltaX) < 4) return
  moveCoverflow((event.deltaY || event.deltaX) > 0 ? 1 : -1)
}

watch(activeLyric, () => void nextTick(() => scrollToActive()))
watch(() => trackKey(props.track), () => {
  scheduleStandardCoverChange()
  lyricRows.value = []
  lastCoverflowPointer = { index: -1, time: 0, x: 0, y: 0 }
  coverForward.value = false
  cancelTonearm()
  resumeAutoFollow()
})
watch(() => props.artwork || props.track?.artworkUrl || '', (artwork) => {
  const key = trackKey(props.track) || 'empty'
  if (pendingStandardCover.value?.key === key) pendingStandardCover.value.artwork = artwork
  if (standardCover.value.key === key) standardCover.value.artwork = artwork
})
watch(() => props.playbackTrackIndex, (index) => {
  if (index >= 0) coverflowIndex.value = index
})
watch(lyricsVisible, (visible) => {
  if (visible) {
    coverForward.value = false
    standardCover.value.expanded = false
  }
})
watch(() => [props.open, mode.value] as const, () => void nextTick(() => scrollToActive('auto')))
watch(() => props.open, (open) => {
  if (open) return
  if (modeTimer) clearTimeout(modeTimer)
  if (standardCoverTimer) clearTimeout(standardCoverTimer)
  modeTimer = null
  standardCoverTimer = null
  standardCoverGeneration += 1
  standardCoverBurstCount = 0
  standardCoverLastChangeAt = 0
  pendingStandardCover.value = null
  modeTransition.value = null
  handoffCover.visible = false
})
watch(() => coverflowItems.value.length, (length) => {
  coverflowIndex.value = Math.min(coverflowIndex.value, Math.max(0, length - 1))
})

onBeforeUnmount(() => {
  if (resumeTimer) clearTimeout(resumeTimer)
  if (modeTimer) clearTimeout(modeTimer)
  if (standardCoverTimer) clearTimeout(standardCoverTimer)
  handoffCover.visible = false
  cancelTonearm()
})
</script>

<template>
  <Transition name="now-playing">
    <section v-if="open" class="now-playing-panel immersive-player" :class="[`immersive-player--${mode}`, modeTransition && `mode-${modeTransition}`, handoffCover.visible && 'handoff-cover-active']" aria-label="沉浸式正在播放">
      <Transition name="immersive-backdrop">
        <div :key="backgroundArtwork || 'empty'" class="immersive-player__backdrop" :style="backgroundArtwork ? { backgroundImage: `url(${backgroundArtwork})` } : {}" />
      </Transition>
      <div class="immersive-player__wash" />
      <div v-if="handoffCover.visible" class="immersive-handoff-cover" :style="handoffCoverStyle"><ArtworkImage :src="artwork || track?.artworkUrl" :alt="`${track?.album ?? '当前专辑'} 交接封面`" /></div>

      <header class="immersive-toolbar">
        <button class="immersive-tool" aria-label="退出沉浸模式" @click="emit('close')"><X :size="19" /><span>退出沉浸</span></button>
        <div class="immersive-mode-switch" aria-label="沉浸显示模式">
          <button type="button" :class="{ active: mode === 'standard' }" aria-label="Standard" @pointerdown.stop @click.stop="setMode('standard')"><Rows3 :size="17" /><span>Standard</span></button>
          <button type="button" :class="{ active: mode === 'coverflow' }" aria-label="Coverflow" @pointerdown.stop @click.stop="setMode('coverflow')"><Layers3 :size="17" /><span>Coverflow</span></button>
        </div>
        <div class="immersive-toolbar__actions">
          <button v-if="mode === 'standard'" class="immersive-tool" :aria-label="lyricsVisible ? '隐藏歌词' : '显示歌词'" @click="lyricsVisible = !lyricsVisible">
            <EyeOff v-if="lyricsVisible" :size="18" /><Eye v-else :size="18" /><span>{{ lyricsVisible ? '隐藏歌词' : '显示歌词' }}</span>
          </button>
          <button class="immersive-tool" :aria-label="Number(track?.rating ?? 0) === 5 ? '取消收藏' : '收藏当前歌曲'" @click="track && emit('favourite', track)">
            <Heart :size="18" :fill="Number(track?.rating ?? 0) === 5 ? 'currentColor' : 'none'" /><span>{{ Number(track?.rating ?? 0) === 5 ? '取消收藏' : '收藏' }}</span>
          </button>
        </div>
      </header>

      <div v-if="mode === 'standard'" key="standard" class="immersive-standard" :class="{ 'lyrics-hidden': !lyricsVisible }">
        <section class="vinyl-stage" :class="{ 'cover-forward': coverForward }">
          <Transition name="standard-cover-change" @after-enter="finishStandardCoverChange">
            <div v-if="standardCoverVisible" :key="standardCover.key" class="album-sleeve" :class="{ interactive: !lyricsVisible, expanded: standardCover.expanded }" :role="lyricsVisible ? undefined : 'button'" :tabindex="lyricsVisible ? -1 : 0" :aria-label="lyricsVisible ? undefined : '切换封套位置'" @click="toggleCoverPosition" @keydown.enter="toggleCoverPosition">
              <ArtworkImage :src="standardCover.artwork" :alt="`${standardCover.album} 封面`" />
              <span class="album-sleeve__hint">{{ standardCover.expanded ? '收回封套' : '展开封套' }}</span>
            </div>
          </Transition>

          <div ref="recordZone" class="record-zone">
            <button class="vinyl-record" :class="{ spinning: isPlaying && !tonearmDragging }" :aria-label="isPlaying ? '暂停播放' : '继续播放'" @click="emit('toggle')">
              <span class="vinyl-record__grooves" />
              <span class="vinyl-record__label"><ArtworkImage :src="artwork || track?.artworkUrl" alt="唱片标签" /></span>
              <span class="vinyl-record__spindle" />
              <span class="vinyl-record__hint">{{ isPlaying ? '暂停' : '播放' }}</span>
            </button>
            <div class="tonearm-base" />
            <button
              class="tonearm"
              :class="{ parked: playbackState !== 'playing' && !tonearmDragging, dragging: tonearmDragging, 'will-pause': tonearmWillPause }"
              :style="{ '--tonearm-angle': `${tonearmAngle}deg` }"
              aria-label="拖动唱针调整进度，拖出唱片暂停"
              @pointerdown.prevent="beginTonearm"
              @pointermove.prevent="updateTonearm"
              @pointerup.prevent="finishTonearm"
              @pointercancel="cancelTonearm"
              @lostpointercapture="tonearmDragging && cancelTonearm()"
            ><span /><i /></button>
          </div>

          <div class="immersive-track-copy">
            <p>{{ track?.album || '你的音乐库' }}</p>
            <h1>{{ track?.title || '当前没有播放' }}</h1>
            <span>{{ track?.artist || '选择一首曲目开始播放' }}</span>
            <small>{{ formatTime(scrubPosition ?? position) }} / {{ formatTime(duration) }}</small>
          </div>
        </section>

        <section v-if="lyricsVisible" class="immersive-lyrics" aria-label="歌词">
          <div ref="lyricsView" class="immersive-lyrics__scroll" @wheel.passive="pauseAutoFollow" @touchstart.passive="pauseAutoFollow" @pointerdown="pauseAutoFollow">
            <template v-if="lyrics.length">
              <button
                v-for="(line, index) in lyrics"
                :key="`${line.time}-${index}`"
                :ref="(element) => setLyricRow(element, index)"
                :class="{ active: index === activeLyric, past: index < activeLyric }"
                :disabled="line.time < 0 || !lyricsSynced || !canSeek"
                @click="seekLyric(line)"
              >{{ line.text }}</button>
              <button v-if="autoFollowPaused" class="lyrics-follow" @click.stop="resumeAutoFollow"><LocateFixed :size="15" /> 跟随当前歌词</button>
            </template>
            <div v-else class="immersive-empty"><Mic2 :size="30" /><strong>{{ track ? '暂无歌词' : '当前没有播放' }}</strong><span>{{ track ? '内嵌歌词和同名歌词文件会显示在这里。' : '选择一首曲目开始播放。' }}</span></div>
          </div>
        </section>
      </div>

      <section v-else key="coverflow" class="coverflow" @wheel.prevent="onCoverflowWheel">
        <div ref="coverflowView" class="coverflow__viewport" @pointerup.stop.prevent="handleCoverflowPointer">
          <button
            v-for="(item, index) in coverflowItems"
            :key="item.key"
            :data-cover-index="index"
            class="coverflow-card"
            :class="{ active: index === coverflowIndex, far: Math.abs(index - coverflowIndex) > 3 }"
            :style="{ '--cover-offset': index - coverflowIndex, '--cover-distance': Math.abs(index - coverflowIndex), '--cover-image': item.artwork ? `url(${item.artwork})` : 'none' }"
            @keydown.enter.prevent="activateCoverflow(index)"
          >
            <span class="coverflow-card__sleeve">
              <span class="coverflow-card__face"><ArtworkImage :src="item.artwork" :alt="`${item.track.album} 封面`" /></span>
              <i class="coverflow-card__edge coverflow-card__edge--left" />
              <i class="coverflow-card__edge coverflow-card__edge--right" />
              <i class="coverflow-card__edge coverflow-card__edge--bottom"><b>{{ item.track.title }} · {{ item.track.artist }}</b></i>
            </span>
          </button>
        </div>
        <button class="coverflow__arrow coverflow__arrow--left" :disabled="coverflowIndex === 0" aria-label="上一张封面" @click="moveCoverflow(-1)"><ChevronLeft :size="22" /><span>上一张</span></button>
        <button class="coverflow__arrow coverflow__arrow--right" :disabled="coverflowIndex >= coverflowItems.length - 1" aria-label="下一张封面" @click="moveCoverflow(1)"><ChevronRight :size="22" /><span>下一张</span></button>
        <div v-if="selectedCoverflow" class="coverflow__copy">
          <p>{{ selectedCoverflow.current ? '正在播放' : `播放列表第 ${(selectedCoverflow.track.sourceIndex ?? coverflowIndex) + 1} 首` }}</p>
          <h1>{{ selectedCoverflow.track.title }}</h1>
          <span>{{ selectedCoverflow.track.artist }} · {{ selectedCoverflow.track.album }}</span>
          <small>{{ selectedCoverflow.current ? `双击封面${isPlaying ? '暂停' : '播放'}` : '单击选择，双击播放' }}</small>
        </div>
      </section>

    </section>
  </Transition>
</template>
