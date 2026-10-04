import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
function clock() {
  let now = 0, id = 0
  const tasks = new Map()
  return {
    now: () => now,
    setTimeout(fn, delay) { const key = ++id; tasks.set(key, { at: now + delay, fn }); return key },
    clearTimeout(key) { tasks.delete(key) },
    tick(ms) {
      const end = now + ms
      for (;;) {
        const next = [...tasks].sort((a, b) => a[1].at - b[1].at).find(([, task]) => task.at <= end)
        if (!next) break
        tasks.delete(next[0]); now = next[1].at; next[1].fn()
      }
      now = end
    },
  }
}
const flush = async () => { for (let index = 0; index < 8; index++) await vue.nextTick() }
const bundled = await build({ entryPoints: ['src/utils/settledNavigation.ts'], bundle: true, platform: 'node', format: 'cjs', write: false })
const navigationClock = clock()
const module = { exports: {} }
runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, ...navigationClock, AbortController })
const { createSettledNavigation, createPlaybackFocusGate } = module.exports
{
  const previews = [], commits = [], clears = []
  const navigation = createSettledNavigation({ preview: target => previews.push(target), commit: async target => { commits.push(target); return true }, clear: () => clears.push(true) })
  const first = navigation.schedule(1)
  navigationClock.tick(200)
  const second = navigation.schedule(2)
  navigationClock.tick(300)
  const third = navigation.schedule(1)
  navigationClock.tick(349); await flush()
  assert.deepEqual(commits, [])
  navigationClock.tick(1); await flush()
  assert.deepEqual(previews, [1, 2, 1])
  assert.deepEqual(commits, [1])
  assert.deepEqual(await Promise.all([first, second, third]), [true, true, true])
  assert.equal(clears.length, 1)
  console.log('PASS: rapid next/previous previews every target and plays only the final settled choice')
}
{
  const commits = [], clears = []
  let release
  const navigation = createSettledNavigation({ preview() {}, commit: async target => { commits.push(target); if (target === 1) await new Promise(resolve => { release = resolve }); return true }, clear: () => clears.push(true) })
  const first = navigation.schedule(1)
  navigationClock.tick(350); await flush()
  const second = navigation.schedule(2)
  navigationClock.tick(350); await flush()
  assert.deepEqual(commits, [1])
  assert.equal(clears.length, 0)
  release(); await flush()
  assert.deepEqual(commits, [1, 2])
  assert.equal(clears.length, 1, 'an older in-flight request cannot clear the latest preview')
  assert.deepEqual(await Promise.all([first, second]), [true, true])
  console.log('PASS: settled decoder changes are serialized and stale completion preserves the newer preview')
}
{
  const commits = []
  const navigation = createSettledNavigation({ preview() {}, commit: async target => { commits.push(target); return true }, clear() {} })
  const pending = navigation.schedule(3)
  navigation.cancel(); navigationClock.tick(200); await flush()
  assert.equal(await pending, false)
  assert.deepEqual(commits, [])
  const failed = createSettledNavigation({ preview() {}, commit: async () => { throw new Error('simulated host error') }, clear() {} })
  const result = failed.schedule(4)
  navigationClock.tick(350); await flush()
  assert.equal(await result, false)
  console.log('PASS: cancel and host failures release all pending inputs without unwanted playback')
}

{
  const gate = createPlaybackFocusGate(), commits = []
  let request = 0
  gate.report({ active: true, id: 'work:0', request: 0, settled: true })
  const navigation = createSettledNavigation({
    preview: (_target, token) => { request = token },
    waitUntilReady: (id, token, signal) => gate.wait(id, token, signal),
    commit: async id => { commits.push(id); return true }, clear() {},
  })
  const first = navigation.schedule('work:1')
  navigationClock.tick(350); await flush()
  assert.deepEqual(commits, [], 'quiet time alone cannot start the decoder')
  gate.report({ active: true, id: 'work:1', request: request - 1, settled: true }); await flush()
  assert.deepEqual(commits, [], 'an old animation acknowledgement is not sufficient')
  gate.report({ active: true, id: 'work:1', request, settled: false }); await flush()
  assert.deepEqual(commits, [])
  const second = navigation.schedule('work:2')
  navigationClock.tick(350); await flush()
  gate.report({ active: true, id: 'work:1', request: request - 1, settled: true }); await flush()
  assert.deepEqual(commits, [], 'cancelled visual waits cannot block or play an older target')
  gate.report({ active: true, id: 'work:2', request, settled: true }); await flush()
  assert.deepEqual(commits, ['work:2'])
  assert.deepEqual(await Promise.all([first, second]), [true, true])
  console.log('PASS: playback requires quiet time plus the latest target/generation animation acknowledgement')
}

// Test the component's reactive animation logic, not a browser or live UI.
const descriptor = parse(readFileSync('src/components/NowPlayingPanel.vue', 'utf8')).descriptor
const script = compileScript(descriptor, { id: 'transition-test' })
const component = await build({
  stdin: { contents: script.content, sourcefile: 'NowPlayingPanel.vue.ts', resolveDir: `${process.cwd()}/src/components`, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
  plugins: [{ name: 'stub-view-components', setup(build) { build.onLoad({ filter: /\.vue$/ }, () => ({ contents: 'export default {}', loader: 'js' })) } }],
})
const animationClock = clock()
const hooks = [], animations = []
let state, failAnimation = false
const tracks = [0, 1, 2].map(index => ({ path: `${index}.flac`, title: `Track ${index}`, artist: 'Artist', album: `${index}`, albumArtist: 'Artist', duration: 100, artworkUrl: `album-${index}`, playbackId: `work:${index}`, sourceIndex: index }))
const elements = tracks.map((track, index) => ({
  dataset: { coverKey: track.playbackId },
  properties: new Map(), classes: new Set(), livePose: null,
  style: {
    getPropertyValue(name) { return elements[index].properties.get(name) ?? `${name === '--cover-distance' ? Math.abs(index - state.coverflowIndex.value) : index - state.coverflowIndex.value}` },
    setProperty(name, value) { elements[index].properties.set(name, value) },
    removeProperty(name) { elements[index].properties.delete(name) },
  },
  classList: { contains: name => elements[index].classes.has(name), toggle: (name, value) => value ? elements[index].classes.add(name) : elements[index].classes.delete(name) },
  animate(_frames, options) {
    if (failAnimation) throw new Error('simulated animation error')
    let finish, cancel
    const finished = new Promise((resolve, reject) => { finish = resolve; cancel = reject })
    const animation = { key: track.playbackId, frames: _frames, finished, finish, options, cancel: () => { elements[index].livePose = null; cancel(new Error('cancelled')) } }
    animations.push(animation)
    return animation
  },
}))
const componentModule = { exports: {} }
runInNewContext(component.outputFiles[0].text, {
  module: componentModule, exports: componentModule.exports,
  require: id => id === 'vue' ? { ...vue, onBeforeUnmount: fn => hooks.push(fn) } : require(id),
  ...animationClock, performance: { now: animationClock.now }, console,
  matchMedia: () => ({ matches: false }),
  getComputedStyle: element => element.livePose ?? ({ transform: `matrix(1,0,0,1,${Number(element.style.getPropertyValue('--cover-offset')) * 100},0)`, opacity: '1' }),
  Image: class { decode() { return Promise.resolve() } },
  requestAnimationFrame: fn => animationClock.setTimeout(fn, 16), cancelAnimationFrame: id => animationClock.clearTimeout(id),
  document: { querySelector: () => null }, window: { innerWidth: 1200, innerHeight: 800 },
})
const props = vue.reactive({ open: false, track: tracks[0], artwork: 'current-art-0', isPlaying: true, playbackState: 'playing', canSeek: true, position: 43, duration: 100, lyrics: [], lyricsSynced: false, playbackTracks: tracks, playbackPlanIds: tracks.map(track => track.playbackId), playbackTrackIndex: 0, playbackPreviewId: null, playbackPreviewPending: false, playbackPreviewRequest: 0, fullscreen: false, shuffleBusy: false, shufflePending: false, shuffleStaged: false, shuffleSourceName: 'Source' })
const scope = vue.effectScope()
const events = []
let standardGate = null
state = scope.run(() => componentModule.exports.default.setup(props, { expose() {}, emit(name, value) {
  events.push({ name, value })
  if (name === 'focusState') standardGate?.report(value)
  if (name === 'browseTrack') { props.playbackPreviewId = value.playbackId; props.playbackPreviewPending = false; props.playbackPreviewRequest += 1 }
} }))
state.coverflowView.value = { isConnected: true, querySelectorAll: () => elements }
state.mode.value = 'coverflow'; props.open = true
await flush()
props.playbackPreviewId = 'work:1'; await flush()
assert.equal(state.coverflowIndex.value, 1)
assert.equal(state.orderReflowing.value, true)
assert.equal(animations.at(-1).options.duration, 620, 'all focus moves use the original Coverflow curve and duration')
const older = [...animations]
elements[0].livePose = { transform: 'matrix(1,0,0,1,-35,0)', opacity: '.8' }
props.playbackPreviewId = 'work:2'; await flush()
assert.equal(state.coverflowIndex.value, 2, 'new focus is not ignored while a previous animation is active')
assert.equal(animations.slice(older.length).find(animation => animation.key === 'work:0').frames[0].transform, 'matrix(1,0,0,1,-35,0)', 'retargeting starts at the live intermediate pose instead of resetting to a CSS endpoint')
older.forEach(animation => animation.finish()); await flush()
assert.equal(state.orderReflowing.value, true, 'older completion cannot unlock or overwrite the newer animation')
animations.slice(older.length).forEach(animation => animation.finish()); await flush()
assert.equal(state.orderReflowing.value, false)
console.log('PASS: Coverflow retargets consecutive focus changes with an unchanged deck and ignores stale animation completion')

props.playbackTrackIndex = 1
props.track = tracks[0]; props.artwork = 'current-art-0'
await flush()
assert.equal(state.coverflowItems.value[1].artwork, 'album-1', 'new current slot never borrows the previous track artwork')
props.track = tracks[1]; props.artwork = 'current-art-1'; await flush()
assert.equal(state.coverflowItems.value[1].artwork, 'current-art-1')
console.log('PASS: asynchronously updated current-track artwork is matched to the correct Coverflow occurrence')

failAnimation = true
props.playbackPreviewId = 'work:0'; await flush()
assert.equal(state.orderReflowing.value, false)
assert.equal(state.coverflowIndex.value, 0)
failAnimation = false
props.playbackPreviewId = 'work:2'; await flush()
assert.equal(state.orderReflowing.value, true)
animationClock.tick(751); await flush()
assert.equal(state.orderReflowing.value, false, 'an unresolved native animation cannot lock the viewport forever')
assert.equal(state.coverflowIndex.value, 2)
console.log('PASS: animation errors and stalled finished promises recover to the latest focus instead of freezing')
state.selectCoverflow(0); await flush()
assert.equal(state.coverflowIndex.value, 0)
assert.equal(animations.at(-1).options.duration, 620)
state.moveCoverflow(1); await flush()
assert.equal(state.coverflowIndex.value, 1)
assert.equal(animations.at(-1).options.duration, 620)
assert.equal(animations.at(-1).options.easing, 'cubic-bezier(.18,.82,.16,1)')
state.activateCoverflow(2)
assert.ok(events.some(event => event.name === 'playTrack' && event.value.playbackId === 'work:2'))
assert.ok(events.some(event => event.name === 'focusState' && event.value.active && !event.value.settled))
animations.forEach(animation => animation.finish()); await flush()
assert.equal(events.filter(event => event.name === 'focusState').at(-1).value.settled, true)
console.log('PASS: card selection, arrows and active-animation activation share one motion path and publish readiness')

const allTracks = [...tracks, ...[3, 4, 5, 6, 7, 8, 9].map(index => ({ ...tracks[0], path: `${index}.flac`, title: `Track ${index}`, album: `${index}`, artworkUrl: `album-${index}`, playbackId: `work:${index}`, sourceIndex: index }))]
props.playbackPlanIds = allTracks.map(track => track.playbackId); await flush()
animations.forEach(animation => animation.finish()); await flush()
const originalElements = [...elements]
for (let index = 3; index < allTracks.length; index++) {
  const properties = new Map(), classes = new Set()
  const element = {
    dataset: { coverKey: allTracks[index].playbackId }, livePose: null,
    style: { getPropertyValue: name => properties.get(name) ?? `${name === '--cover-distance' ? Math.abs(index - state.coverflowIndex.value) : index - state.coverflowIndex.value}`, setProperty: (name, value) => properties.set(name, value), removeProperty: name => properties.delete(name) },
    classList: { contains: name => classes.has(name), toggle: (name, value) => value ? classes.add(name) : classes.delete(name) },
    animate(frames, options) {
      let finish, cancel
      const finished = new Promise((resolve, reject) => { finish = resolve; cancel = reject })
      const animation = { key: allTracks[index].playbackId, frames, options, finished, finish, cancel: () => cancel(new Error('cancelled')) }
      animations.push(animation); return animation
    },
  }
  elements.push(element)
}
let captureOld = true
state.coverflowView.value.querySelectorAll = () => { if (captureOld) { captureOld = false; return originalElements } return elements }
props.playbackTracks = allTracks
props.playbackPreviewId = 'work:6'
await flush()
const incoming = animations.filter(animation => animation.key === 'work:6').at(-1)
assert.notEqual(incoming.frames[0].transform, incoming.frames[1].transform, 'an unseen final cover must move in from its previous side position, not fade in at the center')
assert.equal(incoming.options.duration, 620)
assert.equal(state.coverflowIndex.value, 6)
animations.forEach(animation => animation.finish()); await flush()
assert.equal(state.orderReflowing.value, false)
console.log('PASS: newly materialized window cards enter from sampled 3D side poses instead of teleporting to the center')

state.mode.value = 'standard'
state.recordZone.value = { isConnected: true }
props.playbackPreviewId = null; props.playbackPreviewPending = false
await flush()
standardGate = createPlaybackFocusGate()
state.publishFocusState()
const standardCommits = []
const standardNavigation = createSettledNavigation({
  preview: (id, request) => { props.playbackPreviewId = id; props.playbackPreviewPending = true; props.playbackPreviewRequest = request },
  waitUntilReady: (id, request, signal) => standardGate.wait(id, request, signal),
  commit: async id => {
    standardCommits.push(id)
    props.playbackTrackIndex = props.playbackTracks.findIndex(track => track.playbackId === id)
    props.track = props.playbackTracks[props.playbackTrackIndex]
    props.artwork = `current-art-${props.playbackTrackIndex}`
    return true
  },
  clear: () => { props.playbackPreviewId = null; props.playbackPreviewPending = false },
})
const standardFirst = standardNavigation.schedule('work:2'); await flush()
assert.equal(state.standardCoverVisible.value, false)
assert.equal(state.pendingStandardCover.value.key, 'work:2')
navigationClock.tick(350); animationClock.tick(350); await flush()
assert.deepEqual(standardCommits, [], 'Standard must not decode after the quiet gap while its sleeve is still leaving')
const standardSecond = standardNavigation.schedule('work:3'); await flush()
navigationClock.tick(349); animationClock.tick(349); await flush()
assert.equal(state.standardCoverVisible.value, false)
navigationClock.tick(1); animationClock.tick(1); await flush()
assert.equal(state.standardCover.value.key, 'work:3')
assert.equal(state.standardCoverEntering.value, true)
const renderKey = state.standardRenderKey.value
const sleeve = { getAnimations: () => [], classList: { remove() {} } }
state.beginStandardCoverChange(sleeve)
navigationClock.tick(100); animationClock.tick(100); await flush()
const standardThird = standardNavigation.schedule('work:4'); await flush()
assert.equal(state.standardRenderKey.value, renderKey, 'a new target during entry reuses the same moving sleeve')
assert.equal(state.standardCover.value.key, 'work:4')
assert.equal(state.standardCover.value.artwork, 'album-4', 'preview artwork must not borrow the old actual track artwork')
assert.equal(state.standardTargetTrack.value.playbackId, 'work:4')
navigationClock.tick(350); animationClock.tick(350); await flush()
assert.deepEqual(standardCommits, [], 'both input quiet and final Standard entry completion are required')
state.finishStandardCoverChange(sleeve); await flush()
assert.deepEqual(standardCommits, ['work:4'])
assert.deepEqual(await Promise.all([standardFirst, standardSecond, standardThird]), [true, true, true])
assert.equal(state.standardRenderKey.value, renderKey, 'playback confirmation must not create a second sleeve transition')
assert.equal(state.standardCoverVisible.value, true)
assert.equal(state.pendingStandardCover.value, null)
assert.equal(state.standardCoverEntering.value, false)
console.log('PASS: Standard previews before decoding, merges vacant targets, retargets entry in place and plays only the final arrived sleeve')

const standardFourth = standardNavigation.schedule('work:5'); await flush()
navigationClock.tick(540); animationClock.tick(540); await flush()
const newerSleeve = { getAnimations: () => [], classList: { remove() {} } }
state.beginStandardCoverChange(newerSleeve)
state.finishStandardCoverChange(sleeve); await flush()
assert.equal(state.standardCoverEntering.value, true, 'stale entry completion cannot acknowledge a new sleeve')
assert.deepEqual(standardCommits, ['work:4'])
animationClock.tick(751); await flush()
assert.equal(await standardFourth, true)
assert.deepEqual(standardCommits, ['work:4', 'work:5'])
assert.equal(state.standardCoverEntering.value, false)
console.log('PASS: Standard ignores stale sleeve callbacks and recovers a stalled CSS entry before acknowledging playback')

props.playbackTracks[6] = { ...props.playbackTracks[5], playbackId: 'work:6', sourceIndex: 6, title: 'Repeated file occurrence' }
const duplicate = standardNavigation.schedule('work:6'); await flush()
assert.equal(state.pendingStandardCover.value.key, 'work:6', 'a repeated file still has a distinct preview occurrence')
navigationClock.tick(540); animationClock.tick(540); await flush()
const duplicateSleeve = { getAnimations: () => [], classList: { remove() {} } }
state.beginStandardCoverChange(duplicateSleeve)
const duplicateRender = state.standardRenderKey.value
standardNavigation.cancel(); await flush()
assert.equal(await duplicate, false)
assert.equal(state.standardCover.value.key, 'work:5')
assert.equal(state.standardRenderKey.value, duplicateRender, 'cancelling an unplayed target retargets the same incoming sleeve')
state.finishStandardCoverChange(duplicateSleeve); await flush()
assert.deepEqual(standardCommits, ['work:4', 'work:5'])
assert.equal(state.standardCoverEntering.value, false)
console.log('PASS: duplicate-file previews retain occurrence identity; cancellation restores the actual sleeve without decoding')

const hidden = standardNavigation.schedule('work:7'); await flush()
navigationClock.tick(350); animationClock.tick(350); await flush()
props.open = false; await flush()
assert.equal(await hidden, true, 'closing the view releases visual waiting rather than blocking a selected track indefinitely')
props.open = true; await flush()
assert.equal(state.standardCover.value.key, 'work:7')
assert.equal(state.standardCoverVisible.value, true)
assert.equal(state.standardCoverEntering.value, false)
assert.equal(state.pendingStandardCover.value, null)
console.log('PASS: closing and reopening Standard restores the actual sleeve and releases obsolete animation state')
hooks.forEach(fn => fn()); scope.stop()

const railScript = compileScript(parse(readFileSync('src/components/AlphabetIndexRail.vue', 'utf8')).descriptor, { id: 'rail-test' })
const railBundle = await build({ stdin: { contents: railScript.content, sourcefile: 'AlphabetIndexRail.vue.ts', resolveDir: `${process.cwd()}/src/components`, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'] })
const railClock = clock(), mounted = [], activated = [], deactivated = [], destroyed = []
function target() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn) },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn) },
    emit(type, event) { listeners.get(type)?.forEach(fn => fn(event)) },
  }
}
const scrollRoot = target(), doc = target(), win = target()
doc.querySelector = () => scrollRoot
const railModule = { exports: {} }
runInNewContext(railBundle.outputFiles[0].text, {
  module: railModule, exports: railModule.exports,
  require: id => id === 'vue' ? { ...vue, onMounted: fn => mounted.push(fn), onActivated: fn => activated.push(fn), onDeactivated: fn => deactivated.push(fn), onBeforeUnmount: fn => destroyed.push(fn) } : require(id),
  ...railClock, document: doc, window: win,
  requestAnimationFrame: fn => railClock.setTimeout(fn, 16), cancelAnimationFrame: id => railClock.clearTimeout(id),
})
const railScope = vue.effectScope()
const rail = railScope.run(() => railModule.exports.default.setup(vue.reactive({ available: ['A', 'B'], active: 'A' }), { expose() {}, emit() {} }))
rail.rail.value = { getBoundingClientRect: () => ({ left: 970, right: 995, top: 200, bottom: 600 }) }
mounted.forEach(fn => fn()); activated.forEach(fn => fn())
assert.equal(rail.visible.value, false)
assert.equal(scrollRoot.listeners.get('scroll').size, 1, 'KeepAlive activation does not duplicate scroll listeners')
scrollRoot.emit('scroll'); assert.equal(rail.visible.value, true)
railClock.tick(901); assert.equal(rail.visible.value, false)
scrollRoot.emit('wheel', { deltaX: 0, deltaY: 20, ctrlKey: false })
assert.equal(rail.visible.value, true)
railClock.tick(901)
scrollRoot.emit('wheel', { deltaX: 0, deltaY: 20, ctrlKey: true })
assert.equal(rail.visible.value, false)
doc.emit('pointermove', { clientX: 960, clientY: 400, pointerType: 'mouse' }); railClock.tick(16)
railClock.tick(2000); assert.equal(rail.visible.value, true)
doc.emit('pointermove', { clientX: 500, clientY: 400, pointerType: 'mouse' }); railClock.tick(16); railClock.tick(901)
assert.equal(rail.visible.value, false)
deactivated.forEach(fn => fn())
assert.equal(rail.sceneActive.value, false)
assert.equal(scrollRoot.listeners.get('scroll').size, 0)
activated.forEach(fn => fn())
assert.equal(rail.sceneActive.value, true)
assert.equal(rail.visible.value, false)
destroyed.forEach(fn => fn()); railScope.stop()
assert.equal(scrollRoot.listeners.get('scroll').size, 0)
assert.ok([...doc.listeners.values()].every(set => set.size === 0))
console.log('PASS: alphabet rail is hidden by default, shown by page scroll or edge proximity, and reset across cached scene activation')
