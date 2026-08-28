<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown, Heart, LocateFixed, ListMusic, Mic2, Pause, Play, SkipBack, SkipForward, Trash2, X, Zap } from '@lucide/vue'
import type { DisplayQueueItem, DisplayTrack, NowPlayingTab, ParsedLyric } from '../types/music'
import { formatTime } from '../utils/format'
import ArtworkImage from './ArtworkImage.vue'

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
  tab: NowPlayingTab
}>()

const emit = defineEmits<{
  close: []
  toggle: []
  next: []
  previous: []
  seek: [position: number]
  tab: [tab: NowPlayingTab]
  favourite: [track: DisplayTrack]
  playQueue: [index: number]
  removeQueue: [index: number]
  moveQueue: [index: number]
  clearQueue: []
  queueMenu: [index: number, event: MouseEvent]
}>()

const activeLyric = computed(() => {
  if (!props.lyrics.some((line) => line.time >= 0)) return -1
  let index = -1
  props.lyrics.forEach((line, lineIndex) => {
    if (line.time <= props.position) index = lineIndex
  })
  return index
})

const lyricsView = ref<HTMLElement | null>(null)
const lyricRows = ref<Array<HTMLElement | null>>([])
const autoFollowPaused = ref(false)
const seekPreview = ref<number | null>(null)
let resumeTimer: ReturnType<typeof setTimeout> | null = null

const shownPosition = computed(() => seekPreview.value ?? props.position)

function previewSeek(event: Event) {
  seekPreview.value = Number((event.target as HTMLInputElement).value)
}

function commitSeek(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  seekPreview.value = null
  emit('seek', value)
}

function setLyricRow(element: unknown, index: number) {
  lyricRows.value[index] = element instanceof HTMLElement ? element : null
}

function scrollToActive(behavior: ScrollBehavior = 'smooth') {
  if (!props.open || props.tab !== 'lyrics' || activeLyric.value < 0 || autoFollowPaused.value) return
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
  resumeTimer = setTimeout(() => {
    autoFollowPaused.value = false
    void nextTick(() => scrollToActive())
  }, 3500)
}

function resumeAutoFollow() {
  if (resumeTimer) clearTimeout(resumeTimer)
  autoFollowPaused.value = false
  void nextTick(() => scrollToActive())
}

function seekLyric(line: ParsedLyric) {
  if (line.time < 0) return
  emit('seek', line.time)
  resumeAutoFollow()
}

watch(activeLyric, () => void nextTick(() => scrollToActive()))
watch(() => props.track?.path, () => {
  lyricRows.value = []
  seekPreview.value = null
  resumeAutoFollow()
})
watch(() => [props.open, props.tab] as const, () => void nextTick(() => scrollToActive('auto')))

onBeforeUnmount(() => {
  if (resumeTimer) clearTimeout(resumeTimer)
})
</script>

<template>
  <Transition name="now-playing">
    <section v-if="open" class="now-playing-panel" aria-label="正在播放">
      <div class="now-playing-panel__backdrop" :style="artwork ? { backgroundImage: `url(${artwork})` } : {}" />
      <header class="now-playing-panel__header">
        <div><span>正在播放</span><small>foobar2000</small></div>
        <button aria-label="关闭正在播放" @click="emit('close')"><X :size="20" /></button>
      </header>

      <div class="now-playing-panel__body">
        <div class="now-playing-main">
          <ArtworkImage :src="artwork || track?.artworkUrl" :alt="`${track?.album ?? '当前曲目'} 封面`" />
          <div class="now-playing-copy">
            <span class="now-playing-copy__label">来自 {{ track?.album || '你的音乐库' }}</span>
            <h2>{{ track?.title || '当前没有播放' }}</h2>
            <p>{{ track?.artist || '选择一首曲目开始播放' }}</p>
          </div>
          <button class="now-playing-more" :aria-label="Number(track?.rating ?? 0) > 0 ? '取消收藏' : '添加到收藏'" @click="track && emit('favourite', track)">
            <Heart :size="20" :fill="Number(track?.rating ?? 0) > 0 ? 'currentColor' : 'none'" />
          </button>
          <div class="now-playing-progress">
            <input
              type="range"
              min="0"
              :max="Math.max(duration, 1)"
              step="0.1"
              :value="shownPosition"
              :style="{ '--progress': `${duration ? (shownPosition / duration) * 100 : 0}%` }"
              @input="previewSeek"
              @change="commitSeek"
            />
            <span>{{ formatTime(shownPosition) }}</span><span>{{ formatTime(duration) }}</span>
          </div>
          <div class="now-playing-controls">
            <button aria-label="上一首" @click="emit('previous')"><SkipBack :size="24" fill="currentColor" /></button>
            <button class="now-playing-controls__play" :aria-label="isPlaying ? '暂停' : '播放'" @click="emit('toggle')">
              <Pause v-if="isPlaying" :size="27" fill="currentColor" />
              <Play v-else :size="27" fill="currentColor" />
            </button>
            <button aria-label="下一首" @click="emit('next')"><SkipForward :size="24" fill="currentColor" /></button>
          </div>
        </div>

        <aside class="now-playing-detail">
          <div class="detail-tabs">
            <button :class="{ active: tab === 'lyrics' }" @click="emit('tab', 'lyrics')"><Mic2 :size="16" /> 歌词 <small v-if="lyrics.length && !lyricsSynced">估算</small></button>
            <button :class="{ active: tab === 'queue' }" @click="emit('tab', 'queue')"><ListMusic :size="17" /> 队列</button>
          </div>

          <div
            v-if="tab === 'lyrics'"
            ref="lyricsView"
            class="lyrics-view"
            @wheel.passive="pauseAutoFollow"
            @touchstart.passive="pauseAutoFollow"
            @pointerdown="pauseAutoFollow"
          >
            <template v-if="lyrics.length">
              <button
                v-for="(line, index) in lyrics"
                :key="`${line.time}-${index}`"
                :ref="(element) => setLyricRow(element, index)"
                :class="{ active: index === activeLyric, past: index < activeLyric }"
                :disabled="line.time < 0"
                @click="seekLyric(line)"
              >{{ line.text }}</button>
              <button v-if="autoFollowPaused && lyrics.some((line) => line.time >= 0)" class="lyrics-follow" @click.stop="resumeAutoFollow"><LocateFixed :size="15" /> 跟随当前歌词</button>
            </template>
            <div v-else class="detail-empty"><Mic2 :size="28" /><strong>{{ track ? '未找到歌词' : '当前没有播放' }}</strong><span>{{ track ? '内嵌歌词和同名歌词文件会显示在这里。' : '选择一首曲目以加载歌词。' }}</span></div>
          </div>

          <div v-else class="queue-view">
            <div class="queue-view__heading"><span>接下来播放</span><div><small>{{ queue.length }} 首</small><button v-if="queue.some((item) => item.queueSource === 'explicit')" @click="emit('clearQueue')">清空队列</button></div></div>
            <div v-if="queue.length" class="queue-items">
              <div v-for="(item, index) in queue" :key="`${item.path}-${index}`" class="queue-item" @contextmenu.prevent.stop="emit('queueMenu', index, $event)">
                <span>{{ index + 1 }}</span>
                <button class="queue-item__copy" @click="emit('playQueue', index)"><strong>{{ item.title }}</strong><small>{{ item.artist }} · {{ item.album }} · {{ item.queueSource === 'explicit' ? '播放队列' : '当前播放列表' }}</small></button>
                <time>{{ formatTime(item.duration) }}</time>
                <div class="queue-item__actions">
                  <button title="移到队首" @click="emit('moveQueue', index)"><Zap :size="14" /></button>
                  <button v-if="item.queueSource === 'explicit'" title="移除" @click="emit('removeQueue', index)"><Trash2 :size="14" /></button>
                </div>
              </div>
            </div>
            <div v-else class="detail-empty"><ListMusic :size="28" /><strong>播放队列为空</strong><span>从任意列表添加曲目后，它们会显示在这里。</span></div>
          </div>
        </aside>
      </div>

      <button class="now-playing-panel__collapse" @click="emit('close')"><ChevronDown :size="20" /> 收起播放器</button>
    </section>
  </Transition>
</template>
