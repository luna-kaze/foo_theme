<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue'
import { ChevronLeft, ChevronRight, Eye, EyeOff, Heart, Layers3, LocateFixed, Mic2, RotateCcw, Rows3, Shuffle, X } from '@lucide/vue'
import type { DisplayTrack, ParsedLyric } from '../types/music'
import { formatTime } from '../utils/format'
import ArtworkImage from './ArtworkImage.vue'
import { isSameTrack, trackKey } from '../utils/track'
import type { PlaybackFocusState } from '../utils/settledNavigation'
import { createCoverflowRail, type RailFrame } from '../utils/coverflowRail'
import { coverflowPerformance } from '../utils/coverflowPerformance'
import FullscreenLightField from './FullscreenLightField.vue'
import { playablePath } from '../utils/track'

const props = defineProps<{
  open: boolean
  track: DisplayTrack | null
  artwork: string
  isPlaying: boolean
  playbackState: 'stopped' | 'playing' | 'paused'
  canSeek: boolean
  position: number
  duration: number
  lyrics: ParsedLyric[]
  lyricsSynced: boolean
  playbackTracks: DisplayTrack[]
  playbackPlanIds: string[]
  playbackTrackIndex: number
  playbackPreviewId?: string | null
  playbackPreviewPending?: boolean
  playbackPreviewRequest?: number
  playbackBrowseIndex?: number | null
  playbackBrowseTrack?: DisplayTrack | null
  playbackWindowDeferred?: boolean
  fullscreen: boolean
  fullscreenProgress?: number
  airplay?: boolean
  remotePending?: boolean
  remoteMessage?: string
  artworkRevision?: number
  shuffleBusy: boolean
  shufflePending: boolean
  shuffleStaged: boolean
  shuffleSourceName: string
}>()

const emit = defineEmits<{
  close: []
  toggle: []
  seek: [position: number]
  seekResume: [position: number]
  favourite: [track: DisplayTrack]
  playTrack: [track: DisplayTrack]
  browseTrack: [track: DisplayTrack]
  browsePosition: [index: number, distant: boolean]
  beginBrowse: []
  focusState: [state: PlaybackFocusState]
  shuffle: []
  restoreOrder: []
  next: []
  previous: []
  artworkError: []
}>()

const mode = ref<'standard' | 'coverflow'>('standard')
const modeTransition = ref<'retracting-standard' | 'packing-standard' | 'unpacking-standard' | 'packing-coverflow' | 'unpacking-coverflow' | 'handoff-standard' | 'handoff-coverflow' | null>(null)
const coverForward = ref(false)
const lyricsView = ref<HTMLElement | null>(null)
const lyricRows = ref<Array<HTMLElement | null>>([])
const autoFollowPaused = ref(false)
const scrubPosition = ref<number | null>(null)
const tonearmDragging = ref(false)
const tonearmWillPause = ref(false)
const tonearmDragAngle = ref<number | null>(null)
const recordZone = ref<HTMLElement | null>(null)
const coverflowView = ref<HTMLElement | null>(null)
const coverflowIndex = ref(0)
const lyricsVisible = ref(true)
const handoffCover = reactive({ visible: false, top: 0, left: 0, width: 0, height: 0 })
type StandardCoverSnapshot = { key: string; artwork: string; album: string; expanded: boolean }
const standardTargetTrack = computed(() => {
  if (props.airplay) return props.playbackTracks.at(-1) ?? props.track
  const preview = props.playbackPreviewPending ? props.playbackTracks.find(track => track.playbackId === props.playbackPreviewId) : null
  return preview ?? props.playbackTracks[props.playbackTrackIndex] ?? props.track
})
const standardCover = ref<StandardCoverSnapshot>(currentStandardCover())
const pendingStandardCover = ref<StandardCoverSnapshot | null>(null)
const standardCoverVisible = ref(true)
const standardCoverEntering = ref(false)
const standardRenderKey = ref(0)
const standardEnterOwners = new WeakMap<Element, number>()
let standardEnterTimer: ReturnType<typeof setTimeout> | null = null
let lastCoverflowPointer = { index: -1, key: '', track: null as DisplayTrack | null, time: 0, x: 0, y: 0 }
let resumeTimer: ReturnType<typeof setTimeout> | null = null
let modeTimer: ReturnType<typeof setTimeout> | null = null
let standardCoverTimer: ReturnType<typeof setTimeout> | null = null
let standardCoverLeaveDeadline = 0
let standardCoverGeneration = 0
let standardCoverLastChangeAt = 0
const standardCoverLeaveMs = 400
const standardCoverGapMs = 140
const standardCoverIdleMs = 350

const activeLyric = computed(() => {
  if (!props.lyrics.some((line) => line.time >= 0)) return -1
  let low = 0
  let high = props.lyrics.length - 1
  let result = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (props.lyrics[middle].time <= props.position) {
      result = middle
      low = middle + 1
    } else high = middle - 1
  }
  return result
})

const playbackProgress = computed(() => {
  const position = scrubPosition.value ?? props.position
  return props.duration > 0 ? Math.min(1, Math.max(0, position / props.duration)) : 0
})

const tonearmAngle = computed(() => tonearmDragAngle.value ?? (props.playbackState === 'playing' ? 3 + playbackProgress.value * 33 : -10))

type CoverflowItem = {
  track: DisplayTrack | null
  artwork: string
  current: boolean
  idle: boolean
  key: string
}
const orderReflowing = ref(false)
const outgoingCovers = ref<Array<CoverflowItem & { index: number; leaving: boolean; removed: boolean }>>([])
let orderAnimations: Animation[] = []
let orderRequest = 0
let orderTimer: ReturnType<typeof setTimeout> | null = null
let previousDeck: CoverflowItem[] = []
let previousFocusKey: string | null = null
const railState = reactive<RailFrame>({ position: 0, target: 0, zoom: 0, distant: false, active: false, settled: true })
let railSource: 'wheel' | 'intent' = 'wheel'
let lastRailSelection = -1
let lastRailDistant = false
let railSettledKey: string | null = null
const frozenCovers = ref<Array<CoverflowItem & { index: number; leaving: boolean; removed: boolean }>>([])
const frozenBackdrop = ref('')
const frozenDeck = shallowRef<CoverflowItem[]>([])
const focusIndex = computed(() => {
  if (props.airplay) return Math.max(0, props.playbackTracks.length - 1)
  if (props.playbackWindowDeferred) return coverflowIndex.value
  const preview = props.playbackTracks.findIndex((track) => track.playbackId === props.playbackPreviewId)
  return preview >= 0 ? preview : Math.max(0, props.playbackTrackIndex)
})
const globalFocusIndex = computed(() => props.airplay ? focusIndex.value : props.playbackBrowseIndex ?? props.playbackTracks[focusIndex.value]?.sourceIndex ?? focusIndex.value)

const coverflowItems = computed<CoverflowItem[]>(() => {
  if (!props.airplay && (railState.distant || props.playbackWindowDeferred) && frozenDeck.value.length) return frozenDeck.value
  coverflowPerformance.record('coverModelBuild', 0, props.playbackTracks.length)
  if (props.playbackTracks.length) return props.playbackTracks.map((track, index) => ({
    track,
    artwork: index === props.playbackTrackIndex && isSameTrack(track, props.track) ? props.artwork || track.artworkUrl || '' : track.artworkUrl || '',
    current: index === (props.airplay ? focusIndex.value : props.playbackTrackIndex),
    idle: false,
    key: track.playbackId ?? `playlist:${track.sourceIndex ?? index}:${trackKey(track)}`,
  }))
  return [{
    track: props.track,
    artwork: props.artwork || props.track?.artworkUrl || '',
    current: false,
    idle: true,
    key: `idle:${standardCover.value.key}`,
  }]
})
const visibleCoverflowItems = computed(() => {
  if (railState.distant) return railState.zoom < .6 ? frozenCovers.value : []
  const center = props.airplay ? focusIndex.value : railState.active ? Math.round(railState.position - (props.playbackTracks[0]?.sourceIndex ?? 0)) : coverflowIndex.value
  const start = Math.max(0, center - 3)
  const end = Math.min(coverflowItems.value.length, center + 4)
  const visible = coverflowItems.value.slice(start, end).map((item, offset) => ({ ...item, index: start + offset, leaving: false, removed: false }))
  const keys = new Set(visible.map((item) => item.key))
  return [...visible, ...outgoingCovers.value.filter((item) => !keys.has(item.key))]
})
const railPoints = computed(() => {
  if (!railState.distant && railState.zoom < .005) return []
  const first = Math.max(0, Math.floor(railState.position) - 15)
  const end = Math.min(props.playbackPlanIds.length, first + 31)
  return Array.from({ length: Math.max(0, end - first) }, (_, index) => first + index)
})
const rail = createCoverflowRail({
  now: () => performance.now(), requestFrame: run => requestAnimationFrame(run), cancelFrame: id => cancelAnimationFrame(id),
  update: (frame) => {
    if (frame.distant && !railState.distant) {
      frozenCovers.value = visibleCoverflowItems.value.filter(item => !item.leaving)
      frozenDeck.value = coverflowItems.value
      frozenBackdrop.value = selectedCoverflow.value?.artwork || props.artwork
    }
    Object.assign(railState, frame)
    coverflowPerformance.setTier(frame.distant ? frame.zoom < .6 ? 'shrinking' : 'high' : frame.zoom > .005 ? 'restoring' : 'near')
    coverflowPerformance.record('railFrame')
    if (railSource === 'wheel' && frame.active) {
      const selected = Math.round(frame.target)
      if (selected !== lastRailSelection || frame.distant !== lastRailDistant) {
        lastRailSelection = selected; lastRailDistant = frame.distant
        emit('browsePosition', selected, frame.distant)
      }
    }
    if (frame.settled) {
      coverflowIndex.value = focusIndex.value
      railSettledKey = previousFocusKey = coverflowItems.value[focusIndex.value]?.key ?? null
      frozenCovers.value = []; previousDeck = [...coverflowItems.value]
    }
    publishFocusState()
  },
})
function coverflowOffset(item: { index: number; track: DisplayTrack | null }) {
  if (props.airplay) return item.index - focusIndex.value
  const offset = railState.active ? (item.track?.sourceIndex ?? item.index) - railState.position : item.index - coverflowIndex.value
  return railState.distant ? Math.max(-4, Math.min(4, offset)) : offset
}

function publishFocusState() {
  if (props.airplay) { emit('focusState', { active: false, id: null, request: 0, settled: true }); return }
  if (!props.open || mode.value !== 'coverflow') coverflowPerformance.setTier('inactive')
  else if (!railState.active && railState.zoom === 0) coverflowPerformance.setTier('near')
  if (mode.value === 'standard') {
    emit('focusState', {
      active: props.open,
      id: standardCover.value.key,
      request: props.playbackPreviewRequest ?? 0,
      settled: !modeTransition.value && standardCoverVisible.value && !standardCoverEntering.value && !pendingStandardCover.value && standardCover.value.key === currentStandardCover().key && Boolean(recordZone.value?.isConnected),
    })
    return
  }
  emit('focusState', {
    active: props.open && mode.value === 'coverflow',
    id: coverflowItems.value[coverflowIndex.value]?.key ?? null,
    request: props.playbackPreviewRequest ?? 0,
    settled: !railState.active && !orderReflowing.value && !modeTransition.value && coverflowIndex.value === focusIndex.value && Boolean(coverflowView.value?.isConnected),
  })
}

function sampleCoverPose(element: HTMLElement, offset: number) {
  const previousOffset = element.style.getPropertyValue('--cover-offset')
  const previousDistance = element.style.getPropertyValue('--cover-distance')
  const active = element.classList.contains('active')
  element.style.setProperty('--cover-offset', `${offset}`)
  element.style.setProperty('--cover-distance', `${Math.abs(offset)}`)
  element.classList.toggle('active', offset === 0)
  const computed = getComputedStyle(element)
  const pose = { transform: computed.transform, opacity: computed.opacity }
  if (previousOffset) element.style.setProperty('--cover-offset', previousOffset)
  else element.style.removeProperty('--cover-offset')
  if (previousDistance) element.style.setProperty('--cover-distance', previousDistance)
  else element.style.removeProperty('--cover-distance')
  element.classList.toggle('active', active)
  return pose
}

function cancelOrderAnimation() {
  orderRequest += 1
  if (orderTimer) clearTimeout(orderTimer)
  orderTimer = null
  orderAnimations.forEach((animation) => animation.cancel())
  orderAnimations = []
  outgoingCovers.value = []
  orderReflowing.value = false
}
watch(coverflowItems, (items) => { if (!orderReflowing.value && !railState.active) previousDeck = [...items] }, { immediate: true, flush: 'post' })
// Capture the old DOM before Vue patches the committed deck. A revision can
// arrive before its async projection, so it cannot be the animation trigger.
watch([() => coverflowItems.value.map((item) => item.key).join('\u0000'), focusIndex, () => props.playbackPlanIds.join('\u0000'), () => props.open, mode, modeTransition], async (_values, [, , previousPlan]) => {
  if (props.airplay && railState.active) { rail.dispose(); railState.active = false; railState.distant = false; railState.zoom = 0; frozenDeck.value = []; frozenCovers.value = [] }
  if (!props.open || mode.value !== 'coverflow' || modeTransition.value) {
    if (props.playbackWindowDeferred && props.playbackBrowseIndex != null) emit('browsePosition', props.playbackBrowseIndex, false)
    railSettledKey = null
    rail.dispose(); railState.active = false; railState.distant = false; railState.zoom = 0
    cancelOrderAnimation(); coverflowIndex.value = focusIndex.value; previousDeck = [...coverflowItems.value]; publishFocusState(); return
  }
  const desired = props.playbackBrowseIndex ?? props.playbackTracks[focusIndex.value]?.sourceIndex ?? focusIndex.value
  if (!railState.active && railSettledKey === coverflowItems.value[focusIndex.value]?.key && railState.position === desired && _values[2] === previousPlan) {
    coverflowIndex.value = focusIndex.value; previousDeck = [...coverflowItems.value]; publishFocusState(); return
  }
  if (railState.active) {
    rail.resize(props.playbackPlanIds.length)
    if (props.playbackPreviewPending || Math.round(railState.target) !== desired) { railSource = 'intent'; rail.aim(desired) }
    coverflowIndex.value = focusIndex.value
    previousFocusKey = coverflowItems.value[focusIndex.value]?.key ?? null
    publishFocusState()
    return
  }
  const poses = new Map<string, { transform: string; opacity: string; offset: number }>()
  coverflowView.value?.querySelectorAll<HTMLElement>('[data-cover-key]').forEach((element) => {
    const style = getComputedStyle(element)
    poses.set(element.dataset.coverKey!, { transform: style.transform, opacity: style.opacity, offset: Number(element.style.getPropertyValue('--cover-offset')) })
  })
  const old = [...previousDeck, ...outgoingCovers.value]
  const aliases = new Map<string, string>()
  for (const item of coverflowItems.value) {
    const legacy = previousDeck.find(previous => previous.key.startsWith('playlist:') && previous.track?.sourceIndex === item.track?.sourceIndex && isSameTrack(previous.track, item.track))
    if (legacy) aliases.set(item.key, legacy.key)
  }
  const remapped = new Set(aliases.values())
  const previousFocus = previousFocusKey ?? previousDeck[coverflowIndex.value]?.key
  const previousIds = `${previousPlan ?? ''}`.split('\u0000')
  const previousGlobalFocus = previousIds.indexOf(previousFocus ?? '')
  cancelOrderAnimation()
  const request = orderRequest
  coverflowIndex.value = focusIndex.value
  previousFocusKey = coverflowItems.value[coverflowIndex.value]?.key ?? null
  if (globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) { previousDeck = [...coverflowItems.value]; await nextTick(); publishFocusState(); return }
  // The rendered deck is windowed. A shuffled card outside that window is
  // leaving the viewport, not deleted from the committed plan.
  const committedKeys = new Set(props.playbackPlanIds)
  outgoingCovers.value = old.filter((item, index, all) => !remapped.has(item.key) && poses.has(item.key) && all.findIndex((other) => other.key === item.key) === index).map((item) => ({ ...item, current: false, index: coverflowIndex.value + poses.get(item.key)!.offset, leaving: true, removed: !committedKeys.has(item.key) }))
  orderReflowing.value = true
  publishFocusState()
  await nextTick()
  if (request !== orderRequest) return
  if (!coverflowView.value?.isConnected) { cancelOrderAnimation(); previousDeck = [...coverflowItems.value]; publishFocusState(); return }
  try {
    for (const element of coverflowView.value.querySelectorAll<HTMLElement>('[data-cover-key]')) {
      const previousKey = aliases.get(element.dataset.coverKey!) ?? element.dataset.coverKey!
      let oldPose: { transform: string; opacity: string } | undefined = poses.get(previousKey)
      const oldPosition = previousIds.indexOf(previousKey)
      if (!oldPose && oldPosition >= 0 && previousGlobalFocus >= 0) {
        oldPose = sampleCoverPose(element, Math.max(-4, Math.min(4, oldPosition - previousGlobalFocus)))
      }
      const end = getComputedStyle(element)
      const leaving = element.classList.contains('is-order-leaving')
      const removed = element.classList.contains('is-order-removed')
      const offset = Number(element.style.getPropertyValue('--cover-offset'))
      const startTransform = oldPose?.transform || `${end.transform} translateX(${props.airplay ? 110 : Math.sign(offset) * 110}px) translateZ(-180px) scale(.88)`
      const oldOffset = poses.get(element.dataset.coverKey!)?.offset ?? offset
      const endTransform = leaving ? `${startTransform} translateX(${removed ? 0 : Math.sign(oldOffset) * 160}px) translateY(${removed ? 64 : 0}px) translateZ(-140px) scale(${removed ? .82 : .94})` : end.transform
      orderAnimations.push(element.animate([
        { transform: startTransform, opacity: oldPose?.opacity ?? '0' },
        { transform: endTransform, opacity: leaving ? 0 : Number(end.opacity) },
      ], { duration: props.airplay ? 420 : removed ? 300 : 620, easing: 'cubic-bezier(.18,.82,.16,1)', fill: 'both' }))
    }
  } catch {
    cancelOrderAnimation(); previousDeck = [...coverflowItems.value]; publishFocusState(); return
  }
  const animations = [...orderAnimations]
  await Promise.race([
    Promise.allSettled(animations.map((animation) => animation.finished)),
    new Promise<void>(resolve => { orderTimer = setTimeout(resolve, 750) }),
  ])
  if (request !== orderRequest) return
  if (orderTimer) clearTimeout(orderTimer)
  orderTimer = null
  animations.forEach((animation) => animation.cancel())
  orderAnimations = []
  outgoingCovers.value = []
  previousDeck = [...coverflowItems.value]
  orderReflowing.value = false
  publishFocusState()
}, { flush: 'pre' })
watch([() => props.open, mode, modeTransition, () => props.playbackPreviewRequest, coverflowView, recordZone, standardCoverVisible, standardCoverEntering, pendingStandardCover], publishFocusState, { immediate: true, flush: 'post' })
const coverflowArtworkDecodeCache = new Map<string, Promise<void>>()

function coverflowPreloadSources() {
  if (!props.open || railState.distant) return []
  const start = Math.max(0, focusIndex.value - 4)
  const end = Math.min(coverflowItems.value.length, focusIndex.value + 5)
  return coverflowItems.value.slice(start, end).map((item) => item.artwork).filter(Boolean)
}

function preloadCoverflowArtwork(sources: string[]) {
  sources.forEach((source) => {
    const cached = coverflowArtworkDecodeCache.get(source)
    if (cached) {
      coverflowArtworkDecodeCache.delete(source)
      coverflowArtworkDecodeCache.set(source, cached)
      return
    }
    const image = new Image()
    coverflowPerformance.record('imagePreload', 0, 1)
    image.decoding = 'async'
    image.src = source
    const decoded = image.decode().catch(() => undefined).then(() => { void image.naturalWidth })
    coverflowArtworkDecodeCache.set(source, decoded)
    while (coverflowArtworkDecodeCache.size > 34) {
      const oldest = coverflowArtworkDecodeCache.keys().next().value
      if (!oldest) break
      coverflowArtworkDecodeCache.delete(oldest)
    }
  })
}

const selectedCoverflow = computed<CoverflowItem | null>(() => {
  if (props.airplay) return coverflowItems.value[focusIndex.value] ?? null
  if (props.playbackPreviewPending) {
    const target = props.playbackTracks.find(track => track.playbackId === props.playbackPreviewId)
    if (target) return { track: target, artwork: target.artworkUrl || '', idle: false, key: target.playbackId!, current: target.playbackId === props.playbackTracks[props.playbackTrackIndex]?.playbackId }
  }
  if (props.playbackWindowDeferred && props.playbackBrowseTrack) return {
    track: props.playbackBrowseTrack, artwork: '', idle: false,
    key: props.playbackBrowseTrack.playbackId!,
    current: props.playbackBrowseTrack.playbackId === props.playbackTracks[props.playbackTrackIndex]?.playbackId,
  }
  return coverflowItems.value[coverflowIndex.value] ?? null
})
const currentCoverflowIndex = computed(() => props.airplay ? focusIndex.value : Math.max(0, props.playbackTrackIndex))
const idleCoverflow = computed(() => selectedCoverflow.value?.idle === true)
const backgroundArtwork = computed(() => modeTransition.value ? props.artwork : mode.value === 'coverflow' ? railState.distant ? frozenBackdrop.value : selectedCoverflow.value?.artwork || props.artwork : props.artwork)
const lightFieldReady = ref(false)
const fullscreenBackgroundProgress = computed(() => props.fullscreenProgress ?? (props.fullscreen ? 1 : 0))
const legacyBackgroundVisible = computed(() => !lightFieldReady.value || fullscreenBackgroundProgress.value < .999)
const legacyBackgroundOpacity = computed(() => lightFieldReady.value ? 1 - fullscreenBackgroundProgress.value : 1)
const lightFieldPath = computed(() => {
  const target = mode.value === 'coverflow' && !modeTransition.value ? selectedCoverflow.value?.track : props.track
  return target ? playablePath(target) : ''
})
const handoffCoverStyle = computed(() => ({
  top: `${handoffCover.top}px`,
  left: `${handoffCover.left}px`,
  width: `${handoffCover.width}px`,
  height: `${handoffCover.height}px`,
}))

type CoverRect = { top: number; left: number; width: number; height: number }

function readRect(element: Element | null): CoverRect | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

function fallbackCenterRect(): CoverRect {
  const size = Math.min(390, Math.max(230, window.innerWidth * .26))
  return { top: (window.innerHeight - size) / 2, left: (window.innerWidth - size) / 2, width: size, height: size }
}

function setHandoffRect(rect: CoverRect) {
  Object.assign(handoffCover, rect)
}

function waitForMode(milliseconds: number) {
  return new Promise<void>((resolve) => {
    modeTimer = setTimeout(resolve, milliseconds)
  })
}

async function waitForPaint() {
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

async function extractHandoffCover(target: CoverRect) {
  await waitForPaint()
  const element = document.querySelector<HTMLElement>('.immersive-handoff-cover')
  if (!element) {
    setHandoffRect(target)
    return
  }
  const animation = element.animate([
    { top: `${handoffCover.top}px`, left: `${handoffCover.left}px`, width: `${handoffCover.width}px`, height: `${handoffCover.height}px`, transform: 'scale(.96)' },
    { top: `${target.top - 24}px`, left: `${target.left + 68}px`, width: `${target.width}px`, height: `${target.height}px`, transform: 'scale(1.035)', offset: .56 },
    { top: `${target.top}px`, left: `${target.left}px`, width: `${target.width}px`, height: `${target.height}px`, transform: 'scale(1)' },
  ], { duration: 640, easing: 'cubic-bezier(.18,.82,.16,1)', fill: 'forwards' })
  await animation.finished.catch(() => undefined)
  setHandoffRect(target)
  animation.cancel()
}

function setLyricRow(element: unknown, index: number) {
  lyricRows.value[index] = element instanceof HTMLElement ? element : null
}

function scrollToActive(behavior: ScrollBehavior = 'smooth') {
  if (!props.open || mode.value !== 'standard' || activeLyric.value < 0 || autoFollowPaused.value) return
  const container = lyricsView.value
  const row = lyricRows.value[activeLyric.value]
  if (!container || !row) return
  const containerRect = container.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const rowTop = rowRect.top - containerRect.top + container.scrollTop
  container.scrollTo({
    top: Math.max(0, rowTop - container.clientHeight / 2 + rowRect.height / 2),
    behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior,
  })
}

function pauseAutoFollow() {
  if (!props.lyrics.some((line) => line.time >= 0)) return
  autoFollowPaused.value = true
  if (resumeTimer) clearTimeout(resumeTimer)
  resumeTimer = setTimeout(resumeAutoFollow, 3500)
}

function resumeAutoFollow() {
  if (resumeTimer) clearTimeout(resumeTimer)
  autoFollowPaused.value = false
  void nextTick(() => scrollToActive())
}

function canSeekLyric(line: ParsedLyric) {
  return Number.isFinite(line.time) && line.time >= 0 && props.lyricsSynced && props.canSeek
}

function seekLyric(line: ParsedLyric) {
  if (!canSeekLyric(line)) return
  emit('seek', line.time)
  resumeAutoFollow()
}

function toggleCoverPosition() {
  if (lyricsVisible.value) return
  coverForward.value = !coverForward.value
  if (standardCover.value.key === currentStandardCover().key) standardCover.value.expanded = coverForward.value
}

function beginStandardCoverChange(element: Element) {
  standardEnterOwners.set(element, standardRenderKey.value)
  standardCoverEntering.value = true
  if (standardEnterTimer) clearTimeout(standardEnterTimer)
  const owner = standardRenderKey.value
  standardEnterTimer = setTimeout(() => {
    if (owner !== standardRenderKey.value || !standardCoverVisible.value) return
    element.getAnimations?.().filter(animation => (animation as CSSAnimation).animationName === 'standard-cover-in').forEach(animation => {
      try { animation.finish() } catch { animation.cancel() }
    })
    element.classList.remove('standard-cover-change-enter-active', 'standard-cover-change-enter-from', 'standard-cover-change-enter-to', 'airplay-cover-change-enter-active', 'airplay-cover-change-enter-from', 'airplay-cover-change-enter-to')
    finishStandardCoverChange(element)
  }, 750)
  publishFocusState()
}

function finishStandardCoverChange(element: Element) {
  if (standardEnterOwners.get(element) !== standardRenderKey.value || !standardCoverVisible.value || pendingStandardCover.value || standardCover.value.key !== currentStandardCover().key) return
  if (standardEnterTimer) clearTimeout(standardEnterTimer)
  standardEnterTimer = null
  standardCoverEntering.value = false
  coverForward.value = false
  standardCover.value.expanded = false
  publishFocusState()
}

function currentStandardCover(): StandardCoverSnapshot {
  const target = standardTargetTrack.value
  return {
    key: (target?.playbackId ?? trackKey(target)) || 'empty',
    artwork: isSameTrack(target, props.track) ? props.artwork || target?.artworkUrl || '' : target?.artworkUrl || '',
    album: target ? target.album || '当前专辑' : '当前没有播放',
    expanded: false,
  }
}

function flushPendingStandardCover(generation: number) {
  if (generation !== standardCoverGeneration || !pendingStandardCover.value) return
  const now = performance.now()
  const readyAt = Math.max(standardCoverLeaveDeadline + standardCoverGapMs, standardCoverLastChangeAt + standardCoverIdleMs)
  if (now + 4 < readyAt) {
    standardCoverTimer = setTimeout(() => flushPendingStandardCover(generation), readyAt - now)
    return
  }
  standardCover.value = pendingStandardCover.value
  pendingStandardCover.value = null
  standardRenderKey.value += 1
  standardCoverEntering.value = true
  standardCoverVisible.value = true
  standardCoverTimer = null
  publishFocusState()
}

function scheduleStandardCoverChange() {
  const nextCover = currentStandardCover()
  if (standardCover.value.key === nextCover.key && !pendingStandardCover.value && standardCoverVisible.value) {
    standardCover.value.artwork = nextCover.artwork
    return
  }
  const generation = ++standardCoverGeneration
  if (props.airplay) {
    if (standardCoverTimer) clearTimeout(standardCoverTimer)
    standardCoverTimer = null
    standardCover.value = nextCover; pendingStandardCover.value = null
    standardRenderKey.value += 1; standardCoverVisible.value = true; standardCoverEntering.value = false
    publishFocusState(); return
  }
  if (mode.value !== 'standard' || !props.open) {
    standardCover.value = nextCover
    pendingStandardCover.value = null
    standardCoverVisible.value = true
    standardCoverEntering.value = false
    standardCoverLastChangeAt = 0
    return
  }
  if (standardCoverEntering.value && standardCoverVisible.value) {
    standardCover.value = nextCover
    pendingStandardCover.value = null
    publishFocusState()
    return
  }
  pendingStandardCover.value = nextCover
  const now = performance.now()
  standardCoverLastChangeAt = now
  if (standardCoverVisible.value) {
    standardCover.value.expanded = coverForward.value
    standardCoverVisible.value = false
    standardCoverLeaveDeadline = now + standardCoverLeaveMs
  }
  if (standardCoverTimer) clearTimeout(standardCoverTimer)
  const showAt = Math.max(standardCoverLeaveDeadline + standardCoverGapMs, now + standardCoverIdleMs)
  standardCoverTimer = setTimeout(() => flushPendingStandardCover(generation), Math.max(0, showAt - now))
  publishFocusState()
}

function updateTonearm(event: PointerEvent) {
  const zone = recordZone.value
  if (!zone || !tonearmDragging.value) return
  const rect = zone.getBoundingClientRect()
  const pivotX = rect.right - rect.width * 0.03 - 27
  const pivotY = rect.top + rect.height * 0.13
  const dx = event.clientX - pivotX
  const dy = event.clientY - pivotY
  const rawAngle = Math.atan2(-dx, Math.max(1, dy)) * 180 / Math.PI
  const angle = Math.min(36, Math.max(-10, rawAngle))
  tonearmDragAngle.value = angle
  tonearmWillPause.value = angle < -5
  scrubPosition.value = tonearmWillPause.value ? null : (Math.max(3, angle) - 3) / 33 * props.duration
}

function beginTonearm(event: PointerEvent) {
  if (!props.duration || !props.canSeek) return
  tonearmDragging.value = true
  tonearmWillPause.value = false
  tonearmDragAngle.value = tonearmAngle.value
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  updateTonearm(event)
}

function finishTonearm(event: PointerEvent) {
  if (!tonearmDragging.value) return
  updateTonearm(event)
  if (tonearmWillPause.value) {
    if (props.isPlaying) emit('toggle')
  } else if (scrubPosition.value != null) {
    if (props.isPlaying) emit('seek', scrubPosition.value)
    else emit('seekResume', scrubPosition.value)
  }
  tonearmDragging.value = false
  tonearmWillPause.value = false
  tonearmDragAngle.value = null
  scrubPosition.value = null
}

function cancelTonearm() {
  tonearmDragging.value = false
  tonearmWillPause.value = false
  tonearmDragAngle.value = null
  scrubPosition.value = null
}

function moveCoverflow(direction: number) {
  if (props.airplay) { if (direction < 0) emit('previous'); else emit('next'); return }
  lastCoverflowPointer = { index: -1, key: '', track: null, time: 0, x: 0, y: 0 }
  if (props.playbackWindowDeferred) { railSource = 'wheel'; rail.aim(globalFocusIndex.value + direction); return }
  selectCoverflow(Math.min(coverflowItems.value.length - 1, Math.max(0, focusIndex.value + direction)))
}

function selectCoverflow(index: number) {
  if (props.airplay) return
  const item = coverflowItems.value[index]
  if (item?.track && !item.idle) emit('browseTrack', item.track)
}

function activateCoverflow(index: number) {
  const item = coverflowItems.value[index]
  if (!item || item.idle || !item.track) return
  if (props.airplay) { if (item.current) emit('toggle'); return }
  if (item.current) emit('toggle')
  else emit('playTrack', item.track)
}

function coverflowIndexAtPointer(event: PointerEvent) {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-cover-index]') : null
  if (target) return Number(target.dataset.coverIndex)
  const cards = [...(coverflowView.value?.querySelectorAll<HTMLElement>('[data-cover-index]:not(.far)') ?? [])]
  let closest = -1
  let closestDistance = Number.POSITIVE_INFINITY
  cards.forEach((card) => {
    const rect = card.getBoundingClientRect()
    const distance = Math.hypot(event.clientX - (rect.left + rect.right) / 2, event.clientY - (rect.top + rect.bottom) / 2)
    if (distance < closestDistance) {
      closest = Number(card.dataset.coverIndex)
      closestDistance = distance
    }
  })
  return closest
}

function handleCoverflowPointer(event: PointerEvent) {
  if (event.button !== 0) return
  const now = performance.now()
  const elapsed = now - lastCoverflowPointer.time
  const distance = Math.hypot(event.clientX - lastCoverflowPointer.x, event.clientY - lastCoverflowPointer.y)
  if (lastCoverflowPointer.index >= 0 && elapsed <= 420 && distance <= 48) {
    let targetIndex = coverflowItems.value.findIndex(item => item.key === lastCoverflowPointer.key)
    if (targetIndex < 0) targetIndex = coverflowItems.value.findIndex(item => item.track?.sourceIndex === lastCoverflowPointer.track?.sourceIndex && isSameTrack(item.track, lastCoverflowPointer.track))
    lastCoverflowPointer = { index: -1, key: '', track: null, time: 0, x: 0, y: 0 }
    activateCoverflow(targetIndex)
    return
  }
  const index = coverflowIndexAtPointer(event)
  if (index < 0) return
  lastCoverflowPointer = { index, key: coverflowItems.value[index]!.key, track: coverflowItems.value[index]!.track, time: now, x: event.clientX, y: event.clientY }
  selectCoverflow(index)
}

async function setMode(nextMode: 'standard' | 'coverflow') {
  if (mode.value === nextMode || modeTransition.value) return
  cancelOrderAnimation()
  lastCoverflowPointer = { index: -1, key: '', track: null, time: 0, x: 0, y: 0 }
  cancelTonearm()
  if (nextMode === 'coverflow') {
    if (coverForward.value) {
      modeTransition.value = 'retracting-standard'
      coverForward.value = false
      await waitForMode(680)
    }
    modeTransition.value = 'packing-standard'
    await waitForMode(640)
    const packedSleeve = readRect(document.querySelector('.immersive-standard .album-sleeve')) ?? fallbackCenterRect()
    setHandoffRect(packedSleeve)
    handoffCover.visible = true
    await waitForPaint()
    coverflowIndex.value = currentCoverflowIndex.value
    mode.value = 'coverflow'
    modeTransition.value = 'handoff-coverflow'
    await waitForPaint()
    handoffCover.visible = false
    modeTransition.value = 'unpacking-coverflow'
    await waitForMode(500)
    modeTransition.value = null
    return
  }
  coverForward.value = false
  modeTransition.value = 'packing-coverflow'
  await waitForMode(640)
  const currentRect = readRect(document.querySelector('.coverflow-card.current')) ?? fallbackCenterRect()
  const centerRect = readRect(document.querySelector('.coverflow-card.active')) ?? fallbackCenterRect()
  if (coverflowIndex.value !== currentCoverflowIndex.value) {
    await waitForMode(300)
  }
  setHandoffRect(currentRect)
  handoffCover.visible = true
  await waitForPaint()
  if (coverflowIndex.value !== currentCoverflowIndex.value) {
    await extractHandoffCover(centerRect)
  }
  else setHandoffRect(centerRect)
  coverflowIndex.value = currentCoverflowIndex.value
  standardCover.value = currentStandardCover()
  standardCoverVisible.value = true
  mode.value = 'standard'
  modeTransition.value = 'handoff-standard'
  await waitForPaint()
  handoffCover.visible = false
  modeTransition.value = 'unpacking-standard'
  await waitForMode(640)
  modeTransition.value = null
  void nextTick(() => scrollToActive('auto'))
}

function onCoverflowWheel(event: WheelEvent) {
  if (props.airplay) return
  if (idleCoverflow.value || modeTransition.value || event.ctrlKey) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (!delta) return
  if (!railState.active || railSource === 'intent' || props.playbackPreviewPending) emit('beginBrowse')
  if (!railState.active) {
    const global = props.playbackTracks[focusIndex.value]?.sourceIndex ?? focusIndex.value
    let position = global
    const active = coverflowView.value?.querySelector<HTMLElement>('.coverflow-card.active')
    if (active && typeof DOMMatrixReadOnly !== 'undefined') {
      try {
        const live = new DOMMatrixReadOnly(getComputedStyle(active).transform).m41
        cancelOrderAnimation()
        const step = new DOMMatrixReadOnly(sampleCoverPose(active, 1).transform).m41 + active.offsetWidth / 2
        if (step > 1) position = global - (live + active.offsetWidth / 2) / step
      } catch { /* Static cards can use their logical position. */ }
    }
    cancelOrderAnimation()
    rail.reset(props.playbackPlanIds.length, position)
    lastRailSelection = -1
    lastRailDistant = false
  }
  railSource = 'wheel'
  railState.active = true
  rail.wheel(delta, event.deltaMode, coverflowView.value?.clientHeight ?? window.innerHeight)
  publishFocusState()
}

watch(activeLyric, () => void nextTick(() => scrollToActive()))
watch(() => trackKey(props.track), () => {
  lyricRows.value = []
  lastCoverflowPointer = { index: -1, key: '', track: null, time: 0, x: 0, y: 0 }
  coverForward.value = false
  cancelTonearm()
  resumeAutoFollow()
})
watch(() => currentStandardCover().key, scheduleStandardCoverChange)
watch(() => currentStandardCover().artwork, (artwork) => {
  const key = currentStandardCover().key
  if (pendingStandardCover.value?.key === key) pendingStandardCover.value.artwork = artwork
  if (standardCover.value.key === key) standardCover.value.artwork = artwork
})
watch(lyricsVisible, (visible) => {
  if (visible) {
    coverForward.value = false
    standardCover.value.expanded = false
  }
})
watch(() => [props.open, mode.value] as const, () => void nextTick(() => scrollToActive('auto')))
watch(coverflowPreloadSources, preloadCoverflowArtwork, { immediate: true })
watch(() => props.open, (open) => {
  if (open) {
    if (mode.value === 'standard') {
      standardCover.value = currentStandardCover()
      standardCoverVisible.value = true
      standardCoverEntering.value = false
      pendingStandardCover.value = null
    }
    return
  }
  cancelOrderAnimation()
  rail.dispose(); railState.active = false; railState.distant = false; railState.zoom = 0
  if (modeTimer) clearTimeout(modeTimer)
  if (standardCoverTimer) clearTimeout(standardCoverTimer)
  if (standardEnterTimer) clearTimeout(standardEnterTimer)
  modeTimer = null
  standardCoverTimer = null
  standardEnterTimer = null
  standardCoverGeneration += 1
  standardCoverEntering.value = false
  standardRenderKey.value += 1
  standardCoverLastChangeAt = 0
  pendingStandardCover.value = null
  standardCover.value = currentStandardCover()
  standardCoverVisible.value = true
  modeTransition.value = null
  handoffCover.visible = false
})

onBeforeUnmount(() => {
  rail.dispose()
  emit('focusState', { active: false, id: null, request: props.playbackPreviewRequest ?? 0, settled: true })
  cancelOrderAnimation()
  coverflowArtworkDecodeCache.clear()
  if (resumeTimer) clearTimeout(resumeTimer)
  if (modeTimer) clearTimeout(modeTimer)
  if (standardCoverTimer) clearTimeout(standardCoverTimer)
  if (standardEnterTimer) clearTimeout(standardEnterTimer)
  handoffCover.visible = false
  cancelTonearm()
})
</script>

<template>
  <Transition name="now-playing">
    <section v-if="open" class="now-playing-panel immersive-player" :class="[`immersive-player--${mode}`, fullscreen && 'immersive-player--fullscreen', modeTransition && `mode-${modeTransition}`, handoffCover.visible && 'handoff-cover-active']" aria-label="沉浸式正在播放">
      <div v-if="legacyBackgroundVisible" class="immersive-legacy-background" :style="{ opacity: legacyBackgroundOpacity }">
      <Transition name="immersive-backdrop">
        <div :key="backgroundArtwork || 'empty'" class="immersive-player__background" :style="backgroundArtwork ? { '--immersive-artwork': `url(${backgroundArtwork})` } : {}">
          <div class="immersive-player__backdrop" />
          <div class="immersive-player__chroma immersive-player__chroma--primary" />
          <div class="immersive-player__chroma immersive-player__chroma--echo" />
          <div class="immersive-player__prism" />
        </div>
      </Transition>
      <div class="immersive-player__wash" />
      </div>
      <FullscreenLightField :active="open && (fullscreen || fullscreenBackgroundProgress > .001)" :source="backgroundArtwork" :path="lightFieldPath" :progress="fullscreenBackgroundProgress" :suspended="railState.distant" @ready="lightFieldReady = $event" />
      <div v-if="handoffCover.visible" class="immersive-handoff-cover" :style="handoffCoverStyle"><ArtworkImage :src="artwork || track?.artworkUrl" :alt="`${track?.album ?? '当前专辑'} 交接封面`" /></div>

      <header class="immersive-toolbar">
        <button class="immersive-tool" aria-label="退出沉浸模式" @click="emit('close')"><X :size="19" /><span>退出沉浸</span></button>
        <div class="immersive-mode-switch" aria-label="沉浸显示模式">
          <button type="button" :class="{ active: mode === 'standard' }" aria-label="Standard" @pointerdown.stop @click.stop="setMode('standard')"><Rows3 :size="17" /><span>Standard</span></button>
          <button type="button" :class="{ active: mode === 'coverflow' }" aria-label="Coverflow" @pointerdown.stop @click.stop="setMode('coverflow')"><Layers3 :size="17" /><span>Coverflow</span></button>
        </div>
        <div class="immersive-toolbar__actions">
          <button v-if="mode === 'coverflow' && !airplay" class="immersive-tool" :disabled="shuffleBusy || !playbackTracks.length" aria-label="随机重排待播放曲目" @click="emit('shuffle')"><Shuffle :size="18" /><span>随机重排</span></button>
          <button v-if="mode === 'coverflow' && !airplay" class="immersive-tool" :disabled="shuffleBusy || !playbackTracks.length" aria-label="恢复待播放原序，保留人工编辑" title="恢复待播放原序，保留人工编辑；当前曲及播放历史不变" @click="emit('restoreOrder')"><RotateCcw :size="18" /><span>恢复原序</span></button>
          <button v-if="mode === 'standard'" class="immersive-tool" :aria-label="lyricsVisible ? '隐藏歌词' : '显示歌词'" @click="lyricsVisible = !lyricsVisible">
            <EyeOff v-if="lyricsVisible" :size="18" /><Eye v-else :size="18" /><span>{{ lyricsVisible ? '隐藏歌词' : '显示歌词' }}</span>
          </button>
          <button v-if="!airplay" class="immersive-tool" :aria-label="track?.isFavourite ? '取消收藏' : '收藏当前歌曲'" @click="track && emit('favourite', track)">
            <Heart :size="18" :fill="track?.isFavourite ? 'currentColor' : 'none'" /><span>{{ track?.isFavourite ? '取消收藏' : '收藏' }}</span>
          </button>
        </div>
      </header>
      <div v-if="airplay" class="airplay-live-status" role="status"><strong>AirPlay · 实时接收</strong><span>{{ remoteMessage || '播放与切歌由发送端控制 · 进度只读' }}</span></div>

      <div v-if="mode === 'standard'" key="standard" class="immersive-standard" :class="{ 'lyrics-hidden': !lyricsVisible }">
        <section class="vinyl-stage" :class="{ 'cover-forward': coverForward }">
          <Transition :name="airplay ? 'airplay-cover-change' : 'standard-cover-change'" @before-enter="beginStandardCoverChange" @after-enter="finishStandardCoverChange">
            <div v-if="standardCoverVisible" :key="standardRenderKey" class="album-sleeve" :class="{ interactive: !lyricsVisible, expanded: standardCover.expanded }" :role="lyricsVisible ? undefined : 'button'" :tabindex="lyricsVisible ? -1 : 0" :aria-label="lyricsVisible ? undefined : '切换封套位置'" @click="toggleCoverPosition" @keydown.enter="toggleCoverPosition">
              <ArtworkImage :src="standardCover.artwork" :alt="`${standardCover.album} 封面`" :eager="airplay" :retry-key="airplay ? artworkRevision : undefined" @load-error="airplay && emit('artworkError')" />
              <span class="album-sleeve__hint">{{ standardCover.expanded ? '收回封套' : '展开封套' }}</span>
            </div>
          </Transition>

          <div ref="recordZone" class="record-zone">
            <button class="vinyl-record" :class="{ spinning: isPlaying && !tonearmDragging }" :aria-label="isPlaying ? '暂停播放' : '继续播放'" @click="emit('toggle')">
              <span class="vinyl-record__grooves" />
              <span class="vinyl-record__label"><ArtworkImage :src="standardCover.artwork" alt="唱片标签" :eager="airplay" :retry-key="airplay ? artworkRevision : undefined" @load-error="airplay && emit('artworkError')" /></span>
              <span class="vinyl-record__spindle" />
              <span class="vinyl-record__hint">{{ isPlaying ? '暂停' : '播放' }}</span>
            </button>
            <div class="tonearm-base" />
            <button
              class="tonearm"
              :class="{ parked: playbackState !== 'playing' && !tonearmDragging, dragging: tonearmDragging, 'will-pause': tonearmWillPause }"
              :style="{ '--tonearm-angle': `${tonearmAngle}deg` }"
              :aria-label="airplay ? 'AirPlay 发送端播放进度，只读' : '拖动唱针调整进度，拖出唱片暂停'"
              :disabled="airplay"
              @pointerdown.prevent="beginTonearm"
              @pointermove.prevent="updateTonearm"
              @pointerup.prevent="finishTonearm"
              @pointercancel="cancelTonearm"
              @lostpointercapture="tonearmDragging && cancelTonearm()"
            ><span /><i /></button>
          </div>

          <div class="immersive-track-copy">
            <p>{{ playbackPreviewPending ? '准备播放 · ' : '' }}{{ standardTargetTrack?.album || '你的音乐库' }}</p>
            <h1>{{ standardTargetTrack?.title || '当前没有播放' }}</h1>
            <span>{{ standardTargetTrack?.artist || '选择一首曲目开始播放' }}</span>
            <small v-if="playbackPreviewPending">封套到位后播放</small>
            <small v-else>{{ formatTime(scrubPosition ?? position) }} / {{ formatTime(duration) }}</small>
          </div>
        </section>

        <section v-if="lyricsVisible" class="immersive-lyrics" aria-label="歌词">
          <div ref="lyricsView" class="immersive-lyrics__scroll" @wheel.passive="pauseAutoFollow" @touchstart.passive="pauseAutoFollow" @pointerdown="pauseAutoFollow">
            <template v-if="lyrics.length">
              <button
                v-for="(line, index) in lyrics"
                :key="`${line.time}-${index}`"
                :ref="(element) => setLyricRow(element, index)"
                :class="{ active: index === activeLyric, past: index < activeLyric }"
                :disabled="!canSeekLyric(line)"
                :title="canSeekLyric(line) ? `点击跳转到 ${formatTime(line.time)}` : '此歌词无法定位播放时间'"
                :aria-label="canSeekLyric(line) ? `跳转到 ${formatTime(line.time)}：${line.text}` : line.text"
                @click.stop="seekLyric(line)"
              ><span>{{ line.text }}</span><small v-if="canSeekLyric(line)" class="lyric-seek-time">{{ formatTime(line.time) }}</small></button>
              <button v-if="autoFollowPaused" class="lyrics-follow" @click.stop="resumeAutoFollow"><LocateFixed :size="15" /> 跟随当前歌词</button>
            </template>
            <div v-else class="immersive-empty"><Mic2 :size="30" /><strong>{{ track ? '暂无歌词' : '当前没有播放' }}</strong><span>{{ track ? '内嵌歌词和同名歌词文件会显示在这里。' : '选择一首曲目开始播放。' }}</span></div>
          </div>
        </section>
      </div>

      <section v-else key="coverflow" class="coverflow" :class="{ 'is-order-reflowing': orderReflowing, 'is-rail-moving': railState.active, 'is-distant': railState.distant }" @wheel.prevent="onCoverflowWheel">
        <div ref="coverflowView" class="coverflow__viewport" @pointerup.stop.prevent="handleCoverflowPointer">
          <div class="coverflow__covers" :style="{ opacity: Math.max(0, 1 - railState.zoom * 1.7), transform: `scale(${1 - railState.zoom * .92})` }">
          <button
            v-for="item in visibleCoverflowItems"
            :key="item.key"
            :data-cover-index="item.index"
            :data-cover-key="item.key"
            :disabled="airplay && !item.current"
            class="coverflow-card"
            :class="{ active: !item.leaving && Math.abs(coverflowOffset(item)) < .01, current: item.current || item.idle, idle: item.idle, 'is-order-leaving': item.leaving, 'is-order-removed': item.removed }"
            :style="{ '--cover-offset': coverflowOffset(item), '--cover-distance': Math.abs(coverflowOffset(item)), '--cover-image': item.artwork ? `url(${item.artwork})` : 'none' }"
            @keydown.enter.prevent="activateCoverflow(item.index)"
          >
            <span class="coverflow-card__sleeve">
              <span class="coverflow-card__face"><ArtworkImage :src="item.artwork" :alt="`${item.track?.album ?? standardCover.album} 封面`" :eager="airplay" :retry-key="airplay && item.current ? artworkRevision : undefined" @load-error="airplay && item.current && emit('artworkError')" /></span>
              <i class="coverflow-card__edge coverflow-card__edge--left" />
              <i class="coverflow-card__edge coverflow-card__edge--right" />
              <i class="coverflow-card__edge coverflow-card__edge--bottom"><b>{{ item.track ? `${item.track.title} · ${item.track.artist}` : standardCover.album }}</b></i>
            </span>
          </button>
          </div>
          <div v-if="railPoints.length" class="coverflow__dots" :style="{ opacity: railState.zoom }" aria-label="高速浏览轨道">
            <button v-for="index in railPoints" :key="index" class="coverflow__dot" :class="{ active: index === Math.round(railState.position) }" :style="{ '--point-offset': index - railState.position, '--point-distance': Math.abs(index - railState.position) }" :aria-label="`浏览第 ${index + 1} 首`" @pointerup.stop.prevent="railSource = 'wheel'; rail.aim(index)" />
          </div>
        </div>
        <button v-if="airplay || !idleCoverflow" class="coverflow__arrow coverflow__arrow--left" :disabled="!airplay && globalFocusIndex === 0" :aria-label="airplay ? '发送端上一首' : '上一张封面'" @click="moveCoverflow(-1)"><ChevronLeft :size="22" /><span>{{ airplay ? '上一首' : '上一张' }}</span></button>
        <button v-if="airplay || !idleCoverflow" class="coverflow__arrow coverflow__arrow--right" :disabled="!airplay && globalFocusIndex >= playbackPlanIds.length - 1" :aria-label="airplay ? '发送端下一首' : '下一张封面'" @click="moveCoverflow(1)"><ChevronRight :size="22" /><span>{{ airplay ? '下一首' : '下一张' }}</span></button>
        <div v-if="selectedCoverflow" class="coverflow__copy">
          <small v-if="shuffleSourceName" class="coverflow__shuffle-info">{{ shuffleSourceName }} · {{ shuffleStaged ? '最新编辑待提交，封面显示已提交计划' : shufflePending ? '计划待下一曲接管' : '播放工作集' }}</small>
          <p>{{ railState.distant ? `高速浏览 · 第 ${Math.round(railState.target) + 1} 首` : playbackPreviewPending && selectedCoverflow.key === playbackPreviewId ? '准备播放' : selectedCoverflow.idle ? (selectedCoverflow.track ? '未加入播放列表' : '当前没有播放') : selectedCoverflow.current ? '正在播放' : `播放列表第 ${(selectedCoverflow.track?.sourceIndex ?? coverflowIndex) + 1} 首` }}</p>
          <h1>{{ selectedCoverflow.track?.title || standardCover.album || '当前没有播放' }}</h1>
          <span v-if="selectedCoverflow.track">{{ selectedCoverflow.track.artist }} · {{ selectedCoverflow.track.album }}</span>
          <span v-else>最后播放的专辑封面会保留在这里</span>
          <small>{{ airplay ? '历史封面仅展示 · 双击当前封面播放 / 暂停' : selectedCoverflow.idle ? '播放列表开始后会在此展开封面流' : selectedCoverflow.current ? `双击封面${isPlaying ? '暂停' : '播放'}` : '单击选择，双击播放' }}</small>
        </div>
      </section>

    </section>
  </Transition>
</template>
