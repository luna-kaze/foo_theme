<script setup lang="ts">
import { ChevronDown, Filter, Plus, RotateCcw, Search, SlidersHorizontal, X } from '@lucide/vue'
import type { LibraryFilterOperator, LibraryFilterRule, LibraryFilterField, PlayerUiState } from '../types/music'
import { computed, ref } from 'vue'
import ThemeSelect, { type ThemeSelectOption } from './ThemeSelect.vue'

const props = defineProps<{ filters: PlayerUiState['libraryFilters']; options: { artists: string[]; albumArtists: string[]; genres: string[]; folders: string[] }; resultCount: number }>()
const emit = defineEmits<{
  facetChange: [key: 'artist' | 'albumArtist' | 'genre' | 'folder' | 'playState', value: string]
  ruleAdd: []
  ruleUpdate: [id: string, patch: Partial<Pick<LibraryFilterRule, 'field' | 'operator' | 'value'>>]
  ruleRemove: [id: string]
  clear: []
}>()
const expanded = ref(false)
const primaryRule = computed(() => props.filters.rules[0])
const activeCount = computed(() => props.filters.rules.filter((rule) => rule.value.trim()).length + [props.filters.artist, props.filters.albumArtist, props.filters.genre, props.filters.folder, props.filters.playState !== 'all'].filter(Boolean).length)
const genreOptions = computed<ThemeSelectOption[]>(() => [{ value: '', label: '全部' }, ...props.options.genres.map((genre) => ({ value: genre, label: genre }))])
const playStateOptions: ThemeSelectOption[] = [{ value: 'all', label: '全部' }, { value: 'played', label: '已播放' }, { value: 'unplayed', label: '未播放' }, { value: 'recent', label: '最近播放' }]
const fieldOptions: ThemeSelectOption[] = [{ value: 'all', label: '所有字段' }, { value: 'title', label: '标题' }, { value: 'artist', label: '艺人' }, { value: 'albumArtist', label: '专辑艺人' }, { value: 'album', label: '专辑' }, { value: 'genre', label: '流派' }, { value: 'path', label: '路径' }]
const operatorOptions: ThemeSelectOption[] = [{ value: 'contains', label: '包含' }, { value: 'equals', label: '等于' }, { value: 'startsWith', label: '开头为' }]

function updateField(rule: LibraryFilterRule, value: string) {
  emit('ruleUpdate', rule.id, { field: value as LibraryFilterField })
}

function updateOperator(rule: LibraryFilterRule, value: string) {
  emit('ruleUpdate', rule.id, { operator: value as LibraryFilterOperator })
}

</script>

<template>
  <section class="song-tools" :class="{ expanded }" aria-label="歌曲筛选与字段">
    <div class="song-tools__bar">
      <span class="song-tools__mark"><Filter :size="15" /></span>
      <label class="song-tools__search"><Search :size="14" /><input :value="primaryRule?.value" placeholder="在歌曲中筛选" @input="primaryRule && emit('ruleUpdate', primaryRule.id, { value: ($event.target as HTMLInputElement).value })" /></label>
      <div class="song-tools__chip"><span>流派</span><ThemeSelect :model-value="filters.genre" :options="genreOptions" select-label="按流派筛选" @update:model-value="emit('facetChange', 'genre', $event)" /></div>
      <div class="song-tools__chip"><span>播放</span><ThemeSelect :model-value="filters.playState" :options="playStateOptions" select-label="按播放统计筛选" @update:model-value="emit('facetChange', 'playState', $event)" /></div>
      <button class="song-tools__expand" :class="{ active: expanded }" @click="expanded = !expanded"><SlidersHorizontal :size="14" /><span>字段</span><i v-if="activeCount">{{ activeCount }}</i><ChevronDown :size="13" /></button>
      <small>{{ resultCount }} 首</small>
      <button class="song-tools__reset" aria-label="重置筛选" title="重置筛选" @click="emit('clear')"><RotateCcw :size="14" /></button>
    </div>
    <div v-if="expanded" class="song-tools__details">
      <div class="filter-rules">
        <div v-for="(rule, index) in filters.rules" :key="rule.id" class="filter-rule">
          <button v-if="index === 0" class="filter-rule__add" aria-label="添加筛选规则" title="添加规则" @click="emit('ruleAdd')"><Plus :size="15" /></button><span v-else class="filter-rule__gutter" />
          <ThemeSelect :model-value="rule.field" :options="fieldOptions" select-label="选择匹配字段" @update:model-value="updateField(rule, $event)" />
          <ThemeSelect :model-value="rule.operator" :options="operatorOptions" select-label="选择匹配方式" @update:model-value="updateOperator(rule, $event)" />
          <input :value="rule.value" placeholder="输入匹配内容" @input="emit('ruleUpdate', rule.id, { value: ($event.target as HTMLInputElement).value })" />
          <button aria-label="删除筛选规则" title="删除规则" @click="emit('ruleRemove', rule.id)"><X :size="14" /></button>
        </div>
      </div>
    </div>
  </section>
</template>
