<script setup lang="ts">
import { alphabetLetters } from '../utils/alphabetIndex'

defineProps<{ available: string[]; active: string }>()
const emit = defineEmits<{ select: [letter: string] }>()
</script>

<template>
  <nav class="alphabet-index" aria-label="字母索引">
    <button v-for="letter in alphabetLetters" :key="letter" :class="{ active: active === letter }" :disabled="!available.includes(letter)" @click="emit('select', letter)">{{ letter }}</button>
  </nav>
</template>
