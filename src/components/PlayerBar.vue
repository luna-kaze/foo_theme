<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ListMusic, Maximize2, Mic2, Pause, Play, Repeat, Repeat1, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from '@lucide/vue'
import type { DisplayTrack } from '../types/music'
import { formatTime } from '../utils/format'
import ArtworkImage from './ArtworkImage.vue'
import { trackKey } from '../utils/track'

const props = defineProps<{
  track: DisplayTrack | null
  artwork: string
  isPlaying: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  canSeek: boolean
  playbackOrder: number
  shuffleBusy: boolean
  shufflePending: boolean
  shuffleStaged: boolean
  nowPlayingOpen: boolean
  fullscreen: boolean
  airplay?: boolean
  remoteMessage?: string
  queueOpen: boolean
}>()

const seekPreview = ref<number | null>(null)
const shownPosition = computed(() => seekPreview.value ?? props.position)
const modeLabel = computed(() => ['默认播放', '列表循环', '单曲循环'][props.playbackOrder] || '默认播放')
const modeTitle = computed(() => `${modeLabel.value} · 点击切换下一模式${props.shuffleStaged ? ' · 修改待应用' : props.shufflePending ? ' · 计划待下一曲接管' : ''}`)

function previewSeek(event: Event) {
  seekPreview.value = Number((event.target as HTMLInputElement).value)
}

function commitSeek(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  seekPreview.value = null
  emit('seek', value)
}

watch(() => trackKey(props.track), () => {
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
  fullscreenImmersive: []
  queue: []
  menu: [track: DisplayTrack, event: MouseEvent]
}>()
</script>

<template>
  <footer class="player-bar">
    <button class="player-track" data-external-play-target aria-label="切换窗口沉浸播放" :aria-pressed="nowPlayingOpen && !fullscreen" @click="emit('immersive')" @contextmenu.prevent.stop="track && emit('menu', track, $event)">
      <ArtworkImage :src="artwork || track?.artworkUrl" :alt="`${track?.album ?? '当前曲目'} 封面`" />
      <span class="player-track__copy">
        <strong>{{ track?.title || '当前没有播放' }}</strong>
        <small>{{ airplay ? `AirPlay · ${remoteMessage || track?.artist || '实时音频'}` : track?.artist || '从音乐库中选择一首曲目' }}</small>
      </span>
      <Mic2 :size="15" class="player-track__expand" />
    </button>

    <div class="transport">
      <div class="transport__buttons">
        <button :aria-label="airplay ? 'AirPlay 发送端上一首' : '上一首'" @click="emit('previous')"><SkipBack :size="18" fill="currentColor" /></button>
        <button class="transport__play" :aria-label="isPlaying ? '暂停' : '播放'" @click="emit('toggle')">
          <Pause v-if="isPlaying" :size="20" fill="currentColor" />
          <Play v-else :size="20" fill="currentColor" />
        </button>
        <button :aria-label="airplay ? 'AirPlay 发送端下一首' : '下一首'" @click="emit('next')"><SkipForward :size="18" fill="currentColor" /></button>
      </div>
      <div class="player-progress">
        <span>{{ formatTime(shownPosition) }}</span>
        <input
          type="range"
          min="0"
          :max="Math.max(duration, 1)"
          step="0.1"
          :value="shownPosition"
          :disabled="!canSeek"
          :style="{ '--progress': `${duration ? (shownPosition / duration) * 100 : 0}%` }"
          @input="previewSeek"
          @change="commitSeek"
          @pointercancel="seekPreview = null"
          @blur="seekPreview = null"
        />
        <span>{{ formatTime(duration) }}</span>
      </div>
    </div>

    <div class="player-actions">
      <button :class="{ active: playbackOrder !== 0 }" :disabled="shuffleBusy || airplay" :aria-label="airplay ? '播放顺序由 AirPlay 发送端控制' : modeTitle" :title="airplay ? '播放顺序由 AirPlay 发送端控制' : modeTitle" @click="emit('order')">
        <Repeat1 v-if="playbackOrder === 2" :size="17" />
        <Repeat v-else :size="17" />
      </button>
      <button :class="{ active: nowPlayingOpen && fullscreen }" :aria-pressed="nowPlayingOpen && fullscreen" aria-label="切换全屏沉浸播放" @click="emit('fullscreenImmersive')"><Maximize2 :size="17" /></button>
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
