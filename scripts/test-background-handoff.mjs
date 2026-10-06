import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const code = await require('esbuild').build({ entryPoints: ['src/utils/backgroundHandoff.ts'], bundle: true, platform: 'node', format: 'cjs', write: false })
const module = { exports: {} }
runInNewContext(code.outputFiles[0].text, { module, exports: module.exports })
const frames = new Map(), values = []; let id = 0, time = 0
const controller = module.exports.createBackgroundHandoff({ render: value => values.push(value), raf: fn => { frames.set(++id, fn); return id }, cancel: id => frames.delete(id) })
function tick(count = 1) { for (let n = 0; n < count; n++) { time += 16; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(time)) } }
controller.set(1, false); assert.equal(frames.size, 0)
controller.set(1, true); tick()
assert.ok(values[0] > 0 && values[0] < 1, 'late GPU readiness at layout progress 1 must fade, not snap')
tick(60); assert.equal(values.at(-1), 1)
controller.set(0, true); tick()
assert.ok(values.at(-1) > 0 && values.at(-1) < 1)
controller.set(1, true); tick()
assert.ok(values.at(-1) < 1, 'reversal continues from the current blend')
tick(60); assert.equal(values.at(-1), 1)
controller.set(0, true); tick(60); assert.equal(values.at(-1), 0)
assert.equal(frames.size, 0)
controller.set(1, true); controller.dispose(); assert.equal(frames.size, 0)
console.log('PASS: delayed readiness, native progress jumps, exit, reversal and disposal all preserve smooth background blending')
