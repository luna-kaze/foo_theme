<script setup lang="ts">
import { ref, watch } from 'vue'
import { Disc3 } from '@lucide/vue'

const props = defineProps<{
  src?: string
  alt: string
  eager?: boolean
  retryKey?: number
}>()
const emit = defineEmits<{ loadError: [] }>()

const failed = ref(false)

watch([() => props.src, () => props.retryKey], () => {
  failed.value = false
})
</script>

<template>
  <div class="artwork-image">
    <img v-if="src && !failed" :key="retryKey" :src="src" :alt="alt" :loading="eager ? 'eager' : 'lazy'" decoding="async" draggable="false" @error="failed = true; emit('loadError')" />
    <div v-else class="artwork-image__fallback" aria-hidden="true">
      <Disc3 :size="34" />
    </div>
  </div>
</template>
