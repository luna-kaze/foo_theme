<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Eye, EyeOff, Heart, Layers3, LocateFixed, Mic2, Rows3, X } from '@lucide/vue'
import type { DisplayQueueItem, DisplayTrack, ParsedLyric } from '../types/music'
import { formatTime } from '../utils/format'
import ArtworkImage from './ArtworkImage.vue'
import { trackKey } from '../utils/track'

const props = defineProps<{
  open: boolean
  track: DisplayTrack | null
  artwork: string
  isPlaying: boolean
  position: number
  duration: number
  lyrics: ParsedLyric[]
  lyricsSynced: boolean
  queue: DisplayQueueItem[]
  history: DisplayTrack[]
}>()

const emit = defineEmits<{
  close: []
  toggle: []
  seek: [position: number]
  favourite: [track: DisplayTrack]
  playQueue: [index: number]
  playHistory: [track: DisplayTrack]
}>()

const mode = ref<'standard' | 'coverflow'>('standard')
const coverForward = ref(false)
const lyricsView = ref<HTMLElement | null>(null)
const lyricRows = ref<Array<HTMLElement | null>>([])
const autoFollowPaused = ref(false)
const scrubPosition = ref<number | null>(null)
const tonearmDragging = ref(false)
const tonearmWillPause = ref(false)
const recordZone = ref<HTMLElement | null>(null)
const coverflowIndex = ref(0)
const lyricsVisible = ref(true)
let resumeTimer: ReturnType<typeof setTimeout> | null = null

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

const tonearmAngle = computed(() => 3 + playbackProgress.value * 33)

const coverflowItems = computed(() => [
  ...[...props.history].reverse().map((track) => ({
    track,
    artwork: track.artworkUrl || '',
    kind: 'history' as const,
    queueIndex: -1,
    key: `played:${trackKey(track)}`,
  })),
  ...(props.track ? [{ track: props.track, artwork: props.artwork || props.track.artworkUrl || '', kind: 'current' as const, queueIndex: -1, key: `played:${trackKey(props.track)}` }] : []),
  ...props.queue.slice(0, 12).map((track, queueIndex) => ({
    track,
    artwork: track.artworkUrl || '',
    kind: 'queue' as const,
    queueIndex,
    key: `queue:${trackKey(track)}:${queueIndex}`,
  })),
])

const selectedCoverflow = computed(() => coverflowItems.value[coverflowIndex.value] ?? null)
const currentCoverflowIndex = computed(() => props.history.length)
const backgroundArtwork = computed(() => mode.value === 'coverflow' ? selectedCoverflow.value?.artwork || props.artwork : props.artwork)

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
  if (line.time < 0 || !props.lyricsSynced) return
  emit('seek', line.time)
  resumeAutoFollow()
}

function toggleCoverPosition() {
  if (lyricsVisible.value) return
  coverForward.value = !coverForward.value
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
  const angle = Math.min(36, Math.max(3, rawAngle))
  tonearmWillPause.value = event.clientX > rect.right + 48 || event.clientY < rect.top - 28 || event.clientY > rect.bottom + 28
  const ratio = (angle - 3) / 33
  scrubPosition.value = ratio * props.duration
}

function beginTonearm(event: PointerEvent) {
  if (!props.duration) return
  tonearmDragging.value = true
  tonearmWillPause.value = false
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  updateTonearm(event)
}

function finishTonearm(event: PointerEvent) {
  if (!tonearmDragging.value) return
  updateTonearm(event)
  if (tonearmWillPause.value) {
    if (props.isPlaying) emit('toggle')
  } else if (scrubPosition.value != null) {
    emit('seek', scrubPosition.value)
    if (!props.isPlaying) emit('toggle')
  }
  tonearmDragging.value = false
  tonearmWillPause.value = false
  scrubPosition.value = null
}

function cancelTonearm() {
  tonearmDragging.value = false
  tonearmWillPause.value = false
  scrubPosition.value = null
}

function moveCoverflow(direction: number) {
  coverflowIndex.value = Math.min(coverflowItems.value.length - 1, Math.max(0, coverflowIndex.value + direction))
}

function selectCoverflow(index: number) {
  const item = coverflowItems.value[index]
  if (!item) return
  coverflowIndex.value = index
  if (item.kind === 'current') emit('toggle')
  else if (item.kind === 'history') emit('playHistory', item.track)
  else emit('playQueue', item.queueIndex)
}

function setMode(nextMode: 'standard' | 'coverflow') {
  if (mode.value === nextMode) return
  cancelTonearm()
  mode.value = nextMode
  if (nextMode === 'coverflow') coverflowIndex.value = currentCoverflowIndex.value
}

function onCoverflowWheel(event: WheelEvent) {
  if (Math.abs(event.deltaY) < 4 && Math.abs(event.deltaX) < 4) return
  moveCoverflow((event.deltaY || event.deltaX) > 0 ? 1 : -1)
}

watch(activeLyric, () => void nextTick(() => scrollToActive()))
watch(() => trackKey(props.track), () => {
  lyricRows.value = []
  coverForward.value = false
  cancelTonearm()
  void nextTick(() => {
    coverflowIndex.value = currentCoverflowIndex.value
  })
  resumeAutoFollow()
})
watch(lyricsVisible, (visible) => {
  if (visible) coverForward.value = false
})
watch(() => [props.open, mode.value] as const, () => void nextTick(() => scrollToActive('auto')))
watch(() => coverflowItems.value.length, (length) => {
  coverflowIndex.value = Math.min(coverflowIndex.value, Math.max(0, length - 1))
})

onBeforeUnmount(() => {
  if (resumeTimer) clearTimeout(resumeTimer)
  cancelTonearm()
})
</script>

<template>
  <Transition name="now-playing">
    <section v-if="open" class="now-playing-panel immersive-player" :class="`immersive-player--${mode}`" aria-label="沉浸式正在播放">
      <Transition name="immersive-backdrop">
        <div :key="backgroundArtwork || 'empty'" class="immersive-player__backdrop" :style="backgroundArtwork ? { backgroundImage: `url(${backgroundArtwork})` } : {}" />
      </Transition>
      <div class="immersive-player__wash" />

      <header class="immersive-toolbar">
        <button class="immersive-tool" aria-label="退出沉浸模式" @click="emit('close')"><X :size="19" /><span>退出沉浸</span></button>
        <div class="immersive-mode-switch" aria-label="沉浸显示模式">
          <button type="button" :class="{ active: mode === 'standard' }" aria-label="标准沉浸" @pointerdown.stop @click.stop="setMode('standard')"><Rows3 :size="17" /><span>标准沉浸</span></button>
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

      <div v-if="mode === 'standard'" class="immersive-standard" :class="{ 'lyrics-hidden': !lyricsVisible }">
        <section class="vinyl-stage" :class="{ 'cover-forward': coverForward }">
          <div class="album-sleeve" :class="{ interactive: !lyricsVisible }" :role="lyricsVisible ? undefined : 'button'" :tabindex="lyricsVisible ? -1 : 0" :aria-label="lyricsVisible ? undefined : '切换封套位置'" @click="toggleCoverPosition" @keydown.enter="toggleCoverPosition">
            <ArtworkImage :src="artwork || track?.artworkUrl" :alt="`${track?.album ?? '当前专辑'} 封面`" />
            <span class="album-sleeve__hint">{{ coverForward ? '收回封套' : '展开封套' }}</span>
          </div>

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
              :class="{ parked: !isPlaying && !tonearmDragging, dragging: tonearmDragging, 'will-pause': tonearmWillPause }"
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
                :disabled="line.time < 0 || !lyricsSynced"
                @click="seekLyric(line)"
              >{{ line.text }}</button>
              <button v-if="autoFollowPaused" class="lyrics-follow" @click.stop="resumeAutoFollow"><LocateFixed :size="15" /> 跟随当前歌词</button>
            </template>
            <div v-else class="immersive-empty"><Mic2 :size="30" /><strong>{{ track ? '暂无歌词' : '当前没有播放' }}</strong><span>{{ track ? '内嵌歌词和同名歌词文件会显示在这里。' : '选择一首曲目开始播放。' }}</span></div>
          </div>
        </section>
      </div>

      <section v-else class="coverflow" @wheel.prevent="onCoverflowWheel">
        <div class="coverflow__viewport">
          <button
            v-for="(item, index) in coverflowItems"
            :key="item.key"
            class="coverflow-card"
            :class="{ active: index === coverflowIndex, far: Math.abs(index - coverflowIndex) > 3 }"
            :style="{ '--cover-offset': index - coverflowIndex, '--cover-distance': Math.abs(index - coverflowIndex), '--cover-image': item.artwork ? `url(${item.artwork})` : 'none' }"
            @click="selectCoverflow(index)"
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
          <p>{{ selectedCoverflow.kind === 'current' ? '正在播放' : selectedCoverflow.kind === 'history' ? '播放历史' : `接下来第 ${selectedCoverflow.queueIndex + 1} 首` }}</p>
          <h1>{{ selectedCoverflow.track.title }}</h1>
          <span>{{ selectedCoverflow.track.artist }} · {{ selectedCoverflow.track.album }}</span>
          <small>{{ selectedCoverflow.kind === 'current' ? `点击封面${isPlaying ? '暂停' : '播放'}` : '点击封面立即切换' }}</small>
        </div>
      </section>

    </section>
  </Transition>
</template>
