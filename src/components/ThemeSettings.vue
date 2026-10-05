<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { KeyRound, Settings, X } from '@lucide/vue'
import { artistServiceSettings, loadArtistServiceSettings, saveArtistServiceSettings } from '../utils/artistProviders'
import { defaultImportExclusions, importFilterSettings, loadImportFilters, parseImportExclusions, saveImportFilters } from '../utils/importFilters'

const props = defineProps<{ connected: boolean }>()
const emit = defineEmits<{ close: [] }>()
const root = ref<HTMLElement | null>(null)
const key = ref('')
const busy = ref(true)
const visible = ref(false)
const message = ref('')
const excludedSuffixes = ref(importFilterSettings.excluded.join(', '))
const previousFocus = document.activeElement as HTMLElement | null
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); emit('close'); return }
  if (event.key !== 'Tab') return
  const controls = [...root.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') ?? []]
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(async () => {
  window.addEventListener('keydown', keyboard, true)
  try {
    if (props.connected) await loadArtistServiceSettings()
    key.value = artistServiceSettings.lastfmApiKey
    if (props.connected) await loadImportFilters()
    excludedSuffixes.value = importFilterSettings.excluded.join(', ')
  } catch (error) { message.value = error instanceof Error ? error.message : '未能读取设置。' }
  finally { busy.value = false }
  await nextTick()
  root.value?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true })
})
onBeforeUnmount(() => { window.removeEventListener('keydown', keyboard, true); previousFocus?.isConnected && previousFocus.focus({ preventScroll: true }) })
async function save() {
  busy.value = true
  message.value = ''
  try {
    parseImportExclusions(excludedSuffixes.value)
    await saveArtistServiceSettings({ autoApple: artistServiceSettings.autoApple, storefront: artistServiceSettings.storefront, lastfmApiKey: key.value })
    await saveImportFilters(excludedSuffixes.value)
    message.value = '设置已保存，后续艺术家查询和音乐导入将使用新设置。'
  } catch (error) { message.value = error instanceof Error ? error.message : '未能保存设置。' }
  finally { busy.value = false }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="theme-settings" appear>
      <div class="modal-backdrop theme-settings-backdrop" @click.self="emit('close')" @contextmenu.prevent.stop>
        <section ref="root" class="theme-settings-panel" role="dialog" aria-modal="true" aria-labelledby="theme-settings-title">
          <header><span><Settings :size="21" /></span><div><p>FOOBAR2000 THEME</p><h2 id="theme-settings-title">主题设置</h2></div><button type="button" aria-label="关闭主题设置" @click="emit('close')"><X :size="19" /></button></header>
          <form @submit.prevent="save">
            <label for="theme-lastfm-key"><KeyRound :size="16" /><span>Last.fm API key</span></label>
            <div class="theme-settings-panel__key"><input id="theme-lastfm-key" v-model="key" :type="visible ? 'text' : 'password'" maxlength="32" autocomplete="off" spellcheck="false" placeholder="留空关闭 Last.fm 资料获取" :disabled="!connected || busy" /><button type="button" :disabled="busy" @click="visible = !visible">{{ visible ? '隐藏' : '显示' }}</button></div>
            <p class="theme-settings-panel__note">用于艺术家简介、标签、相似艺术家与 Last.fm 平台统计。Key 仅保存在本机 foobar2000 配置中。</p>
            <label for="theme-import-exclusions"><span>导入排除后缀</span></label>
            <textarea id="theme-import-exclusions" v-model="excludedSuffixes" rows="3" :disabled="!connected || busy" spellcheck="false" placeholder="lrc, txt, jpg" />
            <p class="theme-settings-panel__note">文件夹和文件导入前先过滤这些后缀，忽略大小写。支持 lrc、.lrc、*.lrc，以逗号、分号或空格分隔。CUE 等描述文件默认保留；音频格式按宿主已安装解码器识别。</p>
            <button class="secondary-button" type="button" :disabled="busy" @click="excludedSuffixes = defaultImportExclusions">恢复默认排除后缀</button>
            <p v-if="!connected" class="theme-settings-panel__note">请在 foobar2000 中保存主题设置。</p>
            <p v-if="message" class="theme-settings-panel__message" role="status">{{ message }}</p>
            <footer><button class="secondary-button" type="button" @click="emit('close')">关闭</button><button class="primary-button" :disabled="!connected || busy" type="submit">{{ busy ? '请稍候…' : '保存设置' }}</button></footer>
          </form>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
