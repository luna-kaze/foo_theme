<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { ListPlus, X } from '@lucide/vue'

const emit = defineEmits<{
  close: []
  create: [name: string]
}>()

const name = ref('')
const input = ref<HTMLInputElement | null>(null)

onMounted(() => void nextTick(() => input.value?.focus()))

function submit() {
  if (name.value.trim()) emit('create', name.value)
}
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="emit('close')">
    <form class="create-playlist-dialog" @submit.prevent="submit">
      <header>
        <span><ListPlus :size="19" /></span>
        <div><strong>新建播放列表</strong><small>在 foobar2000 中创建一个空播放列表。</small></div>
        <button type="button" aria-label="关闭" @click="emit('close')"><X :size="18" /></button>
      </header>
      <label>
        播放列表名称
        <input ref="input" v-model="name" maxlength="120" placeholder="我的播放列表" />
      </label>
      <footer>
        <button type="button" class="secondary-button" @click="emit('close')">取消</button>
        <button type="submit" class="primary-button" :disabled="!name.trim()">创建</button>
      </footer>
    </form>
  </div>
</template>
