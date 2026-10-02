<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ExternalLink, ImagePlus, RefreshCw, RotateCcw } from '@lucide/vue'
import ArtistPortrait from './ArtistPortrait.vue'
import { artistPortraitSource, artistProfilesConnected, chooseArtistPhoto, ensureLocalArtistProfile, getArtistProfile, loadOnlineArtistProfile, openArtistSource, resetArtistPhoto } from '../composables/useArtistProfiles'

const props = defineProps<{ name: string; trackCount: number; albumCount: number }>()
const profile = computed(() => getArtistProfile(props.name))
const connected = computed(artistProfilesConnected)
const portraitSource = computed(() => artistPortraitSource(profile.value))
const expanded = ref(false)
const actionBusy = ref(false)
const actionError = ref('')
watch(() => props.name, (name) => { expanded.value = false; void ensureLocalArtistProfile(name) }, { immediate: true })
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
        <button class="secondary-button" :disabled="!connected || actionBusy" @click="action(() => chooseArtistPhoto(name))"><ImagePlus :size="14" />选择照片</button>
        <button v-if="profile.manualImage" class="secondary-button" :disabled="actionBusy" @click="action(() => resetArtistPhoto(name))"><RotateCcw :size="14" />恢复自动照片</button>
      </div>
    </div>
    <div class="artist-profile__information">
      <p v-if="profile.biography" class="artist-profile__bio" :class="{ 'is-expanded': expanded }">{{ profile.biography }}</p>
      <p v-else class="artist-profile__placeholder">{{ connected ? '获取在线资料后，可查看简介、地区与艺术家照片。' : '预览模式显示本地统计；在 foobar2000 中可读取照片与在线资料。' }}</p>
      <button v-if="profile.biography.length > 220" class="artist-profile__text-button" @click="expanded = !expanded">{{ expanded ? '收起简介' : '展开简介' }}</button>
      <p v-if="profile.message || actionError" class="artist-profile__message" role="status">{{ actionError || profile.message }}</p>
      <div v-if="profile.status === 'ambiguous'" class="artist-profile__candidates">
        <button v-for="candidate in profile.candidates" :key="candidate.id" :disabled="actionBusy" @click="action(() => loadOnlineArtistProfile(name, candidate.id))"><strong>{{ candidate.name }}</strong><span>{{ [candidate.country, candidate.type, candidate.disambiguation].filter(Boolean).join(' · ') || '查看并匹配此艺术家' }}</span></button>
      </div>
      <footer class="artist-profile__sources">
        <span>{{ portraitSource }}</span>
        <button v-if="profile.sourceUrl" @click="openArtistSource(profile.sourceUrl)"><ExternalLink :size="12" />资料来源</button>
        <button v-if="profile.imageSourceUrl && portraitSource === 'Wikimedia Commons'" @click="openArtistSource(profile.imageSourceUrl)"><ExternalLink :size="12" />图片来源</button>
        <span v-if="portraitSource === 'Wikimedia Commons'">{{ [profile.imageCredit, profile.imageLicense].filter(Boolean).join(' · ') }}</span>
      </footer>
    </div>
  </section>
</template>
