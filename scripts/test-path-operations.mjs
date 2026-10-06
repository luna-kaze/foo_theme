import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url), { build } = require('esbuild')
const vue = require('vue'), { parse, compileScript } = require('@vue/compiler-sfc')
const calls = [], handlers = new Set()
let writeMode = 'early'
const sdk = { on: (_name, fn) => { handlers.add(fn); return () => handlers.delete(fn) }, metadata: {
  write: async (path, tags, options) => {
    assert.ok(!path.includes('|subsong:'))
    calls.push({ path, tags, options })
    const event = { operation: 'write', path, subsong: options.cueIndex, success: writeMode !== 'aborted', status: writeMode === 'aborted' ? 'aborted' : 'success' }
    if (writeMode === 'denied') return { success: false, error: 'Permission denied' }
    handlers.forEach(fn => fn(event))
    return { success: true, dispatched: true }
  },
  read: async (path, options) => {
    assert.ok(!path.includes('|subsong:'))
    return { success: true, path, tags: { title: `Track ${options.cueIndex}`, album_artist: 'Album Artist' }, info: { duration: 180, codec: 'FLAC', sampleRate: 44100 } }
  },
} }
const bundle = await build({ entryPoints: ['src/utils/metadataLocation.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['foo-webview-sdk'] })
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'foo-webview-sdk' ? { ...sdk, __esModule: true, default: sdk } : require(id), URL, setTimeout, clearTimeout })
const track = (path, subsong = 0) => ({ path, subsong, title: 'Song', artist: 'Artist', album: 'Album', duration: 180 })
const ordinary = track('C:\\Users\\User\\Music\\song.m4a|subsong:0')
const cue = track('C:\\Users\\User\\Music\\album.flac|subsong:2', 2)
assert.equal(module.exports.metadataLocation(ordinary).path, 'C:\\Users\\User\\Music\\song.m4a')
assert.equal(module.exports.metadataLocation(cue).cueIndex, 2)
assert.equal(module.exports.metadataLocation(track('file:///C:/Music/a%20b.flac')).path, 'C:\\Music\\a b.flac')
assert.equal(module.exports.metadataLocation(track('file://server/share/a.flac')).path, '\\\\server\\share\\a.flac')
await module.exports.writeMetadataAndWait(ordinary, { TITLE: 'Edited' })
await module.exports.writeMetadataAndWait(cue, { TITLE: 'Cue edited' })
assert.equal(calls[1].options.cueIndex, 2)
assert.equal(handlers.size, 0, 'completion listeners are released even when completion precedes the RPC receipt')
writeMode = 'aborted'
await assert.rejects(module.exports.writeMetadataAndWait(ordinary, {}), /取消/)
writeMode = 'denied'
await assert.rejects(module.exports.writeMetadataAndWait(ordinary, {}), /Permission denied/)
assert.equal(handlers.size, 0)
console.log('PASS: clean media paths preserve CUE indices, decode file URIs and wait for actual writes without widening path access')

const source = await build({ entryPoints: ['src/composables/useFoobar.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue', 'foo-webview-sdk'] })
const exported = { exports: {} }
sdk.playcount = { getBatch: async () => { throw new Error('Optional statistics denied') } }
sdk.replaygain = { get: async () => { throw new Error('Optional statistics denied') } }
sdk.rating = { set: async (path, value, options) => { assert.ok(!path.includes('|subsong:')); calls.push({ rating: value, options }); return { success: true } } }
runInNewContext(source.outputFiles[0].text, { module: exported, exports: exported.exports, require: id => id === 'foo-webview-sdk' ? { ...sdk, fb: sdk, __esModule: true, default: sdk } : require(id), crypto: { randomUUID }, URL, URLSearchParams, performance, window: { location: { search: '', href: 'https://theme.test' } }, setTimeout: () => 1, clearTimeout() {} })
const player = exported.exports.useFoobar(); player.state.connected = true
const details = await player.getTrackDetails([ordinary, cue])
assert.equal(details[0].tags.title, 'Track 0'); assert.equal(details[1].tags.title, 'Track 2')
assert.equal(details[1].info.codec, 'FLAC')
assert.equal(await player.setTracksRating([ordinary, cue], 4), true)
console.log('PASS: actual theme reads structured tags for every track; optional statistic failures cannot blank the tag editor')

const descriptor = parse(readFileSync('src/components/TrackInspector.vue', 'utf8')).descriptor
const script = compileScript(descriptor, { id: 'inspector-read' })
const compiled = await build({ stdin: { contents: script.content, resolveDir: `${process.cwd()}/src/components`, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], plugins: [{ name: 'vue-stub', setup(b) { b.onResolve({ filter: /ArtworkImage\.vue$/ }, () => ({ path: 'artwork-stub', external: true })) } }] })
const inspector = { exports: {} }, events = []
runInNewContext(compiled.outputFiles[0].text, { module: inspector, exports: inspector.exports, require: id => id === 'artwork-stub' ? { default: {} } : require(id) })
const props = vue.reactive({ mode: 'edit', tracks: [ordinary], details: [], album: null, loading: false, busy: false })
const scope = vue.effectScope()
const state = scope.run(() => inspector.exports.default.setup(props, { expose() {}, emit: (name, value) => events.push({ name, value }) }))
state.save(); assert.equal(events.length, 0)
props.details = [details[0]]; await vue.nextTick()
assert.equal(state.fields.TITLE, 'Track 0'); assert.equal(state.fields['ALBUM ARTIST'], 'Album Artist')
state.save(); assert.equal(events[0].name, 'save')
scope.stop()
console.log('PASS: lowercase/underscore tags display correctly and an incomplete read cannot save empty tags')
