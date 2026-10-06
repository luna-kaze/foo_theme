<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import fb from 'foo-webview-sdk'
import { createAlbumLightFieldCache, type AlbumLightField } from '../utils/albumLightField'
import { coverflowPerformance } from '../utils/coverflowPerformance'
import { lightFieldSettings, lightFieldStyle } from '../utils/lightFieldSettings'
import { createWaveBackgroundRenderer, generateWaveLightField } from '../utils/waveBackground'

const props = defineProps<{ active: boolean; source: string; path: string; progress: number; suspended: boolean }>()
const emit = defineEmits<{ ready: [ready: boolean] }>()
const field = shallowRef<AlbumLightField | null>(null)
const fieldStyle = computed(() => ({ ...lightFieldStyle(lightFieldSettings), opacity: field.value ? props.progress * lightFieldSettings.opacity : 0 }))
const loader = createAlbumLightFieldCache(generateWaveLightField)
const canvasElement = ref<HTMLCanvasElement | null>(null)
const gpuReady = ref(false)
const hadGpu = ref(false)
let renderer: ReturnType<typeof createWaveBackgroundRenderer> | null = null
let generation = 0
function finishCrossfade(element: Element) {
  if (element.getAttribute('data-light-key') === field.value?.key) emit('ready', true)
}
watch([() => props.active, () => props.source, () => props.suspended], async () => {
  const request = ++generation
  if (!props.active || props.suspended) {
    loader.cancel()
    if (!props.active && field.value?.key !== props.source) emit('ready', false)
    return
  }
  const source = props.source, path = props.path
  const start = performance.now()
  try {
    const next = await loader.request(source, async () => {
      if (!path) return ''
      const art = await fb.artwork.getForTrack(path, 'front', { maxSize: 384 })
      return art.available ? art.dataUrl ?? '' : ''
    })
    if (!next) return
    await Promise.all([next.base, next.primary, next.secondary].map(async source => {
      const image = new Image(); image.src = source
      await image.decode().catch(() => {})
    }))
    if (request !== generation || !props.active || props.suspended) return
    if (field.value?.key === next.key && field.value === next) return
    field.value = next
    if (next.disc) { renderer?.setActive(props.active); renderer?.setField(next.disc) }
    else { renderer?.clearField(); gpuReady.value = false }
    await nextTick()
    if (request !== generation) return
    if (gpuReady.value) emit('ready', true)
    coverflowPerformance.record('lightFieldReady', performance.now() - start, 1)
  } catch { if (!field.value) emit('ready', false) }
}, { immediate: true })
watch(() => props.active, value => renderer?.setActive(value))
watch(lightFieldSettings, value => renderer?.setSettings(value), { deep: true })
onMounted(() => {
  emit('ready', false)
  if (!canvasElement.value) return
  renderer = createWaveBackgroundRenderer(canvasElement.value, ready => { gpuReady.value = ready; if (ready) hadGpu.value = true })
  renderer.setSettings(lightFieldSettings); renderer.setActive(props.active)
  if (field.value?.disc) { renderer.setField(field.value.disc); void nextTick().then(() => { if (gpuReady.value) emit('ready', true) }) }
})
onBeforeUnmount(() => { generation += 1; renderer?.dispose(); renderer = null; loader.dispose(); emit('ready', false) })
</script>

<template>
  <div class="fullscreen-light-field" :style="fieldStyle" aria-hidden="true">
    <div v-show="gpuReady" class="fullscreen-light-field__scene fullscreen-light-field__scene--wave">
      <canvas ref="canvasElement" class="fullscreen-light-field__wave" />
      <div class="fullscreen-light-field__grain" />
      <div class="fullscreen-light-field__shade" />
    </div>
    <Transition name="fullscreen-light-crossfade" :css="!hadGpu" @after-enter="finishCrossfade">
      <div v-if="field && !gpuReady" :key="field.key" :data-light-key="field.key" class="fullscreen-light-field__scene" :class="{ 'is-running': active && lightFieldSettings.animated }">
        <div class="fullscreen-light-field__base" :style="{ backgroundImage: `url(${field.base})` }" />
        <div class="fullscreen-light-field__glow fullscreen-light-field__glow--primary" :style="{ backgroundImage: `url(${field.primary})` }" />
        <div class="fullscreen-light-field__glow fullscreen-light-field__glow--secondary" :style="{ backgroundImage: `url(${field.secondary})` }" />
        <div class="fullscreen-light-field__shade" />
      </div>
    </Transition>
  </div>
</template>
