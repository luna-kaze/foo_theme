import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const compiled = await build({ entryPoints: ['src/utils/coverflowRail.ts'], bundle: true, platform: 'node', format: 'cjs', write: false })
const module = { exports: {} }
runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require })
function fixture(count = 50000, start = 25000) {
  let time = 0, sequence = 0, state
  const tasks = new Map(), frames = []
  const rail = module.exports.createCoverflowRail({ now: () => time, requestFrame: fn => { const id = ++sequence; tasks.set(id, fn); return id }, cancelFrame: id => tasks.delete(id), update: frame => { state = frame; frames.push(frame) } })
  rail.reset(count, start)
  return { rail, frames, state: () => state, tasks, tick(ms) { for (let rest = ms; rest > 0; rest -= 16) { time += Math.min(rest, 16); const pending = [...tasks]; tasks.clear(); pending.forEach(([, fn]) => fn(time)) } } }
}
{
  const f = fixture()
  for (let index = 0; index < 3; index++) { f.rail.wheel(100, 0, 800); f.tick(300) }
  f.tick(1200)
  assert.ok(f.frames.every(frame => !frame.distant), 'ordinary isolated wheel ticks retain cover rendering')
  assert.equal(f.state().position, 25003)
  assert.equal(f.state().zoom, 0)
  assert.equal(f.state().settled, true)
  console.log('PASS: ordinary wheel speed retains the near cover rail and settles at the selected item')
}
{
  const f = fixture()
  for (let index = 0; index < 8; index++) { f.rail.wheel(100, 0, 800); f.tick(16) }
  assert.equal(f.state().distant, true)
  assert.ok(f.state().zoom > .6)
  const position = f.state().position
  f.rail.wheel(-200, 0, 800)
  assert.equal(f.state().position, position, 'direction reversal cannot reset the current rail pose')
  f.tick(16)
  assert.ok(Number.isFinite(f.state().position))
  f.tick(1600)
  assert.equal(f.state().position, 25006)
  assert.equal(f.state().zoom, 0)
  assert.equal(f.state().distant, false)
  assert.equal(f.state().settled, true)
  console.log('PASS: rapid input zooms out; reversal stays continuous; stopping restores the same final near position')
}
{
  const pixels = fixture(), lines = fixture(), pages = fixture()
  pixels.rail.wheel(160, 0, 800); lines.rail.wheel(10, 1, 800); pages.rail.wheel(.2, 2, 800)
  pixels.tick(1600); lines.tick(1600); pages.tick(1600)
  assert.equal(pixels.state().position, lines.state().position)
  assert.equal(pixels.state().position, pages.state().position)
  const tiny = fixture()
  for (let index = 0; index < 20; index++) tiny.rail.wheel(3, 0, 800)
  tiny.tick(1600)
  assert.equal(tiny.state().position, 25001, 'small trackpad deltas accumulate instead of becoming twenty item jumps')
  console.log('PASS: pixel/line/page delta normalization and fractional trackpad accumulation')
}
{
  const f = fixture(100000, 50)
  f.rail.wheel(1e9, 0, 800); f.tick(16)
  assert.equal(f.state().target, 99999)
  assert.equal(f.state().distant, true)
  assert.ok(f.state().position < 99999)
  f.rail.wheel(-1e9, 0, 800); f.tick(2000)
  assert.equal(f.state().target, 0)
  f.rail.resize(1); f.tick(1600)
  assert.equal(f.state().position, 0)
  assert.equal(f.state().active, false)
  console.log('PASS: large-list navigation is bounded and resized/empty edges converge safely')
}
{
  const f = fixture()
  for (let index = 0; index < 5000; index++) f.rail.wheel(1, 0, 800)
  assert.equal(f.tasks.size, 1, 'a high event count uses a single animation frame chain')
  f.tick(80)
  assert.equal(f.state().distant, true)
  f.rail.dispose()
  assert.equal(f.tasks.size, 0)
  console.log('PASS: input bursts keep one frame loop, bounded velocity samples and complete disposal')
}
