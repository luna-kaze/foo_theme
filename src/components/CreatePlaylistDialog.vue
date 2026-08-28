<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { ListPlus, X } from '@lucide/vue'

const emit = defineEmits<{
  close: []
  create: [name: string, options?: { query: string; sort: string; keepSorted: boolean }]
}>()

const name = ref('')
const input = ref<HTMLInputElement | null>(null)
const automatic = ref(false)
const query = ref('ALL')
const sort = ref('%album artist%|%date%|%album%|%discnumber%|%tracknumber%')
const keepSorted = ref(true)

onMounted(() => void nextTick(() => input.value?.focus()))

function submit() {
  if (name.value.trim()) emit('create', name.value, automatic.value ? { query: query.value.trim(), sort: sort.value.trim(), keepSorted: keepSorted.value } : undefined)
}
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="emit('close')">
    <form class="create-playlist-dialog" @submit.prevent="submit">
      <header>
        <span><ListPlus :size="19" /></span>
         <div><strong>新建播放列表</strong><small>创建普通列表，或使用 foobar2000 查询自动维护。</small></div>
        <button type="button" aria-label="关闭" @click="emit('close')"><X :size="18" /></button>
      </header>
      <label>
        播放列表名称
        <input ref="input" v-model="name" maxlength="120" placeholder="我的播放列表" />
      </label>
      <label class="dialog-check"><input v-model="automatic" type="checkbox" />自动播放列表</label>
      <template v-if="automatic">
        <label>查询表达式<input v-model="query" placeholder="例如：rating IS 5" /></label>
        <label>Title Formatting 排序<input v-model="sort" placeholder="%album artist%|%album%|%tracknumber%" /></label>
        <label class="dialog-check"><input v-model="keepSorted" type="checkbox" />始终保持排序</label>
      </template>
      <footer>
        <button type="button" class="secondary-button" @click="emit('close')">取消</button>
        <button type="submit" class="primary-button" :disabled="!name.trim() || (automatic && !query.trim())">创建</button>
      </footer>
    </form>
  </div>
</template>
