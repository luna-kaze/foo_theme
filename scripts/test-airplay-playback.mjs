import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { randomUUID } from 'node:crypto'
const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const compiled = await build({ entryPoints: ['src/utils/airplayPlayback.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'] })
function clock() {
  let id = 0
  const tasks = new Map()
  return { tasks, setTimeout: (run, ms) => { tasks.set(++id, { run, ms }); return id }, clearTimeout: id => tasks.delete(id) }
}
const module = { exports: {} }, timers = clock()
runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require, ...timers })
const { airplayPath, createAirplayPlayback } = module.exports
const stream = (generation, title = `Song ${generation}`) => ({ path: `airplay://live/${generation}`, title, artist: 'Sender', album: 'Album', duration: 180, subsong: 0 })
for (const path of ['C:\\Music\\AirPlay.flac', 'https://radio/airplay', 'airplay://live/0', 'airplay://live/12x']) assert.equal(airplayPath({ path }), '')
assert.equal(airplayPath({ path: 'airplay://live/12|subsong:0' }), 'airplay://live/12')
let actual = stream(1), artwork = 'cover-1', deferred = null, enters = 0
const publications = [], commands = [], leaves = []
const player = createAirplayPlayback({
  enter: async () => { enters++; return true },
  read: async () => ({ track: actual, position: 43 }),
  artwork: async () => deferred ? new Promise(resolve => { deferred = resolve }) : artwork,
  publish: (track, image, history, position) => publications.push({ track, image, history, position }),
  command: async (direction, path) => { commands.push({ direction, path }); return true },
  leave: async track => leaves.push(track), notify() {},
})
await player.accept({ track: actual, position: 43 })
assert.equal(enters, 1); assert.equal(publications.at(-1).image, 'cover-1')
actual = { ...actual, title: 'Corrected title', album: 'Corrected album' }; artwork = 'cover-corrected'
await player.refresh()
assert.equal(publications.at(-1).track.album, 'Corrected album')
assert.equal(publications.at(-1).image, 'cover-corrected')
assert.equal(publications.at(-1).history.length, 1, 'same-generation corrections never add a fake song occurrence')
console.log('PASS: URI-only recognition and same-generation title, album, cover and timeline refresh')

deferred = true
const sameSourceImage = player.accept({ track: { ...actual, title: 'Image pending' } })
for (let step = 0; step < 16 && typeof deferred !== 'function'; step++) await Promise.resolve()
const releaseSameSource = deferred
await player.accept({ track: { ...actual, title: 'Latest metadata' } })
releaseSameSource('slow-valid-same-source'); deferred = null
await sameSourceImage
assert.equal(publications.at(-1).image, 'slow-valid-same-source')
assert.equal(publications.at(-1).track.title, 'Latest metadata')
artwork = ''
for (let attempt = 0; attempt < 5; attempt++) await player.accept({ track: actual })
assert.equal(publications.at(-1).image, 'slow-valid-same-source', 'repeated unavailable covers must never blank the last decoded cover')
assert.equal(player.state.artworkPending, true)
artwork = 'late-valid-cover'
await player.refresh()
assert.equal(publications.at(-1).image, 'late-valid-cover')
console.log('PASS: slow same-source covers survive metadata edits; repeated empty results preserve the last image and late covers can recover')

deferred = true; actual = stream(2)
const slow = player.accept({ track: actual })
for (let step = 0; step < 16 && typeof deferred !== 'function'; step++) await Promise.resolve()
const release = deferred; deferred = null
actual = stream(3); artwork = 'cover-3'
await player.accept({ track: actual })
release('late-cover-2'); await slow
assert.equal(publications.at(-1).track.title, 'Song 3')
assert.equal(publications.at(-1).image, 'cover-3')
assert.equal(publications.at(-1).history.at(-2).artworkUrl, '', 'an outgoing image is never falsely archived as the pending song’s own cover')
console.log('PASS: newer snapshots reject late covers and preserve a bounded, truthful read-only history')

await Promise.all([player.remote(1), player.remote(1), player.remote(-1)])
assert.deepEqual(commands.map(item => item.direction), [1, 1, -1], 'remote presses are ordered, never collapsed into one local target')
assert.equal(player.state.pending, true)
player.observePosition(0)
assert.equal(player.state.pending, false, 'sender Previous may restart the same live song without changing generation')
await player.remote(1)
const timeout = [...timers.tasks.values()].find(task => task.ms === 6000)
timeout.run()
assert.equal(player.state.pending, false)
assert.equal(commands.length, 4, 'timeout must never retransmit a remote command')
await player.remote(-1)
const beforeDirection = player.state.confirmedDirection
assert.equal(beforeDirection, 0, 'pressing a remote button cannot move the existing deck before metadata confirms it')
await player.accept({ track: stream(4) })
assert.equal(player.state.confirmedDirection, -1)
await player.remote(1); await player.accept({ track: stream(5) })
assert.equal(player.state.confirmedDirection, 1)
await player.accept({ track: stream(6) })
assert.equal(player.state.confirmedDirection, 0, 'unknown iOS changes use neutral animation')
for (let generation = 4; generation < 15; generation++) await player.accept({ track: stream(generation) })
assert.equal(publications.at(-1).history.length, 7)
actual = { ...stream(20), path: 'C:\\Music\\Local.flac' }
await player.refresh()
assert.equal(player.state.active, false); assert.equal(leaves.length, 1)
const count = publications.length
player.reconcile(); player.dispose()
assert.equal(publications.length, count)
console.log('PASS: FIFO remote semantics, same-song restart, no retry on timeout, seven-cover bound and clean local handover')
console.log('PASS: animation direction commits only with received snapshots; external iOS changes remain direction-neutral')

const source = readFileSync('src/composables/useFoobar.ts', 'utf8') + '\nexport { syncCurrentTrack, bindEvents }\n'
const theme = await build({ stdin: { contents: source, resolveDir: `${process.cwd()}/src/composables`, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue', 'foo-webview-sdk'] })
const callbacks = new Map(), nativeCalls = [], themeClock = clock()
let nativeTrack = stream(101)
let dynamicTitle = null
const sdk = {
  on: (name, callback) => { callbacks.set(name, callback); return () => {} },
  config: { set: async () => ({ success: true }) },
  player: {
    getCurrentTrack: async () => nativeTrack,
    getPosition: async () => ({ position: 37, duration: nativeTrack.duration, path: nativeTrack.path }),
    next: async () => { nativeCalls.push('next'); return { success: true } },
    prev: async () => { nativeCalls.push('prev'); return { success: true } },
    seek: async () => assert.fail('live streams must not seek'),
    getPlayingPlaylist: async () => { nativeCalls.push('playlistLookup'); return { playlist: -1 } },
    getCurrentTrackIndex: async () => ({ index: -1 }),
  },
  artwork: { getForTrack: async path => ({ available: true, dataUrl: `image:${path}` }) },
  titleformat: { eval: async () => ({ success: true, result: [nativeTrack?.path || '', dynamicTitle || nativeTrack?.title || '', 'Dynamic sender', 'Dynamic album'].join('\u001f') }) },
  queue: { get: async () => ({ items: [] }) },
}
const exported = { exports: {} }
class Image {
  naturalWidth = 100; naturalHeight = 100
  set src(value) { this.value = value; queueMicrotask(() => this.onload?.()) }
  decode() { return Promise.resolve() }
}
runInNewContext(theme.outputFiles[0].text, { module: exported, exports: exported.exports,
  require: id => id === 'foo-webview-sdk' ? { ...sdk, __esModule: true, default: sdk } : require(id),
  crypto: { randomUUID }, URL, URLSearchParams, performance, console, Image, ...themeClock,
  window: { location: { search: '', href: 'https://theme.test/' }, removeEventListener() {} },
  document: { removeEventListener() {} },
})
const themePlayer = exported.exports.useFoobar()
themePlayer.state.connected = true; themePlayer.state.playbackState = 'playing'
await exported.exports.syncCurrentTrack(nativeTrack)
assert.equal(themePlayer.airplayState.active, true)
assert.equal(themePlayer.state.canSeek, false)
dynamicTitle = 'Dynamic stream title'
await [...themeClock.tasks.values()].find(task => task.ms === 100).run()
assert.equal(themePlayer.state.currentTrack.title, 'Dynamic stream title')
assert.equal(themePlayer.state.currentTrack.album, 'Dynamic album')
assert.equal(themePlayer.state.playbackTracks.length, 1)
await themePlayer.next(); await themePlayer.previous()
assert.deepEqual(nativeCalls, ['next', 'prev'])
await themePlayer.addTracksToQueue([{ ...stream(0), path: 'C:\\Music\\Local.flac' }])
await themePlayer.playNext({ ...stream(0), path: 'C:\\Music\\Local.flac' })
assert.deepEqual(nativeCalls, ['next', 'prev'], 'live streams cannot re-register local scheduling through queue-edit shortcuts')
assert.equal(await themePlayer.seek(12), false)
await themePlayer.playPlaybackTrack(stream(100))
assert.deepEqual(nativeCalls, ['next', 'prev'], 'history must never replay an obsolete live URL')
exported.exports.bindEvents()
callbacks.get('playback:stopped')({ reason: 'unknown' })
assert.equal(themePlayer.airplayState.active, true, 'native Next can briefly stop its live item while the sender prepares a new generation')
nativeTrack = null
await themePlayer.next()
assert.deepEqual(nativeCalls, ['next', 'prev', 'next'], 'confirmed remote handover can accept another command while its decoder handle is temporarily vacant')
nativeTrack = { ...stream(999), path: 'C:\\Music\\Local.flac' }
await themePlayer.next()
assert.deepEqual(nativeCalls, ['next', 'prev', 'next'], 'a native local handle must never dispatch an AirPlay request from stale UI state')
nativeTrack = stream(102)
await exported.exports.syncCurrentTrack(nativeTrack)
assert.equal(themePlayer.state.currentTrack.title, 'Song 102')
assert.equal(themePlayer.state.playbackTracks.length, 2)
callbacks.get('playback:stopped')({ reason: 'user' })
assert.equal(themePlayer.airplayState.active, true)
assert.equal(themePlayer.state.currentTrack.title, 'Song 102')
assert.equal(themePlayer.state.playbackTracks.length, 2, 'decoder stop must not clear the received cover history')
const sent = nativeCalls.length
callbacks.get('playback:starting')({ command: 'prev' })
callbacks.get('playback:timeHighRes')({ position: 0 })
callbacks.get('playback:stopped')({ reason: 'user' })
nativeTrack = stream(103)
await exported.exports.syncCurrentTrack(nativeTrack)
assert.equal(themePlayer.airplayState.confirmedDirection, -1)
assert.equal(nativeCalls.length, sent, 'observing native Previous never sends another control request')
assert.equal(themePlayer.state.playbackTracks.length, 3)
callbacks.get('playback:starting')({ command: 'next' })
callbacks.get('playback:stopped')({ reason: 'eof' })
nativeTrack = stream(104)
await exported.exports.syncCurrentTrack(nativeTrack)
assert.equal(themePlayer.airplayState.confirmedDirection, 1)
nativeTrack = null
callbacks.get('playback:stopped')({ reason: 'user' })
await exported.exports.syncCurrentTrack(null)
assert.equal(themePlayer.state.playbackTracks.length, 4)
assert.equal(themePlayer.state.currentTrack.title, 'Song 104')
themePlayer.dispose()
console.log('PASS: actual native Next/Previous, user/eof stops, empty handles and time resets preserve the cover deck and confirmed direction without duplicate commands')

const images = { exports: {} }
class CheckedImage {
  naturalWidth = 0; naturalHeight = 0
  set src(value) { if (value === 'valid-image') { this.naturalWidth = 320; this.naturalHeight = 320 } }
  decode() { return this.naturalWidth ? Promise.resolve() : Promise.reject(new Error('Bad image')) }
}
runInNewContext(compiled.outputFiles[0].text, { module: images, exports: images.exports, require, Image: CheckedImage, ...clock() })
assert.equal(await images.exports.decodeAirplayArtwork('valid-image'), true)
assert.equal(await images.exports.decodeAirplayArtwork('corrupt-image'), false)
assert.equal(await images.exports.decodeAirplayArtwork(''), false)
console.log('PASS: malformed image responses are rejected before replacing a decoded cover')

const { parse, compileScript } = require('@vue/compiler-sfc')
const vue = require('vue')
const artScript = compileScript(parse(readFileSync('src/components/ArtworkImage.vue', 'utf8')).descriptor, { id: 'art-retry' })
const artBundle = await build({ stdin: { contents: artScript.content, resolveDir: `${process.cwd()}/src/components`, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'] })
const artModule = { exports: {} }
runInNewContext(artBundle.outputFiles[0].text, { module: artModule, exports: artModule.exports, require })
const imageProps = vue.reactive({ src: 'unchanged-uri', alt: 'cover', retryKey: 1, eager: true })
const scope = vue.effectScope()
const artworkState = scope.run(() => artModule.exports.default.setup(imageProps, { expose() {}, emit() {} }))
artworkState.failed.value = true
imageProps.retryKey = 2
await vue.nextTick()
assert.equal(artworkState.failed.value, false, 'a failed unchanged URI can recover on an explicit validated retry')
scope.stop()
console.log('PASS: ArtworkImage resets failed state on a validated retry even when the URI is unchanged')
