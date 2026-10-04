import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const compiled = await require('esbuild').build({ entryPoints: ['src/utils/lightFieldSettings.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue', 'foo-webview-sdk'] })
const storage = new Map(), writes = []
let value = null, release = null, rejectSave = false
const sdk = { config: {
  get: async () => release ? new Promise(resolve => { release = resolve }) : ({ success: true, value }),
  set: async (key, input) => { writes.push({ key, input: { ...input } }); return { success: !rejectSave, error: rejectSave ? 'Host save failed' : undefined } },
} }
const module = { exports: {} }
runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports,
  require: id => id === 'foo-webview-sdk' ? { ...sdk, __esModule: true, default: sdk } : require(id),
  localStorage: { getItem: key => storage.get(key), setItem: (key, input) => storage.set(key, input) },
})
const api = module.exports
const clean = api.normalizeLightFieldSettings({ brightness: Infinity, speed: 0, hue: 500, opacity: -4, contrast: 'bad', animated: false, extra: 'ignored' })
assert.equal(clean.brightness, 1); assert.equal(clean.speed, .25); assert.equal(clean.hue, 180); assert.equal(clean.opacity, 0); assert.equal(clean.contrast, 1); assert.equal(clean.animated, false)
assert.equal('extra' in clean, false)
assert.equal(api.lightFieldStyle(api.lightFieldDefaults)['--light-primary-period'], '19s')
assert.equal(api.lightFieldStyle(api.lightFieldDefaults)['--light-filter'], 'none', 'default look avoids unnecessary color filter compositing')
assert.equal(api.lightFieldStyle(api.lightFieldDefaults)['--light-secondary-period'], '27s')
api.updateLightFieldSettings({ brightness: 1.8, hue: -45, speed: 2, blur: 25, animated: false })
const style = api.lightFieldStyle(api.lightFieldSettings)
assert.ok(style['--light-filter'].includes('brightness(1.8)'))
assert.ok(style['--light-filter'].includes('hue-rotate(-45deg)'))
assert.equal(style['--light-primary-period'], '9.5s'); assert.equal(style['--light-blur'], '25px')
console.log('PASS: settings normalize invalid input, clamp safe ranges and map controls to live color, softness and motion CSS')

await api.saveLightFieldSettings(true)
assert.equal(writes[0].input.brightness, 1.8)
assert.equal(writes[0].input.animated, false)
api.resetLightFieldSettings()
await api.loadLightFieldSettings(false)
assert.equal(api.lightFieldSettings.brightness, 1.8)
value = { brightness: .75, speed: 1.5 }
await api.loadLightFieldSettings(true)
assert.equal(api.lightFieldSettings.brightness, .75)
assert.equal(api.lightFieldSettings.speed, 1.5)
assert.equal(api.lightFieldSettings.blur, 0)
console.log('PASS: explicit save persists the host configuration and browser cache; loading restores saved values with defaults for missing fields')

release = true
const loading = api.loadLightFieldSettings(true)
api.updateLightFieldSettings({ brightness: 2.2 })
release({ success: true, value: { brightness: .4 } }); release = null
await loading
assert.equal(api.lightFieldSettings.brightness, 2.2, 'slow configuration loading must not overwrite the user’s current adjustment')
rejectSave = true
await assert.rejects(api.saveLightFieldSettings(true), /Host save failed/)
api.resetLightFieldSettings()
assert.deepEqual({ ...api.lightFieldSettings }, { ...api.lightFieldDefaults })
console.log('PASS: stale load cannot overwrite live edits; save failures are surfaced and reset restores the original look')
