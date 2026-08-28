<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export interface ThemeSelectOption {
  value: string
  label: string
}

const props = defineProps<{
  modelValue: string
  options: ThemeSelectOption[]
  selectLabel: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const selectedLabel = computed(() => props.options.find((option) => option.value === props.modelValue)?.label ?? props.options[0]?.label ?? '')

function select(value: string) {
  emit('update:modelValue', value)
  open.value = false
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open.value) {
    event.preventDefault()
    open.value = true
  }
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <div ref="root" class="theme-select" :class="{ open }" @keydown="onKeydown">
    <button type="button" class="theme-select__trigger" :aria-label="selectLabel" aria-haspopup="listbox" :aria-expanded="open" @click="open = !open">
      <span>{{ selectedLabel }}</span><ChevronDown :size="13" />
    </button>
    <Transition name="theme-select-menu">
      <div v-if="open" class="theme-select__menu" role="listbox" :aria-label="selectLabel">
        <button v-for="option in options" :key="option.value" type="button" role="option" :aria-selected="option.value === modelValue" :class="{ selected: option.value === modelValue }" @click="select(option.value)">
          <span>{{ option.label }}</span><Check v-if="option.value === modelValue" :size="13" />
        </button>
      </div>
    </Transition>
  </div>
</template>
