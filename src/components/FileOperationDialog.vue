<script setup lang="ts">
import { ref } from 'vue'
import { AlertTriangle, FilePenLine, Trash2, X } from '@lucide/vue'
import type { DisplayTrack } from '../types/music'

const props = defineProps<{ track: DisplayTrack; mode: 'rename' | 'move' | 'delete'; target?: string; busy: boolean }>()
const emit = defineEmits<{ close: []; rename: [name: string]; move: []; delete: [] }>()
const original = (props.track.absolutePath || props.track.path).replaceAll('/', '\\').split('\\').at(-1) || ''
const name = ref(original)
</script>

<template>
  <div class="modal-backdrop" @pointerdown.self="emit('close')">
    <form class="create-playlist-dialog" @submit.prevent="mode === 'rename' ? emit('rename', name) : mode === 'move' ? emit('move') : emit('delete')">
      <header><span><FilePenLine v-if="mode !== 'delete'" :size="19" /><Trash2 v-else :size="19" /></span><div><strong>{{ mode === 'rename' ? '重命名文件' : mode === 'move' ? '确认移动文件' : '移动到回收站' }}</strong><small>{{ track.title }} · {{ track.artist }}</small></div><button type="button" aria-label="关闭" @click="emit('close')"><X :size="18" /></button></header>
      <label v-if="mode === 'rename'">新文件名<input v-model="name" /></label>
      <template v-else><p class="file-danger-note"><AlertTriangle :size="17" />{{ mode === 'delete' ? '确认将此真实媒体文件移动到回收站？此操作不会仅从播放列表移除。' : '该操作会移动真实媒体文件，而不是仅从播放列表移除。' }}</p><code>{{ mode === 'move' ? target : track.absolutePath || track.path }}</code></template>
      <footer><button type="button" class="secondary-button" @click="emit('close')">取消</button><button type="submit" :class="mode === 'delete' ? 'danger-button' : 'primary-button'" :disabled="busy || (mode === 'rename' && !name.trim())">{{ busy ? '处理中…' : mode === 'rename' ? '重命名' : mode === 'move' ? '确认移动' : '移动到回收站' }}</button></footer>
    </form>
  </div>
</template>
