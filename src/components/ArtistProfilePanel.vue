<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { ChevronDown, ExternalLink, RefreshCw } from '@lucide/vue'
import ArtistPortrait from './ArtistPortrait.vue'
import ArtistMatchDialog from './ArtistMatchDialog.vue'
import { artistBiography, artistPortraitLink, artistPortraitSource, artistPortraitUrl, artistProfilesConnected, ensureArtistPortrait, getArtistProfile, loadOnlineArtistProfile, openArtistSource, type ArtistMatchKind } from '../composables/useArtistProfiles'
const props = defineProps<{ name: string; trackCount: number; albumCount: number }>()
const profile = computed(() => getArtistProfile(props.name))
const connected = computed(artistProfilesConnected)
const portraitSource = computed(() => artistPortraitSource(profile.value)), portraitLink = computed(() => artistPortraitLink(profile.value))
const biography = computed(() => artistBiography(profile.value))
const expanded = ref(false), busy = ref(false), note = ref(''), menuOpen = ref(false), matchKind = ref<ArtistMatchKind | null>(null)
const menuRoot = ref<HTMLElement | null>(null)
watch(() => props.name, name => { expanded.value = false; menuOpen.value = false; matchKind.value = null; note.value = ''; void ensureArtistPortrait(name) }, { immediate: true })
async function refresh() {
  const name = props.name
  busy.value = true; note.value = ''; menuOpen.value = false
  try {
    const result = await loadOnlineArtistProfile(name)
    if (name !== props.name) return
    const image = Boolean(artistPortraitUrl(result)), intro = Boolean(artistBiography(result).text)
    note.value = image && intro ? '资料已更新' : image ? '照片已更新，暂未取得可用简介。' : intro ? '简介已更新，照片暂不可用。' : '暂未取得可用照片或简介，可通过右侧菜单搜索匹配。'
    if (result.status === 'error') note.value = `${result.message || '获取失败，请稍后重试。'} 已保留已有资料。`
    else if (result.photoStatus === 'error' || result.lastfmStatus === 'error') note.value = '部分来源暂不可用，已保留可用资料，可稍后刷新。'
    if (result.status === 'ambiguous') note.value += ' 简介身份需要确认。'
    if (result.photoStatus === 'ambiguous') note.value += ' 照片匹配需要确认。'
  } catch (error) { if (name === props.name) note.value = error instanceof Error ? error.message : '获取失败，请稍后重试。' }
  finally { busy.value = false }
}
function match(kind: ArtistMatchKind) { menuOpen.value = false; matchKind.value = kind }
function closeMatch() { matchKind.value = null; void nextTick(() => menuRoot.value?.querySelector<HTMLButtonElement>('.artist-fetch__more')?.focus({ preventScroll: true })) }
function applied(kind: ArtistMatchKind) { closeMatch(); note.value = kind === 'picture' ? '照片匹配已保存，简介保持不变。' : '简介匹配已保存，照片保持不变。' }
function outside(event: PointerEvent) { if (!menuRoot.value?.contains(event.target as Node)) menuOpen.value = false }
function keyboard(event: KeyboardEvent) { if (event.key === 'Escape') menuOpen.value = false }
onMounted(() => { window.addEventListener('pointerdown', outside); window.addEventListener('keydown', keyboard) })
onDeactivated(() => { menuOpen.value = false; matchKind.value = null })
onBeforeUnmount(() => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', keyboard) })
</script>
<template>
  <section class="artist-profile">
    <ArtistPortrait :name="name" class="artist-profile__portrait" />
    <div class="artist-profile__copy">
      <p class="eyebrow">艺术家</p><h1>{{ name }}</h1>
      <p v-if="profile.canonicalName && profile.canonicalName !== name" class="artist-profile__canonical">{{ profile.canonicalName }}</p>
      <p class="artist-profile__counts">{{ trackCount }} 首曲目 · {{ albumCount }} 张专辑</p>
      <p v-if="profile.type || profile.country || profile.years" class="artist-profile__meta"><span v-if="profile.type">{{ profile.type }}</span><span v-if="profile.country">{{ profile.country }}</span><span v-if="profile.years">{{ profile.type === '个人' ? '生卒年' : '成立 / 活跃年份' }} {{ profile.years }}</span></p>
      <div v-if="profile.genres.length" class="artist-profile__genres"><span v-for="genre in profile.genres" :key="genre">{{ genre }}</span></div>
      <div class="artist-profile__actions"><div ref="menuRoot" class="artist-fetch" role="group" aria-label="艺术家资料">
        <button class="secondary-button" :disabled="!connected || busy || !!matchKind || profile.status === 'loading'" @click="refresh"><RefreshCw :size="14" :class="{ 'is-spinning': busy }" />{{ busy ? '正在获取…' : profile.updatedAt || profile.lastfmStatus === 'ready' ? '刷新资料' : '获取资料' }}</button>
        <button class="secondary-button artist-fetch__more" :disabled="!connected || busy || !!matchKind" aria-label="修正资料匹配" aria-haspopup="menu" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"><ChevronDown :size="15" /></button>
        <div v-if="menuOpen" class="artist-fetch__menu" role="menu"><button role="menuitem" @click="match('picture')">修正照片匹配…</button><button role="menuitem" @click="match('info')">修正简介匹配…</button></div>
      </div></div>
      <p v-if="note" class="artist-profile__message" role="status">{{ note }}</p>
    </div>
    <div class="artist-profile__information">
      <p v-if="biography.text" class="artist-profile__bio" :class="{ 'is-expanded': expanded }">{{ biography.text }}</p>
      <p v-else class="artist-profile__placeholder">{{ connected ? '暂无艺术家简介，可获取资料或通过菜单搜索匹配。' : '在 foobar2000 中可获取艺术家照片与在线资料。' }}</p>
      <p v-if="biography.text" class="artist-profile__bio-source">简介：{{ biography.source }}</p>
      <button v-if="biography.text.length > 220" class="artist-profile__text-button" @click="expanded = !expanded">{{ expanded ? '收起简介' : '展开简介' }}</button>
      <p v-if="profile.message || profile.photoMessage" class="artist-profile__message">{{ profile.message || profile.photoMessage }}</p>
      <section v-if="profile.lastfmStatus === 'ready'" class="artist-profile__lastfm"><p>Last.fm 平台统计：{{ profile.lastfmListeners.toLocaleString() }} 位听众 · {{ profile.lastfmPlaycount.toLocaleString() }} 次播放</p><div v-if="profile.lastfmTags.length" class="artist-profile__genres"><span v-for="tag in profile.lastfmTags" :key="tag">{{ tag }}</span></div><div v-if="profile.lastfmSimilar.length" class="artist-profile__similar"><span>相似艺术家</span><button v-for="artist in profile.lastfmSimilar" :key="artist.url" @click="openArtistSource(artist.url)">{{ artist.name }}</button></div></section>
      <p v-if="profile.lastfmMessage" class="artist-profile__message">{{ profile.lastfmMessage }}</p>
      <footer class="artist-profile__sources"><span>照片：{{ portraitSource }}</span><button v-if="biography.text && biography.url" @click="openArtistSource(biography.url)"><ExternalLink :size="12" />简介来源</button><button v-if="portraitLink" @click="openArtistSource(portraitLink)"><ExternalLink :size="12" />图片来源</button><button v-if="profile.lastfmUrl" @click="openArtistSource(profile.lastfmUrl)"><ExternalLink :size="12" />Powered by Last.fm</button><span v-if="portraitSource === 'Wikimedia Commons'">{{ [profile.imageCredit, profile.imageLicense].filter(Boolean).join(' · ') }}</span></footer>
    </div>
    <ArtistMatchDialog v-if="matchKind" :key="`${name}:${matchKind}`" :name="name" :kind="matchKind" @close="closeMatch" @applied="applied" />
  </section>
</template>
