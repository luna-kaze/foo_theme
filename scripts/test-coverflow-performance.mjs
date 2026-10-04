import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const bundle = await build({ entryPoints: ['src/utils/coverflowPerformance.ts'], bundle: true, platform: 'node', format: 'cjs', write: false })
let time = 100, sequence = 0, high = false, observer
const frames = new Map(), intervals = new Map()
const memory = { usedJSHeapSize: 1000 }
const view = { querySelectorAll: selector => Array.from({ length: high ? selector === '.coverflow__dot' ? 31 : 0 : selector === '.coverflow__dot' ? 0 : 7 }) }
const window = { setInterval: fn => { const id = ++sequence; intervals.set(id, fn); return id }, clearInterval: id => intervals.delete(id) }
class Observer {
  static supportedEntryTypes = ['longtask', 'resource']
  constructor(callback) { this.callback = callback; observer = this }
  observe() {}
  disconnect() { this.disconnected = true }
}
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, require, window, document: { querySelector: () => view },
  performance: { now: () => time, memory }, PerformanceObserver: Observer,
  requestAnimationFrame: fn => { const id = ++sequence; frames.set(id, fn); return id }, cancelAnimationFrame: id => frames.delete(id),
})
const { coverflowPerformance: profile, installCoverflowPerformance } = module.exports
const dispose = installCoverflowPerformance()
profile.record('coverWindowBuild', 10, 61)
assert.equal(profile.active, false)
assert.equal(frames.size, 0)
assert.equal(intervals.size, 0)
assert.deepEqual(Object.keys(profile.snapshot().tiers.near.events), [])
console.log('PASS: default profiling is disabled and creates no sampler, observer or measurement events')
profile.start()
function tick(ms) { time += ms; const pending = [...frames]; frames.clear(); pending.forEach(([, fn]) => fn(time)); intervals.forEach(fn => fn()) }
tick(16); tick(16)
profile.record('coverWindowBuild', 2, 61)
const nearResourceStart = time
time += 20; high = true; profile.setTier('high')
tick(16); tick(40); tick(16)
profile.record('lightweightTarget', 0, 1)
observer.callback({ getEntries: () => [
  { entryType: 'resource', initiatorType: 'img', startTime: nearResourceStart, duration: 30, name: 'https://private.example/path-to-image' },
  { entryType: 'longtask', startTime: time - 5, duration: 55 },
] })
memory.usedJSHeapSize = 1200
const report = profile.stop()
assert.equal(profile.active, false)
assert.equal(frames.size, 0)
assert.equal(intervals.size, 0)
assert.equal(observer.disconnected, true)
assert.equal(report.heapDeltaBytes, 200)
assert.equal(report.tiers.near.events.coverWindowBuild.items, 61)
assert.equal(report.tiers.near.events.imageResource.count, 1, 'in-flight requests are attributed by start time rather than current LOD')
assert.equal(report.tiers.high.events.lightweightTarget.count, 1)
assert.equal(report.tiers.high.events.coverWindowBuild, undefined)
assert.equal(report.tiers.high.events.longTask.count, 1)
assert.equal(report.tiers.high.maxDom.images, 0)
assert.equal(report.tiers.high.maxDom.dots, 31)
assert.ok(report.tiers.high.p95FrameMs >= 40)
assert.ok(!JSON.stringify(report).includes('private.example'), 'resource paths never enter the diagnostic report')
assert.ok(report.frameMetric.includes('not GPU'))
dispose()
assert.equal(window.fooThemeCoverflowPerformance, undefined)
console.log('PASS: per-tier frames, actual DOM counts, long tasks, memory and resource attribution are reported without resource URLs')
