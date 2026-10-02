<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { artistPortraitUrl, ensureArtistPortrait, getArtistProfile, reportArtistPortraitFailure } from '../composables/useArtistProfiles'

const props = defineProps<{ name: string }>()
const root = ref<HTMLElement | null>(null)
const profile = computed(() => getArtistProfile(props.name))
const source = computed(() => artistPortraitUrl(profile.value))
const loaded = ref(false)
let observer: IntersectionObserver | null = null
watch(source, () => { loaded.value = false })
function imageFailed(event: Event) {
  const url = (event.currentTarget as HTMLImageElement).getAttribute('src') || ''
  if (url !== source.value) return
  loaded.value = false
  reportArtistPortraitFailure(props.name, url)
}
function imageLoaded(event: Event) {
  if ((event.currentTarget as HTMLImageElement).getAttribute('src') === source.value) loaded.value = true
}
function connect() {
  observer?.disconnect()
  if (!root.value) return
  if (!globalThis.IntersectionObserver) { void ensureArtistPortrait(props.name); return }
  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      void ensureArtistPortrait(props.name)
      observer?.disconnect()
    }
  }, { root: root.value.closest('.workspace-scroll'), rootMargin: '160px' })
  observer.observe(root.value)
}
onMounted(connect)
onActivated(connect)
onDeactivated(() => observer?.disconnect())
onBeforeUnmount(() => observer?.disconnect())
watch(() => props.name, connect)
</script>

<template>
  <span ref="root" class="artist-portrait" role="img" :aria-label="`${name}的艺术家照片`">
    <i v-if="!source || !loaded" aria-hidden="true">{{ [...name.trim()][0]?.toLocaleUpperCase() || '?' }}</i>
    <img v-if="source" :key="source" :src="source" alt="" aria-hidden="true" loading="lazy" decoding="async" :class="{ 'is-loaded': loaded }" @load="imageLoaded" @error="imageFailed" />
  </span>
</template>
