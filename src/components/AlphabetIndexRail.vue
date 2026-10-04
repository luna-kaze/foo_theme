<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { alphabetLetters } from '../utils/alphabetIndex'

defineProps<{ available: string[]; active: string }>()
const emit = defineEmits<{ select: [letter: string] }>()
defineOptions({ inheritAttrs: false })
const sceneActive = ref(true)
const rail = ref<HTMLElement | null>(null)
const visible = ref(false)
let root: HTMLElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let frame = 0
let near = false
let pointer = { x: -1, y: -1 }
function reveal() {
  if (timer) clearTimeout(timer)
  visible.value = true
  if (!near) timer = setTimeout(() => { visible.value = false }, 900)
}
function measurePointer() {
  frame = 0
  const rect = rail.value?.getBoundingClientRect()
  const wasNear = near
  near = Boolean(rect && pointer.x >= rect.left - 16 && pointer.x <= rect.right + 8 && pointer.y >= rect.top - 10 && pointer.y <= rect.bottom + 10)
  if (near || wasNear) reveal()
}
function onPointerMove(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  pointer = { x: event.clientX, y: event.clientY }
  if (!frame) frame = requestAnimationFrame(measurePointer)
}
function leave() { pointer = { x: -1, y: -1 }; near = false; if (visible.value) reveal() }
function onPointerOut(event: PointerEvent) { if (!event.relatedTarget) leave() }
function onWheel(event: WheelEvent) { if (!event.ctrlKey && (event.deltaX || event.deltaY)) reveal() }
function detach() {
  root?.removeEventListener('scroll', reveal)
  root?.removeEventListener('wheel', onWheel)
  document.removeEventListener('pointermove', onPointerMove, true)
  document.removeEventListener('pointerout', onPointerOut, true)
  window.removeEventListener('blur', leave)
  if (timer) clearTimeout(timer)
  if (frame) cancelAnimationFrame(frame)
  timer = undefined; frame = 0; near = false; visible.value = false
}
function attach() {
  detach()
  sceneActive.value = true
  root = document.querySelector('.workspace-scroll')
  root?.addEventListener('scroll', reveal, { passive: true })
  root?.addEventListener('wheel', onWheel, { passive: true })
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true })
  document.addEventListener('pointerout', onPointerOut, true)
  window.addEventListener('blur', leave)
}
onMounted(attach)
onActivated(attach)
onDeactivated(() => { sceneActive.value = false; detach() })
onBeforeUnmount(detach)
</script>

<template>
  <Teleport to="body">
  <nav v-if="sceneActive" ref="rail" v-bind="$attrs" class="alphabet-index" :class="{ 'is-visible': visible }" :aria-hidden="!visible" aria-label="字母索引">
    <button v-for="letter in alphabetLetters" :key="letter" :tabindex="visible ? 0 : -1" :class="{ active: active === letter }" :disabled="!available.includes(letter)" @click="emit('select', letter)">{{ letter }}</button>
  </nav>
  </Teleport>
</template>
