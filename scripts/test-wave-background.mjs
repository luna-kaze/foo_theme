import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const compiled = await require('esbuild').build({ entryPoints: ['src/utils/waveBackground.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue', 'foo-webview-sdk'] })
function fixture(available = true) {
  let now = 1000, id = 0, uploads = 0, draws = 0, captures = 0, deleted = 0
  const frames = new Map(), events = new Map(), pageEvents = new Map()
  const uniform = new Map(), media = { matches: false, addEventListener() {}, removeEventListener() {} }
  let textureId = 0, activeUnit = 8, captureError = 0
  const bound = new Map(), captureTargets = [], captureFormats = []
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TEXTURE0: 8, TEXTURE1: 9, TEXTURE_2D: 10, TEXTURE_MIN_FILTER: 11, TEXTURE_MAG_FILTER: 12, LINEAR: 13, TEXTURE_WRAP_S: 14, TEXTURE_WRAP_T: 15, CLAMP_TO_EDGE: 16, RGBA: 17, UNSIGNED_BYTE: 18, UNPACK_FLIP_Y_WEBGL: 19, TRIANGLE_STRIP: 20, RGB: 21, NO_ERROR: 0,
    createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true, useProgram() {},
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {}, getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {},
    getUniformLocation: (_program, name) => name, uniform1i() {}, uniform1f: (key, value) => uniform.set(key, value), uniform2f() {}, uniform4f() {}, uniform4fv() {},
    createTexture: () => ({ id: ++textureId }), bindTexture: (_type, texture) => bound.set(activeUnit, texture), activeTexture: unit => { activeUnit = unit }, texParameteri() {}, pixelStorei() {}, texImage2D: () => { uploads++ },
    copyTexImage2D: (_type, _level, format) => { captures++; captureTargets.push(bound.get(activeUnit).id); captureFormats.push(format) }, getError: () => { const error = captureError; captureError = 0; return error }, viewport() {}, drawArrays: () => { draws++ },
    deleteTexture: () => { deleted++ }, deleteShader() {}, deleteProgram() {}, deleteBuffer() {},
  }
  let rect = { width: 3840, height: 2160 }
  const canvas = { width: 0, height: 0, getContext: () => available ? gl : null, getBoundingClientRect: () => rect, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) }
  const document = { hidden: false, addEventListener: (name, fn) => pageEvents.set(name, fn), removeEventListener: name => pageEvents.delete(name) }
  const module = { exports: {} }
  runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports,
    require: name => name === 'foo-webview-sdk' ? { __esModule: true, default: {} } : require(name),
    window: { matchMedia: () => media, devicePixelRatio: 2, innerWidth: 3840, innerHeight: 2160 }, document,
    performance: { now: () => now }, requestAnimationFrame: fn => { frames.set(++id, fn); return id }, cancelAnimationFrame: id => frames.delete(id),
  })
  const status = []
  const renderer = module.exports.createWaveBackgroundRenderer(canvas, value => status.push(value))
  return { renderer, api: module.exports, frames, events, pageEvents, document, uniform, status, canvas, captureTargets, captureFormats, resize: (width, height) => { rect = { width, height }; renderer.setActive(true) }, failCapture: () => { captureError = 1282 }, numbers: () => ({ uploads, draws, captures, deleted }), now: value => { now = value } }
}
const f = fixture()
assert.equal(f.canvas.width, 960); assert.equal(f.canvas.height, 540)
f.renderer.setActive(true)
f.renderer.setField({ width: 328, height: 328 })
assert.equal(f.status.at(-1), true)
assert.equal(f.numbers().uploads, 3)
assert.equal(f.frames.size, 1)
f.now(1100); f.renderer.setField({ width: 328, height: 328 })
f.now(1450); f.renderer.setField({ width: 328, height: 328 })
assert.equal(f.numbers().captures, 1, 'interrupted fade freezes the current GPU composite instead of snapping to an old cover')
assert.deepEqual(f.captureTargets, [3], 'captured viewport pixels have their own texture and can never replace either rotating disc')
assert.deepEqual(f.captureFormats, [21], 'opaque default framebuffer must be copied as RGB, not incompatible RGBA')
assert.ok(f.api.waveFragmentShader.includes('base.a*uOpacity.x'))
assert.ok(f.api.waveFragmentShader.includes('disc(image,p,uCircles[0],1.0)'))
assert.ok(f.api.waveFragmentShader.includes('smoothstep(.70,1.0,radius)'))
const uploads = f.numbers().uploads
f.renderer.setSettings({ brightness: 1, saturation: 1, contrast: 1, hue: 0, opacity: 1, baseOpacity: 1, primaryIntensity: .5, secondaryIntensity: .7, glowScale: 1.2, blur: 0, speed: 2, motion: .8, vignette: 1, animated: true })
assert.equal(f.numbers().uploads, uploads, 'live settings do not upload or regenerate artwork')
const beforeResize = f.numbers().captures
f.resize(1280, 720)
assert.equal(f.numbers().captures, beforeResize + 1, 'native full/window resizing crossfades from the current composition instead of abruptly changing disc geometry')
f.document.hidden = true; f.pageEvents.get('visibilitychange')()
assert.equal(f.frames.size, 0)
f.document.hidden = false; f.pageEvents.get('visibilitychange')()
assert.equal(f.frames.size, 1)
f.renderer.setActive(false); assert.equal(f.frames.size, 0)
f.events.get('webglcontextlost')({ preventDefault() {} })
assert.equal(f.status.at(-1), false)
f.events.get('webglcontextrestored')()
assert.equal(f.status.at(-1), true)
f.renderer.dispose()
assert.equal(f.frames.size, 0); assert.equal(f.events.size, 0); assert.equal(f.pageEvents.size, 0)
assert.ok(f.numbers().deleted >= 6)
console.log('PASS: bounded WebGL resolution, dual-texture fade, interrupted-fade GPU capture and parameter edits without new texture generation')
console.log('PASS: hidden/inactive rendering pauses; context loss falls back, restore reuploads and disposal releases all resources/listeners')
const unavailable = fixture(false)
assert.equal(unavailable.status.at(-1), false)
unavailable.renderer.dispose()
console.log('PASS: unavailable WebGL exposes the independent fallback without a running frame loop')
console.log('PASS: alpha-aware full-viewport base, feathered accent boundaries and an isolated snapshot texture prevent circular/square cut edges')
const failed = fixture()
failed.renderer.setActive(true)
failed.renderer.setField({ width: 328, height: 328 })
failed.now(1100); failed.renderer.setField({ width: 328, height: 328 })
failed.failCapture(); failed.now(1200)
assert.equal(failed.renderer.setField({ width: 328, height: 328 }), false)
assert.equal(failed.status.at(-1), false)
assert.equal(failed.frames.size, 0, 'a failed snapshot cannot leave an invalid frozen frame on screen')
failed.renderer.dispose()
console.log('PASS: INVALID_OPERATION during capture switches to the safe fallback instead of displaying an uncaptured disc as a full-screen snapshot')
