<script setup lang="ts">
import { Disc3, Repeat, Repeat1, Shuffle, Trash2, X, Zap } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DisplayQueueItem } from '../types/music'
import { formatTime } from '../utils/format'

const props = defineProps<{ queue: DisplayQueueItem[]; playbackOrder: number; shufflePending: boolean; shuffleStaged: boolean; shuffleSourceName: string }>()
const randomMode = computed(() => props.playbackOrder >= 3)
const repeatTrack = computed(() => props.playbackOrder === 2)
const repeatPlaylist = computed(() => props.playbackOrder === 1)

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
  const target = event.target as HTMLElement | null
  if (target?.closest('[aria-label="播放队列"]')) return
  if (!root.value?.contains(target as Node)) emit('close')
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<template>
  <aside ref="root" class="immersive-queue-card queue-popover" aria-label="播放队列" @pointerdown.stop>
    <header><div><span>{{ randomMode ? '宿主随机播放' : repeatTrack ? '单曲循环' : repeatPlaylist ? '列表循环' : '接下来播放' }}</span><small>{{ randomMode ? '宿主顺序不可预测' : repeatTrack ? '当前曲目将重复' : repeatPlaylist ? '列表结束后从头播放' : `${queue.length} 首` }}</small></div><button aria-label="关闭队列" @click="emit('close')"><X :size="17" /></button></header>
    <div v-if="shuffleSourceName" class="queue-popover__random"><Disc3 :size="17" /><span><strong>{{ shuffleStaged ? '最新编辑待提交' : shufflePending ? '播放计划待接管' : '播放工作集' }}</strong><small>{{ shuffleStaged ? '下方是最新编辑计划，可以继续加入、删除和置顶；等待宿主释放缓冲后应用。' : shufflePending ? '当前曲继续播放，下一首接管已提交计划。' : '后续曲目来自独立工作集，不受原歌单编辑影响。' }}</small></span></div>
    <div v-else-if="randomMode" class="queue-popover__random"><Shuffle :size="17" /><span><strong>宿主随机播放中</strong><small>可在 Coverflow 右上角随机重排计划工作集；宿主模式由 foobar2000 决定。</small></span></div>
    <div v-else-if="repeatTrack" class="queue-popover__random"><Repeat1 :size="17" /><span><strong>单曲循环中</strong><small>当前曲目播放结束后会再次播放；显式队列不会被伪装成普通后续顺序。</small></span></div>
    <div v-else-if="repeatPlaylist" class="queue-popover__random"><Repeat :size="17" /><span><strong>列表循环中</strong><small>到达列表末尾后会从第一首继续播放。</small></span></div>
    <div v-if="queue.length" class="immersive-queue-card__items">
      <div v-for="(item, index) in queue" :key="item.playbackId || `${item.path}-${index}`" class="immersive-queue-item" @contextmenu.prevent.stop="emit('menu', index, $event)">
        <button class="immersive-queue-item__copy" @click="emit('play', index)"><strong>{{ item.title }}</strong><small>{{ item.artist }} · {{ item.queueSource === 'explicit' ? '播放队列' : '当前播放列表' }}</small></button>
        <time>{{ formatTime(item.duration) }}</time>
        <button class="queue-icon-action" title="设为下一首" @click="emit('move', index)"><Zap :size="14" /></button>
        <button v-if="item.playbackId || item.queueSource === 'explicit'" class="queue-icon-action" title="移除" @click="emit('remove', index)"><Trash2 :size="14" /></button>
      </div>
    </div>
    <div v-else-if="!randomMode && !repeatTrack" class="immersive-empty"><Disc3 :size="28" /><strong>队列为空</strong><span>当前播放列表中的后续曲目会显示在这里。</span></div>
    <button v-if="queue.length" class="immersive-queue-card__clear" @click="emit('clear')">清空后续计划</button>
  </aside>
</template>
