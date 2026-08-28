<script setup lang="ts">
import { ChevronDown, Filter, RotateCcw, Search, SlidersHorizontal } from '@lucide/vue'
import type { PlayerUiState } from '../types/music'
import { computed, ref } from 'vue'
import ThemeSelect, { type ThemeSelectOption } from './ThemeSelect.vue'

const props = defineProps<{ filters: PlayerUiState['libraryFilters']; options: { artists: string[]; albumArtists: string[]; genres: string[]; folders: string[] }; resultCount: number; customColumn: PlayerUiState['customColumn'] }>()
const emit = defineEmits<{ change: [key: keyof PlayerUiState['libraryFilters'], value: string]; clear: []; customColumn: [label: string, pattern: string] }>()
const customLabel = ref(props.customColumn.label)
const customPattern = ref(props.customColumn.pattern)
const expanded = ref(false)
const activeCount = computed(() => [props.filters.genre, props.filters.playState !== 'all', props.filters.value, props.customColumn.pattern].filter(Boolean).length)
const genreOptions = computed<ThemeSelectOption[]>(() => [{ value: '', label: '全部' }, ...props.options.genres.map((genre) => ({ value: genre, label: genre }))])
const playStateOptions: ThemeSelectOption[] = [{ value: 'all', label: '全部' }, { value: 'played', label: '已播放' }, { value: 'unplayed', label: '未播放' }, { value: 'recent', label: '最近播放' }]
const fieldOptions: ThemeSelectOption[] = [{ value: 'all', label: '所有字段' }, { value: 'title', label: '标题' }, { value: 'artist', label: '艺人' }, { value: 'album', label: '专辑' }, { value: 'genre', label: '流派' }, { value: 'path', label: '路径' }]
const operatorOptions: ThemeSelectOption[] = [{ value: 'contains', label: '包含' }, { value: 'equals', label: '等于' }, { value: 'startsWith', label: '开头为' }]
</script>

<template>
  <section class="song-tools" :class="{ expanded }" aria-label="歌曲筛选与字段">
    <div class="song-tools__bar">
      <span class="song-tools__mark"><Filter :size="15" /></span>
      <label class="song-tools__search"><Search :size="14" /><input :value="filters.value" placeholder="在歌曲中筛选" @input="emit('change', 'value', ($event.target as HTMLInputElement).value)" /></label>
      <div class="song-tools__chip"><span>流派</span><ThemeSelect :model-value="filters.genre" :options="genreOptions" select-label="按流派筛选" @update:model-value="emit('change', 'genre', $event)" /></div>
      <div class="song-tools__chip"><span>播放</span><ThemeSelect :model-value="filters.playState" :options="playStateOptions" select-label="按播放统计筛选" @update:model-value="emit('change', 'playState', $event)" /></div>
      <button class="song-tools__expand" :class="{ active: expanded }" @click="expanded = !expanded"><SlidersHorizontal :size="14" /><span>字段</span><i v-if="activeCount">{{ activeCount }}</i><ChevronDown :size="13" /></button>
      <small>{{ resultCount }} 首</small>
      <button class="song-tools__reset" aria-label="重置筛选" title="重置筛选" @click="emit('clear')"><RotateCcw :size="14" /></button>
    </div>
    <div v-if="expanded" class="song-tools__details">
      <div><span>匹配规则</span><ThemeSelect :model-value="filters.field" :options="fieldOptions" select-label="选择匹配字段" @update:model-value="emit('change', 'field', $event)" /><ThemeSelect :model-value="filters.operator" :options="operatorOptions" select-label="选择匹配方式" @update:model-value="emit('change', 'operator', $event)" /></div>
      <form @submit.prevent="emit('customColumn', customLabel, customPattern)"><span>自定义列</span><input v-model="customLabel" placeholder="列名" /><input v-model="customPattern" placeholder="Title Formatting，例如 %codec%" /><button>应用</button></form>
    </div>
  </section>
</template>
