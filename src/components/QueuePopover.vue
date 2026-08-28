<script setup lang="ts">
import { Disc3, Shuffle, Trash2, X, Zap } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { DisplayQueueItem } from '../types/music'
import { formatTime } from '../utils/format'

defineProps<{ queue: DisplayQueueItem[]; randomMode: boolean }>()

const emit = defineEmits<{
  close: []
  play: [index: number]
  remove: [index: number]
  move: [index: number]
  clear: []
  menu: [index: number, event: MouseEvent]
}>()

const root = ref<HTMLElement | null>(null)

function onPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) emit('close')
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<template>
  <aside ref="root" class="immersive-queue-card queue-popover" aria-label="播放队列" @pointerdown.stop>
    <header><div><span>{{ randomMode ? '随机播放' : '接下来播放' }}</span><small>{{ randomMode ? '顺序不可预测' : `${queue.length} 首` }}</small></div><button aria-label="关闭队列" @click="emit('close')"><X :size="17" /></button></header>
    <div v-if="randomMode" class="queue-popover__random"><Shuffle :size="17" /><span><strong>随机播放中</strong><small>后续曲目由 foobar2000 随机选择；显式加入的队列仍会显示在下方。</small></span></div>
    <div v-if="queue.length" class="immersive-queue-card__items">
      <div v-for="(item, index) in queue" :key="`${item.path}-${index}`" class="immersive-queue-item" @contextmenu.prevent.stop="emit('menu', index, $event)">
        <button class="immersive-queue-item__copy" @click="emit('play', index)"><strong>{{ item.title }}</strong><small>{{ item.artist }} · {{ item.queueSource === 'explicit' ? '播放队列' : '当前播放列表' }}</small></button>
        <time>{{ formatTime(item.duration) }}</time>
        <button class="queue-icon-action" title="设为下一首" @click="emit('move', index)"><Zap :size="14" /></button>
        <button v-if="item.queueSource === 'explicit'" class="queue-icon-action" title="移除" @click="emit('remove', index)"><Trash2 :size="14" /></button>
      </div>
    </div>
    <div v-else-if="!randomMode" class="immersive-empty"><Disc3 :size="28" /><strong>队列为空</strong><span>当前播放列表中的后续曲目会显示在这里。</span></div>
    <button v-if="queue.some((item) => item.queueSource === 'explicit')" class="immersive-queue-card__clear" @click="emit('clear')">清空显式队列</button>
  </aside>
</template>
