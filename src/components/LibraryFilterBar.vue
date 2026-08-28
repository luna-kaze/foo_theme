<script setup lang="ts">
import { ChevronDown, Filter, RotateCcw, Search, SlidersHorizontal } from '@lucide/vue'
import type { PlayerUiState } from '../types/music'
import { computed, ref } from 'vue'

const props = defineProps<{ filters: PlayerUiState['libraryFilters']; options: { artists: string[]; albumArtists: string[]; genres: string[]; folders: string[] }; resultCount: number; customColumn: PlayerUiState['customColumn'] }>()
const emit = defineEmits<{ change: [key: keyof PlayerUiState['libraryFilters'], value: string]; clear: []; customColumn: [label: string, pattern: string] }>()
const customLabel = ref(props.customColumn.label)
const customPattern = ref(props.customColumn.pattern)
const expanded = ref(false)
const activeCount = computed(() => [props.filters.genre, props.filters.playState !== 'all', props.filters.value, props.customColumn.pattern].filter(Boolean).length)
</script>

<template>
  <section class="song-tools" :class="{ expanded }" aria-label="歌曲筛选与字段">
    <div class="song-tools__bar">
      <span class="song-tools__mark"><Filter :size="15" /></span>
      <label class="song-tools__search"><Search :size="14" /><input :value="filters.value" placeholder="在歌曲中筛选" @input="emit('change', 'value', ($event.target as HTMLInputElement).value)" /></label>
      <label class="song-tools__chip"><span>流派</span><select :value="filters.genre" aria-label="按流派筛选" @change="emit('change', 'genre', ($event.target as HTMLSelectElement).value)"><option value="">全部</option><option v-for="item in options.genres" :key="item">{{ item }}</option></select></label>
      <label class="song-tools__chip"><span>播放</span><select :value="filters.playState" aria-label="按播放统计筛选" @change="emit('change', 'playState', ($event.target as HTMLSelectElement).value)"><option value="all">全部</option><option value="played">已播放</option><option value="unplayed">未播放</option><option value="recent">最近播放</option></select></label>
      <button class="song-tools__expand" :class="{ active: expanded }" @click="expanded = !expanded"><SlidersHorizontal :size="14" /><span>字段</span><i v-if="activeCount">{{ activeCount }}</i><ChevronDown :size="13" /></button>
      <small>{{ resultCount }} 首</small>
      <button class="song-tools__reset" aria-label="重置筛选" title="重置筛选" @click="emit('clear')"><RotateCcw :size="14" /></button>
    </div>
    <div v-if="expanded" class="song-tools__details">
      <div><span>匹配规则</span><select :value="filters.field" @change="emit('change', 'field', ($event.target as HTMLSelectElement).value)"><option value="all">所有字段</option><option value="title">标题</option><option value="artist">艺人</option><option value="album">专辑</option><option value="genre">流派</option><option value="path">路径</option></select><select :value="filters.operator" @change="emit('change', 'operator', ($event.target as HTMLSelectElement).value)"><option value="contains">包含</option><option value="equals">等于</option><option value="startsWith">开头为</option></select></div>
      <form @submit.prevent="emit('customColumn', customLabel, customPattern)"><span>自定义列</span><input v-model="customLabel" placeholder="列名" /><input v-model="customPattern" placeholder="Title Formatting，例如 %codec%" /><button>应用</button></form>
    </div>
  </section>
</template>
