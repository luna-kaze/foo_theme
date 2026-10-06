<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { AudioLines, ExternalLink, X } from '@lucide/vue'
import fb from 'foo-webview-sdk'
import pkg from '../../package.json'
import licenseText from '../../LICENSE?raw'
const props = defineProps<{ connected: boolean }>()
const emit = defineEmits<{ close: [] }>()
const root = ref<HTMLElement | null>(null), error = ref('')
const previousFocus = document.activeElement as HTMLElement | null
const project = 'https://github.com/luna-kaze/foo_theme'
async function open(url: string) {
  if (![project, 'https://www.gnu.org/licenses/gpl-3.0.html'].includes(url)) return
  error.value = ''
  try { if (props.connected) await fb.shell.openExternal(url); else window.open(url, '_blank', 'noopener,noreferrer') }
  catch (failure) { error.value = failure instanceof Error ? failure.message : '无法打开链接。' }
}
function keyboard(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const elements = [...root.value?.querySelectorAll<HTMLElement>('button:not(:disabled), summary') ?? []]
  if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
}
onMounted(async () => { window.addEventListener('keydown', keyboard, true); await nextTick(); root.value?.querySelector<HTMLElement>('button')?.focus() })
onBeforeUnmount(() => { window.removeEventListener('keydown', keyboard, true); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) })
</script>
<template>
  <Teleport to="body"><div class="modal-backdrop about-backdrop" @click.self="emit('close')" @contextmenu.prevent.stop>
    <section ref="root" class="about-panel" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <header><AudioLines :size="34" /><div><h2 id="about-title">关于 foo_theme</h2><small>foobar2000 WebView 主题 · {{ pkg.version }}</small></div><button aria-label="关闭关于信息" @click="emit('close')"><X :size="18" /></button></header>
      <p>Vue 3 / TypeScript 音乐界面，支持 Standard 与 Coverflow 沉浸播放、AirPlay 实时显示和本地媒体管理。</p>
      <button class="about-link" @click="open(project)"><ExternalLink :size="14" />{{ project }}</button>
      <section class="about-license"><strong>GNU General Public License v3.0</strong><small>SPDX：GPL-3.0-only</small><p>Copyright © 2026 foo_theme contributors。您可以按 GPLv3 的条款使用、修改及分发本项目。本软件按原样提供，不提供任何担保。</p><button class="about-link" @click="open('https://www.gnu.org/licenses/gpl-3.0.html')"><ExternalLink :size="14" />GPLv3 官方说明</button><details><summary>查看许可证全文</summary><pre>{{ licenseText }}</pre></details></section>
      <p v-if="error" role="alert">{{ error }}</p><footer><small>F1 打开 / 关闭 · Esc 关闭</small></footer>
    </section>
  </div></Teleport>
</template>
