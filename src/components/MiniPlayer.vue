<script setup lang="ts">
import { Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from '@lucide/vue'
import type { DisplayTrack } from '../types/music'
import { formatTime } from '../utils/format'
import ArtworkImage from './ArtworkImage.vue'

defineProps<{
  track: DisplayTrack | null
  artwork: string
  isPlaying: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
}>()

const emit = defineEmits<{
  toggle: []
  next: []
  previous: []
  seek: [position: number]
  mute: []
  drag: []
  close: []
}>()
</script>

<template>
  <main class="mini-player">
    <div class="mini-player__backdrop" :style="artwork ? { backgroundImage: `url(${artwork})` } : {}" />
    <div class="mini-player__drag" @pointerdown.left="emit('drag')" />
    <ArtworkImage :src="artwork || track?.artworkUrl" :alt="`${track?.album ?? '当前曲目'} 封面`" />
    <section class="mini-player__copy">
      <strong>{{ track?.title || '当前没有播放' }}</strong>
      <span>{{ track?.artist || '从音乐库中选择一首曲目' }}</span>
      <div class="mini-player__progress">
        <input type="range" min="0" :max="Math.max(duration, 1)" step="0.1" :value="position" :style="{ '--progress': `${duration ? (position / duration) * 100 : 0}%` }" @change="emit('seek', Number(($event.target as HTMLInputElement).value))" />
        <small>{{ formatTime(position) }} / {{ formatTime(duration) }}</small>
      </div>
    </section>
    <div class="mini-player__transport">
      <button aria-label="上一首" data-tip="上一首" @click="emit('previous')"><SkipBack :size="17" fill="currentColor" /></button>
      <button class="mini-player__play" :aria-label="isPlaying ? '暂停' : '播放'" :data-tip="isPlaying ? '暂停' : '播放'" @click="emit('toggle')"><Pause v-if="isPlaying" :size="19" fill="currentColor" /><Play v-else :size="19" fill="currentColor" /></button>
      <button aria-label="下一首" data-tip="下一首" @click="emit('next')"><SkipForward :size="17" fill="currentColor" /></button>
      <button :aria-label="muted ? '取消静音' : '静音'" :data-tip="muted ? '取消静音' : '静音'" @click="emit('mute')"><VolumeX v-if="muted || volume === 0" :size="17" /><Volume1 v-else-if="volume < 45" :size="17" /><Volume2 v-else :size="17" /></button>
    </div>
    <button class="mini-player__close" aria-label="关闭迷你播放器" data-tip="关闭" @click="emit('close')"><X :size="16" /></button>
  </main>
</template>
