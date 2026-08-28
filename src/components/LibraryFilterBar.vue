<script setup lang="ts">
import { Filter, RotateCcw, Search } from '@lucide/vue'
import type { PlayerUiState } from '../types/music'
import { ref } from 'vue'

const props = defineProps<{ filters: PlayerUiState['libraryFilters']; options: { artists: string[]; albumArtists: string[]; genres: string[]; folders: string[] }; resultCount: number; customColumn: PlayerUiState['customColumn'] }>()
const emit = defineEmits<{ change: [key: keyof PlayerUiState['libraryFilters'], value: string]; clear: []; customColumn: [label: string, pattern: string] }>()
const customLabel = ref(props.customColumn.label)
const customPattern = ref(props.customColumn.pattern)
</script>

<template>
  <section class="library-filters" aria-label="歌曲筛选与字段">
    <header><div><Filter :size="16" /><strong>歌曲筛选与字段</strong><span>{{ resultCount }} 首</span></div><button @click="emit('clear')"><RotateCcw :size="14" />重置</button></header>
    <div class="library-filters__facets">
      <label><span>流派</span><select :value="filters.genre" @change="emit('change', 'genre', ($event.target as HTMLSelectElement).value)"><option value="">全部流派</option><option v-for="item in options.genres" :key="item">{{ item }}</option></select></label>
      <label><span>播放统计</span><select :value="filters.playState" @change="emit('change', 'playState', ($event.target as HTMLSelectElement).value)"><option value="all">全部曲目</option><option value="played">已播放</option><option value="unplayed">未播放</option><option value="recent">最近播放</option></select></label>
    </div>
    <div class="library-filters__advanced"><Search :size="15" /><select :value="filters.field" @change="emit('change', 'field', ($event.target as HTMLSelectElement).value)"><option value="all">所有字段</option><option value="title">标题</option><option value="artist">艺人</option><option value="album">专辑</option><option value="genre">流派</option><option value="path">路径</option></select><select :value="filters.operator" @change="emit('change', 'operator', ($event.target as HTMLSelectElement).value)"><option value="contains">包含</option><option value="equals">等于</option><option value="startsWith">开头为</option></select><input :value="filters.value" placeholder="高级筛选值" @input="emit('change', 'value', ($event.target as HTMLInputElement).value)" /></div>
    <form class="library-filters__format" @submit.prevent="emit('customColumn', customLabel, customPattern)"><input v-model="customLabel" placeholder="自定义列名" /><input v-model="customPattern" placeholder="Title Formatting，例如 %codec%" /><button class="secondary-button">应用列</button></form>
  </section>
</template>
