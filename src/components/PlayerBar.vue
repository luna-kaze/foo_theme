<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ListMusic, Maximize2, Mic2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from '@lucide/vue'
import type { DisplayTrack } from '../types/music'
import { formatTime } from '../utils/format'
import ArtworkImage from './ArtworkImage.vue'

const props = defineProps<{
  track: DisplayTrack | null
  artwork: string
  isPlaying: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  playbackOrder: number
  nowPlayingOpen: boolean
  queueOpen: boolean
}>()

const seekPreview = ref<number | null>(null)
const shownPosition = computed(() => seekPreview.value ?? props.position)
const randomOrder = computed(() => props.playbackOrder >= 3)

function previewSeek(event: Event) {
  seekPreview.value = Number((event.target as HTMLInputElement).value)
}

function commitSeek(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  seekPreview.value = null
  emit('seek', value)
}

watch(() => props.track?.path, () => {
  seekPreview.value = null
})

const emit = defineEmits<{
  toggle: []
  next: []
  previous: []
  seek: [position: number]
  volume: [volume: number]
  mute: []
  order: []
  immersive: []
  queue: []
  menu: [track: DisplayTrack, event: MouseEvent]
}>()
</script>

<template>
  <footer class="player-bar">
    <button class="player-track" @click="emit('immersive')" @contextmenu.prevent.stop="track && emit('menu', track, $event)">
      <ArtworkImage :src="artwork || track?.artworkUrl" :alt="`${track?.album ?? '当前曲目'} 封面`" />
      <span class="player-track__copy">
        <strong>{{ track?.title || '当前没有播放' }}</strong>
        <small>{{ track?.artist || '从音乐库中选择一首曲目' }}</small>
      </span>
      <Maximize2 :size="15" class="player-track__expand" />
    </button>

    <div class="transport">
      <div class="transport__buttons">
        <button aria-label="上一首" @click="emit('previous')"><SkipBack :size="18" fill="currentColor" /></button>
        <button class="transport__play" :aria-label="isPlaying ? '暂停' : '播放'" @click="emit('toggle')">
          <Pause v-if="isPlaying" :size="20" fill="currentColor" />
          <Play v-else :size="20" fill="currentColor" />
        </button>
        <button aria-label="下一首" @click="emit('next')"><SkipForward :size="18" fill="currentColor" /></button>
      </div>
      <div class="player-progress">
        <span>{{ formatTime(shownPosition) }}</span>
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
        <span>{{ formatTime(duration) }}</span>
      </div>
    </div>

    <div class="player-actions">
      <button :class="{ active: playbackOrder !== 0 }" :aria-label="randomOrder ? '随机播放' : '切换循环模式'" @click="emit('order')">
        <Shuffle v-if="randomOrder" :size="17" />
        <Repeat1 v-if="playbackOrder === 2" :size="17" />
        <Repeat v-else-if="!randomOrder" :size="17" />
      </button>
      <button :class="{ active: nowPlayingOpen }" aria-label="沉浸播放" @click="emit('immersive')"><Mic2 :size="17" /></button>
      <button :class="{ active: queueOpen }" aria-label="播放队列" @click="emit('queue')"><ListMusic :size="18" /></button>
      <button aria-label="静音" @click="emit('mute')">
        <VolumeX v-if="muted || volume === 0" :size="18" />
        <Volume1 v-else-if="volume < 45" :size="18" />
        <Volume2 v-else :size="18" />
      </button>
      <input
        class="volume-slider"
        type="range"
        min="0"
        max="100"
        :value="muted ? 0 : volume"
        :style="{ '--progress': `${muted ? 0 : volume}%` }"
        aria-label="音量"
        @input="emit('volume', Number(($event.target as HTMLInputElement).value))"
      />
    </div>
  </footer>
</template>
