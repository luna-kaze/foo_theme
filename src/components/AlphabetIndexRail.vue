<script setup lang="ts">
import { onActivated, onDeactivated, ref } from 'vue'
import { alphabetLetters } from '../utils/alphabetIndex'

defineProps<{ available: string[]; active: string }>()
const emit = defineEmits<{ select: [letter: string] }>()
defineOptions({ inheritAttrs: false })
const sceneActive = ref(true)
onActivated(() => { sceneActive.value = true })
onDeactivated(() => { sceneActive.value = false })
</script>

<template>
  <Teleport to="body">
  <nav v-if="sceneActive" v-bind="$attrs" class="alphabet-index" aria-label="字母索引">
    <button v-for="letter in alphabetLetters" :key="letter" :class="{ active: active === letter }" :disabled="!available.includes(letter)" @click="emit('select', letter)">{{ letter }}</button>
  </nav>
  </Teleport>
</template>
