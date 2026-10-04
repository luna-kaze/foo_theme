import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { randomUUID } from 'node:crypto'

const require = createRequire(import.meta.url)
const { build, transform } = require('esbuild')
const bundled = await build({ entryPoints: ['src/composables/useFoobar.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['foo-webview-sdk', 'vue'] })
function fixture() {
  const calls = [], preferences = new Map()
  let maximized = true, fullscreen = false, resizable = true, topmost = false, failSize = false, failFullscreen = false, fullRelease = null
  let bounds = { x: 80, y: 60, width: 1100, height: 760 }, minimum = { width: 800, height: 600 }
  const sdk = {
    config: { get: async key => ({ value: preferences.get(key) }), set: async (key, value) => { preferences.set(key, structuredClone(value)); return { success: true } } },
    ui: {
      getState: async () => ({ isMaximized: maximized, isFullscreen: fullscreen }),
      getBounds: async () => ({ ...bounds }),
      getMinSize: async () => ({ ...minimum }),
      isResizable: async () => ({ resizable }),
      isAlwaysOnTop: async () => ({ enabled: topmost }),
      restore: async () => { calls.push(['restore']); maximized = false; return { success: true } },
      maximize: async () => { calls.push(['maximize']); maximized = true; return { success: true } },
      setBounds: async value => { calls.push(['bounds', { ...value }]); bounds = { ...value }; return { success: true } },
      setMinSize: async (width, height) => { calls.push(['minimum', width, height]); minimum = { width, height }; return { success: true } },
      setSize: async (width, height) => { calls.push(['size', width, height]); if (failSize) { failSize = false; return { success: false, error: 'Resize failed' } } bounds = { ...bounds, width, height }; return { success: true } },
      setResizable: async value => { resizable = value; return { success: true } },
      setAlwaysOnTop: async value => { topmost = value; return { success: true } },
      setFullscreen: async value => {
        calls.push(['fullscreen', value])
        if (failFullscreen) { failFullscreen = false; return { success: false, error: 'Fullscreen failed' } }
        if (fullRelease) await new Promise(resolve => { fullRelease = resolve })
        fullscreen = value
        return { success: true, fullscreen }
      },
      createPopup: () => assert.fail('mini mode must never create a second window'),
      minimize: () => assert.fail('mini mode must never minimize its own main window'),
    },
  }
  const module = { exports: {} }
  runInNewContext(bundled.outputFiles[0].text, {
    module, exports: module.exports,
    require: id => id === 'foo-webview-sdk' ? { ...sdk, __esModule: true, default: sdk } : require(id),
    crypto: { randomUUID }, URL, URLSearchParams, console, performance, AbortController,
    window: { location: { search: '', href: 'https://theme.test/' } },
    setTimeout: () => 1, clearTimeout() {},
  })
  const player = module.exports.useFoobar()
  player.state.connected = true
  return { player, calls, preferences, native: () => ({ bounds, minimum, maximized, resizable, topmost, fullscreen }), failSize: () => { failSize = true }, failFullscreen: () => { failFullscreen = true }, deferFullscreen: () => { fullRelease = true }, releaseFullscreen: () => { const release = fullRelease; fullRelease = null; release() } }
}

{
  const f = fixture(), p = f.player
  assert.equal(await p.toggleFullscreen(), false)
  assert.equal(f.calls.length, 0, 'ordinary mode cannot request fullscreen')
  p.toggleNowPlaying()
  assert.equal(p.state.nowPlayingOpen, true)
  assert.equal(f.calls.length, 0, 'left-side track card remains windowed')
  await p.toggleFullscreen()
  assert.equal(p.state.isFullscreen, true)
  p.toggleNowPlaying()
  for (let index = 0; index < 8; index++) await Promise.resolve()
  assert.equal(p.state.nowPlayingOpen, true, 'windowed entry from fullscreen keeps immersion open')
  assert.equal(p.state.isFullscreen, false)
  await p.toggleFullscreen()
  await p.toggleFullscreen()
  assert.equal(p.state.nowPlayingOpen, true, 'F11 exit retains windowed immersion')
  assert.equal(p.state.isFullscreen, false)
  await p.toggleFullscreenNowPlaying()
  assert.equal(p.state.isFullscreen, true)
  await p.toggleFullscreenNowPlaying()
  assert.equal(p.state.isFullscreen, false)
  assert.equal(p.state.nowPlayingOpen, false, 'right fullscreen button exits into the normal window')
  console.log('PASS: ordinary fullscreen is blocked; left entry is windowed, right entry is fullscreen and fullscreen exit restores the normal window')
}

{
  const f = fixture(), p = f.player
  f.deferFullscreen()
  const entering = p.toggleFullscreenNowPlaying()
  await Promise.resolve()
  const closing = p.toggleFullscreenNowPlaying()
  f.releaseFullscreen()
  await Promise.all([entering, closing])
  assert.deepEqual(f.calls.filter(call => call[0] === 'fullscreen'), [['fullscreen', true], ['fullscreen', false]])
  assert.equal(p.state.isFullscreen, false)
  f.failFullscreen()
  await p.toggleFullscreenNowPlaying()
  assert.equal(p.state.isFullscreen, false)
  console.log('PASS: closing during a pending native fullscreen entry queues the matching exit; host failure terminates without a retry loop')
}

{
  const f = fixture(), p = f.player, before = structuredClone(f.native())
  await Promise.all([p.openMiniPlayer(), p.openMiniPlayer()])
  assert.equal(p.miniPlayerMode.value, true)
  assert.deepEqual(f.native().bounds, { ...before.bounds, width: 430, height: 156 })
  assert.equal(f.native().resizable, false)
  assert.equal(f.native().topmost, true)
  assert.equal(f.calls.filter(call => call[0] === 'size').length, 1, 'duplicate clicks share one window transition')
  assert.ok(f.preferences.get('foo-theme.mini-window.v1').bounds)
  assert.equal(await p.toggleFullscreen(), false, 'mini mode cannot become fullscreen')
  await p.restoreMainPlayer()
  assert.equal(p.miniPlayerMode.value, false)
  assert.deepEqual(f.native(), before)
  assert.equal(f.preferences.get('foo-theme.mini-window.v1'), null)
  console.log('PASS: mini mode resizes the existing main window and restores exact bounds, maximization, minimum size, topmost and resizability')
}

{
  const f = fixture(), before = structuredClone(f.native())
  f.failSize()
  await f.player.openMiniPlayer()
  assert.equal(f.player.miniPlayerMode.value, false)
  assert.deepEqual(f.native(), before)
  console.log('PASS: failed mini resize rolls back the original main window rather than leaving it stuck at a reduced size')
}

{
  const app = readFileSync('src/App.vue', 'utf8')
  const keySource = app.match(/function onKeydown\(event: KeyboardEvent\) \{[\s\S]*?\n\}/)[0]
  const code = await transform(`${keySource}\nmodule.exports = onKeydown`, { loader: 'ts', format: 'cjs' })
  const state = { nowPlayingOpen: false }, miniMode = { value: false }
  let toggles = 0
  const module = { exports: {} }
  runInNewContext(code.code, { module, state, miniMode, player: { toggleFullscreen: async () => { toggles++ } } })
  function press(repeat = false) {
    let prevented = false, stopped = false
    module.exports({ key: 'F11', code: 'F11', repeat, target: null, preventDefault() { prevented = true }, stopImmediatePropagation() { stopped = true } })
    assert.ok(prevented && stopped)
  }
  press(); assert.equal(toggles, 0)
  state.nowPlayingOpen = true
  press(); assert.equal(toggles, 1)
  press(true); assert.equal(toggles, 1)
  miniMode.value = true
  press(); assert.equal(toggles, 1)
  console.log('PASS: actual F11 handler suppresses browser defaults in every mode and only dispatches once from non-mini immersion')
}
