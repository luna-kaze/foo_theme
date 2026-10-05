import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const canvases = [], images = []
const samplePixels = source => new Uint8ClampedArray(Array.from({ length: 48 * 48 }, (_, index) => source.includes('red') ? [180, 62, 44, 255] : index % 3 ? [78, 115, 55, 255] : [152, 114, 78, 255]).flat())
class Image {
  set src(value) { this.source = value; images.push(value); queueMicrotask(() => value.includes('load-error') ? this.onerror?.() : this.onload?.()) }
  get src() { return this.source }
  decode() { return Promise.resolve() }
}
const document = { createElement() {
  const item = { width: 0, height: 0, drawCount: 0, stops: [], lastSource: '', getContext() { return context }, toDataURL: () => `data:image/png;base64,texture-${canvases.indexOf(item)}` }
  const context = { fillStyle: '', save() {}, restore() {}, translate() {}, scale() {}, fillRect() {}, createRadialGradient() { return { addColorStop: (offset, color) => item.stops.push({ offset, color }) } }, drawImage(image) { item.drawCount += 1; item.lastSource = image.src }, getImageData() { if (item.lastSource.includes('tainted')) throw new Error('tainted canvas'); return { data: samplePixels(item.lastSource) } } }
  canvases.push(item)
  return item
} }
const compiled = await build({ entryPoints: ['src/utils/albumLightField.ts'], bundle: true, platform: 'node', format: 'cjs', write: false })
const module = { exports: {} }
runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require, Image, document, setTimeout, clearTimeout })
const { extractLightPalette, renderAlbumLightField, generateAlbumLightField, createAlbumLightFieldCache } = module.exports
const pixels = [50, 120, 60, 255, 150, 95, 50, 255, 50, 120, 60, 255, 255, 255, 255, 255]
const permuted = pixels.slice(8).concat(pixels.slice(0, 8))
assert.deepEqual(extractLightPalette(pixels), extractLightPalette(permuted), 'palette is independent of poster layout')
const first = renderAlbumLightField('green', extractLightPalette(pixels))
assert.equal(first.palette.length, 2)
assert.deepEqual(canvases.slice(-3).map(item => [item.width, item.height]), [[1024, 768], [512, 512], [512, 512]])
assert.ok(canvases.slice(-3).every(item => item.drawCount === 0), 'generated textures never contain a blurred copy of the poster')
assert.ok(canvases.slice(-3).every(item => item.stops.some(stop => stop.offset === 1 && stop.color.endsWith(',0)'))))
for (const source of [[0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 0]]) assert.ok(extractLightPalette(source).every(color => [color.r, color.g, color.b].every(Number.isFinite)))
console.log('PASS: spatially independent palette, readable monochrome fallback, full-size base and pre-softened halo textures')

let nativeReads = 0
const native = await generateAlbumLightField('fb2k://cover/green', async () => { nativeReads += 1; return 'data:image/png;base64,green' })
assert.equal(nativeReads, 1)
assert.equal(native.fallback, false)
assert.ok(!images.includes('fb2k://cover/green'), 'native protocol uses a readable host data URL directly')
const recovered = await generateAlbumLightField('https://tainted/green', async () => 'data:image/png;base64,green')
assert.equal(recovered.fallback, false)
const failed = await generateAlbumLightField('https://load-error/cover')
assert.equal(failed.fallback, true)
console.log('PASS: native protocol and tainted-canvas recovery preserve real album colors; load failure produces a neutral field')

const releases = new Map(), counts = new Map()
const cache = createAlbumLightFieldCache(source => {
  counts.set(source, (counts.get(source) ?? 0) + 1)
  return new Promise(resolve => releases.set(source, () => resolve({ ...first, key: source })))
})
const old = cache.request('old'), newer = cache.request('new')
releases.get('new')(); assert.equal((await newer).key, 'new')
releases.get('old')(); assert.equal(await old, null)
assert.equal((await cache.request('old')).key, 'old')
assert.equal(counts.get('old'), 1)
const cancelled = cache.request('cancelled'); cache.cancel(); releases.get('cancelled')(); assert.equal(await cancelled, null)
for (let index = 0; index < 9; index++) { const next = cache.request(`album-${index}`); releases.get(`album-${index}`)(); await next }
const evicted = cache.request('old'); releases.get('old')(); await evicted
assert.equal(counts.get('old'), 2)
cache.dispose()
console.log('PASS: latest-only asynchronous publication, reusable generation cache, cancellation and bounded LRU eviction')

const script = compileScript(parse(readFileSync('src/components/FullscreenLightField.vue', 'utf8')).descriptor, { id: 'light-field-test' })
const component = await build({ stdin: { contents: script.content, sourcefile: 'FullscreenLightField.vue.ts', resolveDir: `${process.cwd()}/src/components`, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue', 'foo-webview-sdk'] })
const hooks = [], mounted = [], events = [], sdk = { artwork: { getForTrack: async () => ({ available: true, dataUrl: 'data:image/png;base64,green' }) } }
const exported = { exports: {} }
runInNewContext(component.outputFiles[0].text, { module: exported, exports: exported.exports, require: id => id === 'vue' ? { ...vue, onBeforeUnmount: fn => hooks.push(fn), onMounted: fn => mounted.push(fn) } : id === 'foo-webview-sdk' ? { ...sdk, __esModule: true, default: sdk } : require(id), Image, document, setTimeout, clearTimeout, performance })
const props = vue.reactive({ active: false, source: 'data:image/png;base64,green', path: 'green.flac', progress: 0, suspended: false })
const scope = vue.effectScope()
const state = scope.run(() => exported.exports.default.setup(props, { expose() {}, emit: (name, value) => events.push({ name, value }) }))
const flush = async () => { for (let index = 0; index < 20; index++) await vue.nextTick() }
const before = canvases.length
await flush(); assert.equal(canvases.length, before, 'ordinary-window mode never generates a new light-field texture')
props.active = true; props.progress = 1; await flush()
assert.ok(state.field.value)
const settingsCanvasCount = canvases.length
state.lightFieldSettings.brightness = 1.7
state.lightFieldSettings.speed = 2
assert.ok(state.fieldStyle.value['--light-filter'].includes('brightness(1.7)'))
assert.equal(state.fieldStyle.value['--light-primary-period'], '9.5s')
await flush()
assert.equal(canvases.length, settingsCanvasCount, 'live slider edits must not reread artwork or regenerate cached textures')
assert.equal(events.length, 0, 'legacy background must remain until initial light-field crossfade finishes')
state.finishCrossfade({ getAttribute: () => state.field.value.key })
assert.equal(events.at(-1).value, true)
const displayed = state.field.value
props.suspended = true; props.source = 'data:image/png;base64,red'; await flush()
assert.equal(state.field.value, displayed, 'high-speed mode retains its color source while halos can keep moving')
props.suspended = false; await flush()
assert.notEqual(state.field.value, displayed)
props.active = false; await flush()
hooks.forEach(fn => fn()); scope.stop()
console.log('PASS: fullscreen-only generation, post-crossfade readiness, high-speed source suspension and restoration')
console.log('PASS: live background settings update CSS without new image reads or texture generation')
