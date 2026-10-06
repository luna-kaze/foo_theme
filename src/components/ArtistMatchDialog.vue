<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Search, X } from '@lucide/vue'
import { applyArtistMatch, chooseArtistPhoto, getArtistProfile, previewArtistMatch, searchArtistMatches, type ArtistMatchCandidate, type ArtistMatchKind, type ArtistMatchPreview } from '../composables/useArtistProfiles'

const props = defineProps<{ name: string; kind: ArtistMatchKind }>()
const emit = defineEmits<{ close: []; applied: [kind: ArtistMatchKind] }>()
const root = ref<HTMLElement | null>(null)
const kind = ref<ArtistMatchKind>(props.kind), query = ref('')
const candidates = ref<ArtistMatchCandidate[]>([]), preview = ref<ArtistMatchPreview | null>(null)
const selectedId = ref(''), searching = ref(false), previewing = ref(false), saving = ref(false), error = ref(''), searched = ref(false)
let request = 0, selection = 0, disposed = false
const previousFocus = document.activeElement as HTMLElement | null
async function search() {
  const owner = ++request
  selection++; selectedId.value = ''; preview.value = null; candidates.value = []; error.value = ''; previewing.value = false
  if (!query.value.trim()) { searching.value = false; searched.value = false; return }
  searching.value = true; searched.value = true
  try {
    const result = await searchArtistMatches(props.name, kind.value, query.value)
    if (owner !== request || disposed) return
    candidates.value = result
    if (result.length === 1) void select(result[0]!)
  } catch (failure) { if (owner === request && !disposed) error.value = failure instanceof Error ? failure.message : '搜索失败。' }
  finally { if (owner === request) searching.value = false }
}
async function select(candidate: ArtistMatchCandidate) {
  const owner = ++selection
  selectedId.value = candidate.id; preview.value = null; previewing.value = true; error.value = ''
  try {
    const result = await previewArtistMatch(props.name, candidate)
    if (owner === selection && !disposed) preview.value = result
  } catch (failure) { if (owner === selection && !disposed) error.value = failure instanceof Error ? failure.message : '无法读取此候选。' }
  finally { if (owner === selection) previewing.value = false }
}
async function apply() {
  if (!preview.value || saving.value) return
  saving.value = true; error.value = ''
  try { await applyArtistMatch(props.name, preview.value); if (!disposed) emit('applied', kind.value) }
  catch (failure) { if (!disposed) error.value = failure instanceof Error ? failure.message : '保存失败。' }
  finally { saving.value = false }
}
async function localPhoto() {
  saving.value = true; error.value = ''
  try { if (await chooseArtistPhoto(props.name) && !disposed) emit('applied', 'picture') }
  catch (failure) { if (!disposed) error.value = failure instanceof Error ? failure.message : '无法选择照片。' }
  finally { saving.value = false }
}
watch(kind, value => {
  const profile = getArtistProfile(props.name)
  query.value = (value === 'picture' ? profile.photoSearchName : profile.searchName) || props.name
  void search()
}, { immediate: true })
function keyboard(event: KeyboardEvent) {
  if ((event.target as HTMLElement | null)?.closest?.('.image-picker-dialog')) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!saving.value) emit('close'); return }
  if (event.key !== 'Tab') return
  const elements = [...root.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []]
  if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
}
onMounted(async () => { window.addEventListener('keydown', keyboard, true); await nextTick(); root.value?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }) })
onBeforeUnmount(() => { disposed = true; request++; selection++; window.removeEventListener('keydown', keyboard, true); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) })
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop artist-match-backdrop" @click.self="!saving && emit('close')" @contextmenu.prevent.stop>
      <section ref="root" class="artist-match-panel" role="dialog" aria-modal="true" aria-labelledby="artist-match-title">
        <header><div><h2 id="artist-match-title">修正艺术家资料</h2><small>{{ name }} · 只更换当前选中的资料类型</small></div><button aria-label="关闭匹配窗口" :disabled="saving" @click="emit('close')"><X :size="18" /></button></header>
        <div class="artist-match-tabs" role="tablist"><button role="tab" :aria-selected="kind === 'picture'" :disabled="saving" @click="kind = 'picture'">照片</button><button role="tab" :aria-selected="kind === 'info'" :disabled="saving" @click="kind = 'info'">简介</button></div>
        <form class="artist-match-search" @submit.prevent="search"><label class="sr-only" for="artist-match-query">艺术家名字</label><input id="artist-match-query" v-model="query" maxlength="200" :disabled="saving" placeholder="输入名字、日文名或其他别名" /><button class="secondary-button" :disabled="saving || !query.trim()"><Search :size="15" />搜索</button></form>
        <div class="artist-match-content">
          <p v-if="searching" role="status">正在搜索候选…</p><p v-else-if="searched && !candidates.length && !error">未找到候选，请尝试其他名字。</p>
          <div class="artist-match-candidates"><button v-for="candidate in candidates" :key="candidate.id" :class="{ selected: selectedId === candidate.id }" :aria-pressed="selectedId === candidate.id" :disabled="saving" @click="select(candidate)"><span v-if="kind === 'picture'" class="artist-match-thumb"><img v-if="preview?.candidate.id === candidate.id && preview.image" :src="preview.image" alt="" /><i v-else>{{ [...candidate.name][0] }}</i></span><span><strong>{{ candidate.name }}</strong><small>{{ candidate.detail }}</small></span></button></div>
          <p v-if="previewing" role="status">正在读取预览…</p>
          <section v-if="preview" class="artist-match-preview"><img v-if="kind === 'picture'" :src="preview.image" :alt="`${preview.candidate.name} 照片预览`" /><template v-else><h3>{{ preview.candidate.name }}</h3><p>{{ preview.biography || '此身份暂未提供可用简介；确认后将显示暂无简介，可稍后刷新。' }}</p></template><small>{{ preview.source }}</small></section>
          <p v-if="error" class="artist-profile__message" role="alert">{{ error }}</p>
        </div>
        <footer><button v-if="kind === 'picture'" class="artist-profile__text-button" :disabled="saving" @click="localPhoto">使用本地照片…</button><small v-else>不会更换照片或修改歌曲标签</small><button class="primary-button" :disabled="!preview || searching || previewing || saving" @click="apply">{{ saving ? '保存中…' : '使用此结果' }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>
