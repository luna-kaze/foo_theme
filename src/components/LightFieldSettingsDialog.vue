<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { SlidersHorizontal, X } from '@lucide/vue'
import { lightFieldControls, lightFieldSettings, resetLightFieldSettings, saveLightFieldSettings, updateLightFieldSettings, type LightFieldNumericKey } from '../utils/lightFieldSettings'
import '../styles/light-settings.css'

const props = defineProps<{ connected: boolean; fullscreen: boolean }>()
const emit = defineEmits<{ close: [] }>()
const root = ref<HTMLElement | null>(null)
const busy = ref(false), message = ref('')
const previousFocus = document.activeElement as HTMLElement | null
function update(key: LightFieldNumericKey, event: Event) {
  updateLightFieldSettings({ [key]: Number((event.target as HTMLInputElement).value) })
  message.value = ''
}
async function save() {
  busy.value = true; message.value = ''
  try { await saveLightFieldSettings(props.connected); message.value = '已保存，重新加载主题后仍会使用这些参数。' }
  catch (error) { message.value = error instanceof Error ? error.message : '保存失败。' }
  finally { busy.value = false }
}
function keyboard(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const controls = [...root.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []]
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
}
onMounted(async () => { window.addEventListener('keydown', keyboard, true); await nextTick(); root.value?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true }) })
onBeforeUnmount(() => { window.removeEventListener('keydown', keyboard, true); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) })
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop light-settings-backdrop" @click.self="emit('close')" @contextmenu.prevent.stop>
      <section ref="root" class="light-settings-panel" role="dialog" aria-modal="true" aria-labelledby="light-settings-title">
        <header><SlidersHorizontal :size="20" /><div><h2 id="light-settings-title">全屏背景调节</h2><small>Ctrl+Alt+B · 实时预览</small></div><button aria-label="关闭背景调节" @click="emit('close')"><X :size="18" /></button></header>
        <p class="light-settings-note">封面预模糊后由 GPU 绘制多层旋转色域。{{ fullscreen ? '拖动滑块即可实时观察变化。' : '进入全屏沉浸即可预览。' }}修改后点击保存。</p>
        <div class="light-settings-controls">
          <label v-for="control in lightFieldControls" :key="control.key" :for="`light-setting-${control.key}`">
            <span>{{ control.label }}<output :for="`light-setting-${control.key}`">{{ control.step < 1 ? lightFieldSettings[control.key].toFixed(2) : Math.round(lightFieldSettings[control.key]) }}{{ control.unit || '×' }}</output></span>
            <input :id="`light-setting-${control.key}`" type="range" :min="control.min" :max="control.max" :step="control.step" :value="lightFieldSettings[control.key]" :disabled="busy" @input="update(control.key, $event)" />
          </label>
          <label class="light-settings-animation"><input type="checkbox" :checked="lightFieldSettings.animated" :disabled="busy" @change="updateLightFieldSettings({ animated: ($event.target as HTMLInputElement).checked })" /><span>启用缓慢流动</span></label>
        </div>
        <p v-if="message" class="light-settings-message" role="status">{{ message }}</p>
        <footer><button class="secondary-button" :disabled="busy" @click="resetLightFieldSettings(); message = ''">恢复默认</button><button class="primary-button" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存参数' }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>
