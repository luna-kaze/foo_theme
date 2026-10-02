<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { artistProfilesConnected } from '../composables/useArtistProfiles'
import { artistServiceSettings, loadArtistServiceSettings, saveArtistServiceSettings } from '../utils/artistProviders'

const connected = computed(artistProfilesConnected)
const draft = reactive({ autoApple: true, storefront: 'cn', lastfmApiKey: '' })
const busy = ref(false)
const message = ref('')
watch(connected, (available) => { if (available) void loadArtistServiceSettings() }, { immediate: true })
watch(() => artistServiceSettings.loaded, (loaded) => { if (loaded) Object.assign(draft, artistServiceSettings) }, { immediate: true })
async function save() {
  busy.value = true
  message.value = ''
  try { await saveArtistServiceSettings(draft); message.value = '资料源设置已保存。' }
  catch (error) { message.value = error instanceof Error ? error.message : '未能保存设置。' }
  finally { busy.value = false }
}
</script>

<template>
  <details class="artist-services-settings">
    <summary>艺术家资料源设置</summary>
    <form @submit.prevent="save">
      <label class="artist-services-settings__check"><input v-model="draft.autoApple" type="checkbox" :disabled="!connected" /><span>缺图时自动为可见艺术家尝试 Apple Music 图片</span></label>
      <label><span>Apple Music 首选地区</span><select v-model="draft.storefront" :disabled="!connected"><option value="cn">中国大陆</option><option value="jp">日本</option><option value="us">美国</option><option value="gb">英国</option><option value="hk">香港</option><option value="tw">台湾</option></select></label>
      <label><span>Last.fm API key</span><input v-model="draft.lastfmApiKey" type="password" autocomplete="off" spellcheck="false" maxlength="32" placeholder="留空则不获取 Last.fm 资料" :disabled="!connected" /></label>
      <p>API key 保存在本机 foobar2000 配置中。Last.fm 用于简介、标签、相似艺术家与平台统计；图片另行获取。</p>
      <div><button class="secondary-button" :disabled="!connected || busy" type="submit">{{ busy ? '保存中…' : '保存设置' }}</button><span v-if="message" role="status">{{ message }}</span></div>
    </form>
  </details>
</template>
