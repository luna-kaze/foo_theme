<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ExternalLink, ImagePlus, RefreshCw, RotateCcw } from '@lucide/vue'
import ArtistPortrait from './ArtistPortrait.vue'
import ArtistServiceSettings from './ArtistServiceSettings.vue'
import { artistBiography, artistPortraitLink, artistPortraitSource, artistProfilesConnected, bindAppleArtist, chooseArtistPhoto, ensureArtistPortrait, getArtistProfile, loadOnlineArtistProfile, openArtistSource, resetArtistPhoto } from '../composables/useArtistProfiles'

const props = defineProps<{ name: string; trackCount: number; albumCount: number }>()
const profile = computed(() => getArtistProfile(props.name))
const connected = computed(artistProfilesConnected)
const portraitSource = computed(() => artistPortraitSource(profile.value))
const portraitLink = computed(() => artistPortraitLink(profile.value))
const biography = computed(() => artistBiography(profile.value))
const appleUrl = ref('')
const expanded = ref(false)
const actionBusy = ref(false)
const actionError = ref('')
watch(() => props.name, (name) => { expanded.value = false; void ensureArtistPortrait(name) }, { immediate: true })
async function action(run: () => Promise<unknown>) {
  actionBusy.value = true
  actionError.value = ''
  try { await run() } catch (error) { actionError.value = error instanceof Error ? error.message : '操作未完成。' }
  finally { actionBusy.value = false }
}
</script>

<template>
  <section class="artist-profile">
    <ArtistPortrait :name="name" class="artist-profile__portrait" />
    <div class="artist-profile__copy">
      <p class="eyebrow">艺术家</p>
      <h1>{{ name }}</h1>
      <p v-if="profile.canonicalName && profile.canonicalName !== name" class="artist-profile__canonical">{{ profile.canonicalName }}</p>
      <p class="artist-profile__counts">{{ trackCount }} 首曲目 · {{ albumCount }} 张专辑</p>
      <p v-if="profile.type || profile.country || profile.years" class="artist-profile__meta">
        <span v-if="profile.type">{{ profile.type }}</span><span v-if="profile.country">{{ profile.country }}</span>
        <span v-if="profile.years">{{ profile.type === '个人' ? '生卒年' : '成立 / 活跃年份' }} {{ profile.years }}</span>
      </p>
      <div v-if="profile.genres.length" class="artist-profile__genres"><span v-for="genre in profile.genres" :key="genre">{{ genre }}</span></div>
      <div class="artist-profile__actions">
        <button class="secondary-button" :disabled="!connected || profile.status === 'loading' || actionBusy" @click="action(() => loadOnlineArtistProfile(name))"><RefreshCw :size="14" :class="{ 'is-spinning': profile.status === 'loading' }" />{{ profile.status === 'loading' ? '正在获取…' : profile.updatedAt ? '刷新艺术家资料' : '获取在线资料' }}</button>
        <button v-if="profile.mbid" class="secondary-button" :disabled="!connected || actionBusy || profile.status === 'loading'" @click="action(() => loadOnlineArtistProfile(name, undefined, true))">更换匹配身份</button>
        <button class="secondary-button" :disabled="!connected || actionBusy || profile.photoStatus === 'loading'" @click="action(() => ensureArtistPortrait(name, { force: true }))">{{ profile.photoStatus === 'loading' ? '照片获取中…' : '重新获取照片' }}</button>
        <button class="secondary-button" :disabled="!connected || actionBusy" @click="action(() => chooseArtistPhoto(name))"><ImagePlus :size="14" />选择照片</button>
        <button v-if="profile.manualImage" class="secondary-button" :disabled="actionBusy" @click="action(() => resetArtistPhoto(name))"><RotateCcw :size="14" />恢复自动照片</button>
      </div>
    </div>
    <div class="artist-profile__information">
      <p v-if="biography.text" class="artist-profile__bio" :class="{ 'is-expanded': expanded }">{{ biography.text }}</p>
      <p v-else class="artist-profile__placeholder">{{ connected ? '获取在线资料后，可查看简介、地区与艺术家照片。' : '预览模式显示本地统计；在 foobar2000 中可读取照片与在线资料。' }}</p>
      <button v-if="biography.text.length > 220" class="artist-profile__text-button" @click="expanded = !expanded">{{ expanded ? '收起简介' : '展开简介' }}</button>
      <p v-if="profile.message || actionError" class="artist-profile__message" role="status">{{ actionError || profile.message }}</p>
      <div v-if="profile.status === 'ambiguous'" class="artist-profile__candidates">
        <button v-for="candidate in profile.candidates" :key="candidate.id" :disabled="actionBusy" @click="action(() => loadOnlineArtistProfile(name, candidate.id))"><strong>{{ candidate.name }}</strong><span>{{ [candidate.country, candidate.type, candidate.disambiguation].filter(Boolean).join(' · ') || '查看并匹配此艺术家' }}</span></button>
      </div>
      <p v-if="profile.photoMessage" class="artist-profile__message" role="status">{{ profile.photoMessage }}</p>
      <div v-if="profile.photoStatus === 'ambiguous'" class="artist-profile__candidates">
        <button v-for="candidate in profile.appleCandidates" :key="candidate.id" :disabled="actionBusy" @click="action(() => bindAppleArtist(name, candidate.url))"><strong>{{ candidate.name }}</strong><span>Apple Music · {{ candidate.storefront.toUpperCase() }} · {{ candidate.genre }}</span></button>
      </div>
      <details class="artist-profile__apple-binding"><summary>绑定 Apple Music 艺术家页面</summary><form @submit.prevent="action(() => bindAppleArtist(name, appleUrl))"><input v-model="appleUrl" type="url" placeholder="https://music.apple.com/jp/artist/..." :disabled="!connected" /><button class="secondary-button" :disabled="!connected || actionBusy || profile.photoStatus === 'loading'">绑定并获取照片</button></form></details>
      <section v-if="profile.lastfmStatus === 'ready'" class="artist-profile__lastfm">
        <p>Last.fm 平台统计：{{ profile.lastfmListeners.toLocaleString() }} 位听众 · {{ profile.lastfmPlaycount.toLocaleString() }} 次播放</p>
        <div v-if="profile.lastfmTags.length" class="artist-profile__genres"><span v-for="tag in profile.lastfmTags" :key="tag">{{ tag }}</span></div>
        <div v-if="profile.lastfmSimilar.length" class="artist-profile__similar"><span>相似艺术家</span><button v-for="artist in profile.lastfmSimilar" :key="artist.url" @click="openArtistSource(artist.url)">{{ artist.name }}</button></div>
      </section>
      <p v-if="profile.lastfmMessage" class="artist-profile__message" role="status">{{ profile.lastfmMessage }}</p>
      <footer class="artist-profile__sources">
        <span>{{ portraitSource }}</span>
        <button v-if="biography.url || profile.sourceUrl" @click="openArtistSource(biography.url || profile.sourceUrl)"><ExternalLink :size="12" />{{ biography.text ? `${biography.source} 简介` : '资料来源' }}</button>
        <button v-if="portraitLink" @click="openArtistSource(portraitLink)"><ExternalLink :size="12" />图片来源</button>
        <button v-if="profile.lastfmUrl" @click="openArtistSource(profile.lastfmUrl)"><ExternalLink :size="12" />Powered by Last.fm</button>
        <span v-if="portraitSource === 'Wikimedia Commons'">{{ [profile.imageCredit, profile.imageLicense].filter(Boolean).join(' · ') }}</span>
      </footer>
      <ArtistServiceSettings />
    </div>
  </section>
</template>
