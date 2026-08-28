<script setup lang="ts">
import { ref, watch } from 'vue'
import { Disc3 } from '@lucide/vue'

const props = defineProps<{
  src?: string
  alt: string
}>()

const failed = ref(false)

watch(() => props.src, () => {
  failed.value = false
})
</script>

<template>
  <div class="artwork-image">
    <img v-if="src && !failed" :src="src" :alt="alt" loading="lazy" decoding="async" draggable="false" @error="failed = true" />
    <div v-else class="artwork-image__fallback" aria-hidden="true">
      <Disc3 :size="34" />
    </div>
  </div>
</template>
