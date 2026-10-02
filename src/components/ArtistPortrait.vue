<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { artistPortraitUrl, ensureLocalArtistProfile, getArtistProfile } from '../composables/useArtistProfiles'

const props = defineProps<{ name: string }>()
const root = ref<HTMLElement | null>(null)
const profile = computed(() => getArtistProfile(props.name))
const source = computed(() => artistPortraitUrl(profile.value))
const loaded = ref(false)
const failed = ref(false)
let observer: IntersectionObserver | null = null
watch(source, () => { loaded.value = false; failed.value = false })
function connect() {
  observer?.disconnect()
  if (!root.value) return
  if (!globalThis.IntersectionObserver) { void ensureLocalArtistProfile(props.name); return }
  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      void ensureLocalArtistProfile(props.name)
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
    <i v-if="!source || failed || !loaded" aria-hidden="true">{{ [...name.trim()][0]?.toLocaleUpperCase() || '?' }}</i>
    <img v-if="source && !failed" :key="source" :src="source" alt="" aria-hidden="true" loading="lazy" decoding="async" :class="{ 'is-loaded': loaded }" @load="loaded = true" @error="failed = true" />
  </span>
</template>
