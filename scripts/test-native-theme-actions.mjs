import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { randomUUID } from 'node:crypto'

const require = createRequire(import.meta.url)
const bundled = await require('esbuild').build({ entryPoints: ['src/composables/useFoobar.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['foo-webview-sdk', 'vue'] })
const calls = []
const ownerId = '00000000-0000-0000-0000-000000000001'
const lists = [
  { index: 0, name: 'Music', trackCount: 3 },
  { index: 1, name: 'AirPlay', trackCount: 1 },
  { index: 2, name: `正在播放 A [foo-theme:${ownerId}]`, trackCount: 3 },
  { index: 3, name: 'Other', trackCount: 1 },
  { index: 4, name: 'Locked', trackCount: 1, isLocked: true },
  { index: 5, name: 'TouchRemote Selection', trackCount: 13, isLocked: true },
]
let active = lists[0], failMain = false
const track = { path: 'C:\\Users\\AB296\\Music\\Apple Music\\Machico\\Machibito Sagashi\\03 Million Smile.m4a', subsong: 0, title: 'Million Smile', artist: 'Machico', album: 'Machibito Sagashi', duration: 200 }
const sdk = {
  config: { get: async () => ({ value: { ownerId } }) },
  playlist: {
    setActive: async index => { calls.push(['active', index]); active = lists.find(item => item.index === index); return { success: true } },
    getActive: async () => active,
    getAll: async () => lists,
    reorderPlaylists: async order => { calls.push(['reorder', [...order]]); return { success: true } },
  },
  replaygain: { scan: async (paths, options) => { calls.push(['scan', [...paths], { ...options }]); return { success: true } } },
  menu: {
    getContextMenu: async options => {
      calls.push(['context', { ...options, handles: [...options.handles] }])
      return { success: true, items: [
        { type: 'command', label: 'Raw properties', commandId: 8 },
        { type: 'submenu', label: 'Utilities', children: [
          { type: 'command', label: 'Verify integrity', commandId: 41 },
          { type: 'submenu', label: 'Nested tools', children: [{ type: 'command', label: 'Native action', commandId: 42 }] },
          { type: 'command', label: 'Properties...', commandId: 11 },
        ] },
        { type: 'command', label: 'Properties...\tAlt+Enter', displayLabel: '属性…', commandId: 12 },
      ] }
    },
    getMainMenu: async () => ({ success: true, items: [{ type: 'submenu', label: 'Edit', children: [
      { type: 'command', label: 'Remove duplicates', path: 'Edit/Remove duplicates', guid: '{duplicates}' },
      { type: 'command', label: 'Remove dead items', path: 'Edit/Remove dead items', guid: '{invalid}' },
    ] }] }),
    runMainMenuCommand: async command => { calls.push(['main', command, active.index]); return { success: !failMain } },
    runContextCommandById: async (id, options) => { calls.push(['native', id, { ...options, handles: [...options.handles] }]); return { success: true } },
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
player.state.playlists = lists

assert.equal(await player.scanReplayGain([track], 'track'), true)
assert.deepEqual(calls.find(call => call[0] === 'scan'), ['scan', [track.path], { mode: 'track' }])
await player.scanReplayGain([{ ...track, path: `${track.path}|subsong:0` }], 'album')
assert.deepEqual(calls.filter(call => call[0] === 'scan').at(-1), ['scan', [track.path], { mode: 'album' }])
console.log('PASS: ReplayGain scans receive real .m4a file paths, never the unsupported |subsong:0 handle suffix')

assert.equal(await player.showNativeTrackProperties([track]), true)
assert.deepEqual(calls.filter(call => call[0] === 'native').at(-1), ['native', 12, { mode: 'handles', handles: [`${track.path}|subsong:0`] }])
const actions = await player.getPluginContextActions([track])
assert.equal(actions.tools[0].commandId, 41)
assert.equal(actions.tools[1].children[0].commandId, 42)
await player.runPluginContextAction({ commandId: 42, label: 'Native action' }, [track])
assert.equal(calls.filter(call => call[0] === 'native').at(-1)[1], 42)
console.log('PASS: original Properties is resolved instead of Raw properties; native Tools retains nested command IDs and exact selected handles')

assert.equal(await player.runNativePlaylistCleanup(3, 'duplicates'), true)
assert.deepEqual(calls.find(call => call[0] === 'main'), ['main', '{duplicates}', 3])
assert.deepEqual([...player.state.playlists.map(item => item.name)], ['Music', 'Other', 'Locked'])
assert.ok(lists.some(item => item.name === 'AirPlay'), 'hidden AirPlay is not deleted from foobar2000')
assert.equal(await player.runNativePlaylistCleanup(0, 'invalid'), true)
assert.deepEqual(calls.filter(call => call[0] === 'main').at(-1), ['main', '{invalid}', 0])
const count = calls.filter(call => call[0] === 'main').length
assert.equal(await player.runNativePlaylistCleanup(4, 'invalid'), false)
assert.equal(calls.filter(call => call[0] === 'main').length, count)
failMain = true
assert.equal(await player.runNativePlaylistCleanup(0, 'duplicates'), false)
console.log('PASS: native playlist cleanup runs on the target playlist, respects locks and reports failures; AirPlay and internal lists stay hidden')

await player.reorderPlaylists([3, 0, 4])
assert.deepEqual(calls.find(call => call[0] === 'reorder'), ['reorder', [3, 1, 2, 0, 4, 5]])
assert.ok(lists.some(item => item.name === 'TouchRemote Selection'), 'filtering never deletes or unlocks the remote selection list')
console.log('PASS: reordering visible playlists preserves AirPlay and hidden playback buffers in their native slots')
console.log('PASS: TouchRemote Selection is excluded from theme playlists while remaining intact in the native host and reorder slots')
