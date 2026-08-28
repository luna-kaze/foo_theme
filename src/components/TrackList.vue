<script setup lang="ts">
import { Heart, MoreHorizontal, Pause, Play, Volume2 } from '@lucide/vue'
import type { DisplayTrack } from '../types/music'
import { formatTime } from '../utils/format'
import ArtworkImage from './ArtworkImage.vue'
import { isSameTrack, trackKey } from '../utils/track'

defineProps<{
  tracks: DisplayTrack[]
  currentTrack: DisplayTrack | null
  isPlaying: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  play: [track: DisplayTrack, index: number]
  menu: [track: DisplayTrack, index: number, event: MouseEvent]
}>()

function isCurrent(track: DisplayTrack, currentTrack: DisplayTrack | null) {
  return isSameTrack(track, currentTrack)
}
</script>

<template>
  <div class="track-list" :class="{ compact }">
    <div class="track-list__header">
      <span>#</span><span>标题</span><span>专辑</span><span>年份</span><span>时长</span><span />
    </div>
    <div
      v-for="(track, index) in tracks"
      :key="`${trackKey(track)}-${index}`"
      class="track-row"
      :class="{ current: isCurrent(track, currentTrack) }"
      role="button"
      tabindex="0"
      @click="emit('play', track, index)"
      @keydown.enter.self.stop="emit('play', track, index)"
      @keydown.space.self.stop.prevent="emit('play', track, index)"
      @contextmenu.prevent="emit('menu', track, index, $event)"
    >
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
      <span class="track-row__duration">{{ formatTime(track.duration) }}</span>
      <span class="track-row__more">
        <Heart v-if="Number(track.rating ?? 0) === 5" :size="13" fill="currentColor" class="track-row__favourite" />
        <button aria-label="曲目操作" @keydown.stop @click.stop="emit('menu', track, index, $event)"><MoreHorizontal :size="17" /></button>
      </span>
    </div>
  </div>
</template>
