<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue'
import fb from 'foo-webview-sdk'
import { createAlbumLightFieldCache, type AlbumLightField } from '../utils/albumLightField'
import { coverflowPerformance } from '../utils/coverflowPerformance'

const props = defineProps<{ active: boolean; source: string; path: string; progress: number; suspended: boolean }>()
const emit = defineEmits<{ ready: [ready: boolean] }>()
const field = shallowRef<AlbumLightField | null>(null)
const loader = createAlbumLightFieldCache()
let generation = 0
function finishCrossfade(element: Element) {
  if (element.getAttribute('data-light-key') === field.value?.key) emit('ready', true)
}
watch([() => props.active, () => props.source, () => props.suspended], async () => {
  const request = ++generation
  if (!props.active || props.suspended) { loader.cancel(); return }
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
    const samePalette = field.value?.palette.map(color => `${Math.round(color.r / 8)},${Math.round(color.g / 8)},${Math.round(color.b / 8)}`).join('|') === next.palette.map(color => `${Math.round(color.r / 8)},${Math.round(color.g / 8)},${Math.round(color.b / 8)}`).join('|')
    if (samePalette) return
    field.value = next
    coverflowPerformance.record('lightFieldReady', performance.now() - start, 1)
  } catch { if (!field.value) emit('ready', false) }
}, { immediate: true })
onBeforeUnmount(() => { generation += 1; loader.dispose() })
</script>

<template>
  <div class="fullscreen-light-field" :style="{ opacity: field ? progress : 0 }" aria-hidden="true">
    <Transition name="fullscreen-light-crossfade" @after-enter="finishCrossfade">
      <div v-if="field" :key="field.key" :data-light-key="field.key" class="fullscreen-light-field__scene" :class="{ 'is-running': active }">
        <div class="fullscreen-light-field__base" :style="{ backgroundImage: `url(${field.base})` }" />
        <div class="fullscreen-light-field__glow fullscreen-light-field__glow--primary" :style="{ backgroundImage: `url(${field.primary})` }" />
        <div class="fullscreen-light-field__glow fullscreen-light-field__glow--secondary" :style="{ backgroundImage: `url(${field.secondary})` }" />
        <div class="fullscreen-light-field__shade" />
      </div>
    </Transition>
  </div>
</template>
