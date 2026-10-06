import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const code = await require('esbuild').build({ entryPoints: ['src/utils/imagePicker.ts'], bundle: true, platform: 'node', format: 'cjs', write: false })
function fixture(active) {
  const elements = [], listeners = new Map()
  function element(tag) {
    const events = new Map()
    const value = { tag, children: [], style: {}, files: [], isConnected: true, addEventListener: (name, fn) => events.set(name, fn), emit: (name, event = {}) => events.get(name)?.(event), append: (...children) => value.children.push(...children), focus() {}, remove() { value.isConnected = false }, showPicker() { value.opened = true }, showModal() {}, close() {} }
    elements.push(value); return value
  }
  const module = { exports: {} }
  runInNewContext(code.outputFiles[0].text, { module, exports: module.exports, document: { createElement: element, body: { append() {} }, activeElement: null }, navigator: { userActivation: { isActive: active } }, window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }, setTimeout, clearTimeout })
  return { pick: module.exports.pickImageFile, elements, listeners }
}
for (const active of [true, false]) {
  const f = fixture(active), picked = f.pick('Select image')
  const input = f.elements.find(element => element.tag === 'input')
  if (!active) {
    const sheet = f.elements.find(element => element.tag === 'dialog')
    assert.ok(sheet)
    await sheet.children.find(element => element.textContent === '选择图片…').emit('click')
  }
  input.files = [{ name: 'portrait.JPG', size: 3, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }]
  await input.emit('change')
  const result = await picked
  assert.equal(result.path, 'portrait.JPG'); assert.equal(result.bytes.length, 3)
  assert.equal(input.isConnected, false); assert.equal(f.listeners.size, 0)
}
const cancelled = fixture(true), promise = cancelled.pick('Cancel')
cancelled.elements[0].emit('cancel'); assert.equal(await promise, null)
const invalid = fixture(true), failed = invalid.pick('Invalid')
invalid.elements[0].files = [{ name: 'note.txt', size: 2 }]
await invalid.elements[0].emit('change'); await assert.rejects(failed, /请选择/)
console.log('PASS: explicitly selected browser files provide bytes without native file.read; native-menu fallback, cancellation, invalid files and cleanup are handled')
