import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const compiled = await build({ entryPoints: ['src/utils/autoHideScrollbars.ts'], bundle: true, platform: 'node', format: 'cjs', write: false })
let time = 0, sequence = 0
const tasks = new Map(), listeners = new Map(), windowListeners = new Map()
class Element {
  isConnected = true
  clientWidth = 100
  clientHeight = 100
  scrollWidth = 100
  scrollHeight = 300
  style = { overflowX: 'hidden', overflowY: 'auto', direction: 'ltr' }
  rect = { left: 0, top: 0, right: 100, bottom: 100 }
  classes = new Set()
  classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value) }
  getBoundingClientRect() { return this.rect }
}
const view = {
  HTMLElement: Element,
  getComputedStyle: element => element.style,
  setTimeout: (fn, delay) => { const id = ++sequence; tasks.set(id, { fn, at: time + delay }); return id },
  clearTimeout: id => tasks.delete(id),
  requestAnimationFrame: fn => view.setTimeout(fn, 16),
  cancelAnimationFrame: id => tasks.delete(id),
  addEventListener: (type, fn) => windowListeners.set(type, fn),
  removeEventListener: type => windowListeners.delete(type),
}
const doc = { defaultView: view, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) }
const module = { exports: {} }
runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require })
const dispose = module.exports.installAutoHideScrollbars(doc)
const emit = (type, target, extra = {}) => listeners.get(type)?.({ target, clientX: 50, clientY: 50, pointerType: 'mouse', composedPath: () => [target, doc], relatedTarget: doc, ...extra })
function tick(ms) {
  const end = time + ms
  for (;;) {
    const next = [...tasks].sort((a, b) => a[1].at - b[1].at).find(([, task]) => task.at <= end)
    if (!next) break
    tasks.delete(next[0]); time = next[1].at; next[1].fn()
  }
  time = end
}
const visible = element => element.classes.has('scrollbar-active')
const sidebar = new Element()
assert.equal(visible(sidebar), false)
emit('scroll', sidebar); assert.equal(visible(sidebar), true)
tick(450); emit('scroll', sidebar); tick(850)
assert.equal(visible(sidebar), true)
tick(51); assert.equal(visible(sidebar), false)
console.log('PASS: scrollbar hidden by default, revealed during scrolling, then hidden after inactivity')

emit('pointermove', sidebar); tick(16)
assert.equal(visible(sidebar), false, 'hovering content must not reveal the scrollbar')
emit('pointermove', sidebar, { clientX: 94 }); tick(16); tick(2000)
assert.equal(visible(sidebar), true, 'edge proximity remains visible while the pointer stays there')
emit('pointermove', sidebar); tick(16); tick(901)
assert.equal(visible(sidebar), false)
console.log('PASS: only edge proximity reveals the scrollbar; content hover does not')

const child = new Element()
child.rect.right = 80
emit('pointermove', child, { clientX: 76, composedPath: () => [child, sidebar, doc] }); tick(16)
assert.equal(visible(child), true)
assert.equal(visible(sidebar), false)
console.log('PASS: nested and dynamically encountered scrollers are handled independently')

const horizontal = new Element()
horizontal.scrollWidth = 300; horizontal.scrollHeight = 100
horizontal.style = { overflowX: 'auto', overflowY: 'hidden', direction: 'ltr' }
emit('pointerdown', horizontal, { clientY: 96 })
emit('pointermove', horizontal); tick(16); tick(2000)
assert.equal(visible(horizontal), true, 'dragging keeps the scrollbar visible after leaving its edge')
emit('pointercancel', horizontal); tick(901)
assert.equal(visible(horizontal), false, 'cancel releases the drag pin instead of leaving the scrollbar permanently visible')
console.log('PASS: horizontal edge and drag/cancel lifecycle')

const rtl = new Element()
rtl.style.direction = 'rtl'
emit('pointermove', rtl, { clientX: 4 }); tick(16)
assert.equal(visible(rtl), true)
emit('pointerout', rtl, { relatedTarget: null }); tick(901)
assert.equal(visible(rtl), false)
emit('pointermove', rtl, { pointerType: 'touch', clientX: 4 }); tick(16)
assert.equal(visible(rtl), false)
emit('scroll', rtl); assert.equal(visible(rtl), true)
console.log('PASS: RTL edge and touch scrolling without permanent touch-hover state')

const clipped = new Element()
clipped.style.overflowY = 'hidden'
emit('scroll', clipped)
emit('pointermove', clipped, { clientX: 96 }); tick(16)
assert.equal(visible(clipped), false)
console.log('PASS: clipped non-scrollable containers never gain a visible scrollbar')

emit('wheel', sidebar, { deltaY: 20, deltaX: 0 })
assert.equal(visible(sidebar), true, 'wheel intent reveals the scrollbar even at a scroll boundary')
tick(901)
emit('wheel', sidebar, { deltaY: 20, deltaX: 0, ctrlKey: true })
assert.equal(visible(sidebar), false, 'zoom gestures do not reveal a scrollbar')
console.log('PASS: wheel-at-boundary feedback without treating zoom as scrolling')

emit('scroll', sidebar)
dispose()
assert.equal(visible(sidebar), false)
assert.equal(visible(rtl), false)
assert.equal(tasks.size, 0)
assert.equal(listeners.size, 0)
assert.equal(windowListeners.size, 0)
console.log('PASS: disposal removes visibility, timers and all global listeners')
