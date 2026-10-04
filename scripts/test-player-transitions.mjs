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
runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, ...navigationClock })
const { createSettledNavigation } = module.exports
{
  const previews = [], commits = [], clears = []
  const navigation = createSettledNavigation({ preview: target => previews.push(target), commit: async target => { commits.push(target); return true }, clear: () => clears.push(true) })
  const first = navigation.schedule(1)
  navigationClock.tick(50)
  const second = navigation.schedule(2)
  navigationClock.tick(50)
  const third = navigation.schedule(1)
  navigationClock.tick(179); await flush()
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
  navigationClock.tick(180); await flush()
  const second = navigation.schedule(2)
  navigationClock.tick(180); await flush()
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
  navigationClock.tick(180); await flush()
  assert.equal(await result, false)
  console.log('PASS: cancel and host failures release all pending inputs without unwanted playback')
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
  style: { getPropertyValue: () => index - state.coverflowIndex.value },
  classList: { contains: () => false },
  animate(_frames, options) {
    if (failAnimation) throw new Error('simulated animation error')
    let finish, cancel
    const finished = new Promise((resolve, reject) => { finish = resolve; cancel = reject })
    const animation = { finished, finish, options, cancel: () => cancel(new Error('cancelled')) }
    animations.push(animation)
    return animation
  },
}))
const componentModule = { exports: {} }
runInNewContext(component.outputFiles[0].text, {
  module: componentModule, exports: componentModule.exports,
  require: id => id === 'vue' ? { ...vue, onBeforeUnmount: fn => hooks.push(fn) } : require(id),
  ...animationClock, performance, console,
  matchMedia: () => ({ matches: false }),
  getComputedStyle: () => ({ transform: 'matrix(1,0,0,1,0,0)', opacity: '1' }),
  Image: class { decode() { return Promise.resolve() } },
  requestAnimationFrame: fn => animationClock.setTimeout(fn, 16), cancelAnimationFrame: id => animationClock.clearTimeout(id),
  document: { querySelector: () => null }, window: { innerWidth: 1200, innerHeight: 800 },
})
const props = vue.reactive({ open: false, track: tracks[0], artwork: 'current-art-0', isPlaying: true, playbackState: 'playing', canSeek: true, position: 43, duration: 100, lyrics: [], lyricsSynced: false, playbackTracks: tracks, playbackPlanIds: tracks.map(track => track.playbackId), playbackTrackIndex: 0, playbackPreviewId: null, fullscreen: false, shuffleBusy: false, shufflePending: false, shuffleStaged: false, shuffleSourceName: 'Source' })
const scope = vue.effectScope()
state = scope.run(() => componentModule.exports.default.setup(props, { expose() {}, emit() {} }))
state.coverflowView.value = { isConnected: true, querySelectorAll: () => elements }
state.mode.value = 'coverflow'; props.open = true
await flush()
props.playbackPreviewId = 'work:1'; await flush()
assert.equal(state.coverflowIndex.value, 1)
assert.equal(state.orderReflowing.value, true)
assert.equal(animations.at(-1).options.duration, 160, 'focus motion completes before the 180ms playback settlement gap')
const older = [...animations]
props.playbackPreviewId = 'work:2'; await flush()
assert.equal(state.coverflowIndex.value, 2, 'new focus is not ignored while a previous animation is active')
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
