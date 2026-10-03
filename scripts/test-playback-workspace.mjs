import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const compiled = await build({ entryPoints: ['src/composables/playbackWorkspace.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['foo-webview-sdk', 'vue'] })
const source = Array.from({ length: 6 }, (_, index) => ({ path: `C:\\Music\\${index}.flac`, subsong: 0, title: `Track ${index}`, artist: 'Artist', album: 'Album', albumArtist: 'Artist', duration: 180 }))

function fixture(random = Math.random) {
  const lists = [{ name: 'Source', tracks: [...source] }]
  const queue = [], calls = [], errors = []
  const preferences = new Map()
  let playing = -1, current = -1, stopAfter = false, failAdd = false, consumeOnRemove = false, failRemove = false, failQueueAdd = false
  let playback = { state: 'paused', position: 43 }
  const fb = {
    config: { get: async key => ({ value: preferences.get(key) }), set: async (key, value) => { preferences.set(key, structuredClone(value)); return { success: true } } },
    player: {
      getState: async () => ({ state: playback.state }),
      getPlayingPlaylist: async () => ({ playlist: playing }),
      getCurrentTrackIndex: async () => ({ index: current }),
      getStopAfterCurrent: async () => ({ enabled: stopAfter }),
      setStopAfterCurrent: async enabled => { stopAfter = enabled; calls.push(['stopAfter', enabled]); return { success: true } },
      setOrder: async order => { calls.push(['order', order]); return { success: true } },
      next: async () => { calls.push(['next']); advance() },
    },
    playlist: {
      getActive: async () => ({ index: 0, name: 'Source', trackCount: lists[0].tracks.length }),
      getCount: async index => ({ count: lists[index].tracks.length }),
      getTracks: async (index, offset = 0, count = 1000) => lists[index].tracks.slice(offset, offset + count).map(track => ({ ...track })),
      getAll: async () => lists.map((list, index) => ({ name: list.name, index, trackCount: list.tracks.length })),
      create: async name => { lists.push({ name, tracks: [] }); return { index: lists.length - 1 } },
      clear: async index => {
        assert.notEqual(index, playing, 'never clear the decoder buffer')
        assert.ok(!queue.some(item => item.playlist === index), 'never clear a queued buffer')
        calls.push(['clear', index]); lists[index].tracks = []; return { success: true }
      },
      add: async (index, paths) => {
        if (failAdd) { failAdd = false; return { success: false, addedCount: 0 } }
        lists[index].tracks.push(...paths.map(path => source.find(track => track.path === path.replace(/\|subsong:\d+$/, ''))))
        return { success: true, addedCount: paths.length }
      },
      playTrack: async (index, position) => { calls.push(['play', index, position]); playing = index; current = position; playback = { state: 'playing', position: 0 }; return { success: true } },
    },
    queue: {
      get: async () => ({ items: queue.map(item => ({ ...item })) }),
      add: async ({ playlist, track }) => { if (failQueueAdd) { failQueueAdd = false; return { success: false } } queue.push({ playlist, playlistItem: track }); return { success: true } },
      remove: async index => {
        if (failRemove) { failRemove = false; return { success: false } }
        if (consumeOnRemove) { consumeOnRemove = false; advance(); return { success: true } }
        queue.splice(index, 1); return { success: true }
      },
    },
  }
  function advance() {
    const next = queue.shift()
    if (next) { playing = next.playlist; current = next.playlistItem }
    else if (!stopAfter) current += 1
    else { playing = -1; current = -1 }
  }
  const module = { exports: {} }
  const math = Object.create(Math)
  math.random = random
  runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'foo-webview-sdk' ? { ...fb, __esModule: true, default: fb } : require(id), crypto: { randomUUID }, console, Math: math })
  const create = () => module.exports.createPlaybackWorkspace({ connected: () => true, owner: async () => 'test-owner', tracks: async index => lists[index].tracks.map(track => ({ ...track })), publish() {}, notify: message => errors.push(message) })
  const workspace = create()
  return {
    workspace, create, lists, queue, calls, errors, advance, sdk: fb,
    saved: () => preferences.get('foo-theme.playback-workspace.v1'),
    pause: () => { playback = { state: 'paused', position: 43 } },
    live: () => ({ playing, current, playback, stopAfter }), fail: () => { failAdd = true },
    race: () => { consumeOnRemove = true }, failRemoval: () => { failRemove = true }, failRegistration: () => { failQueueAdd = true },
    stop: () => { playing = -1; current = -1; playback = { state: 'stopped', position: 0 } },
    protect: () => { const reference = { playlist: queue[0].playlist, playlistItem: 0 }; queue.push(reference); return reference },
    release: reference => { queue.splice(queue.indexOf(reference), 1) },
    order: () => workspace.projection(current), editor: () => workspace.projection(current, true),
  }
}

{
  const f = fixture(), w = f.workspace
  assert.equal(await w.start([...source, source[0]], 2, 'Source'), true, f.errors.join('; '))
  const initial = f.order()
  assert.equal(new Set(initial.order.map(track => track.playbackId)).size, 7, 'duplicate files have distinct occurrence IDs')
  assert.equal(initial.order[initial.index].title, source[2].title)
  f.pause()
  const decoder = f.live().playing
  const original = [...f.lists[0].tracks]
  f.lists[0].tracks.reverse()
  assert.equal(await w.add([source[5]]), true)
  assert.equal(await w.add([source[0]], true), true)
  assert.equal(w.status.staged, false)
  assert.equal(f.order().order[f.order().index + 1].title, source[0].title, 'consecutive edits replace the standby plan immediately')
  assert.equal(f.queue.length, 1)
  assert.equal(f.live().playing, decoder)
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1, 'planning never restarts playback')
  assert.deepEqual(f.lists[0].tracks, original.reverse(), 'planning does not touch the source')
  assert.equal(await w.next(), true)
  assert.equal(f.order().order[f.order().index].title, source[0].title, 'manual Next applies the latest next-insert')
  assert.equal(w.status.staged, false)
  assert.equal(f.lists.length, 3, 'only two fixed buffers are created')
  console.log('PASS: source isolation, duplicate identity, paused decoder, safe re-registration and latest manual Next')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 1, 'Source')
  f.pause()
  await w.add([source[5]])
  const blocker = f.protect()
  await w.add([source[0]], true)
  const revision = w.status.revision
  f.release(blocker)
  f.advance()
  assert.equal(await w.sync(), true)
  assert.equal(w.status.staged, false)
  assert.equal(w.status.pending, true)
  assert.equal(w.status.revision, revision + 1)
  assert.equal(f.order().order[f.order().index + 1].title, source[0].title)
  assert.equal(f.queue.length, 1)
  f.advance(); await w.sync()
  const copies = f.calls.filter(call => call[0] === 'clear').length
  f.advance(); await w.sync()
  assert.equal(f.calls.filter(call => call[0] === 'clear').length, copies, 'unchanged tracks do not trigger buffer copies')
  console.log('PASS: natural handover, deferred commit and copy-free unchanged advancement')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 2, 'Source')
  f.pause()
  await w.shuffle()
  assert.equal(w.status.mode, 0)
  assert.equal(f.calls.filter(call => call[0] === 'order').at(-1)[1], 0, 'shuffle retains the current default-order playback policy')
  const shuffled = f.order().order.map(track => track.playbackId)
  await w.setMode(2)
  assert.deepEqual([...f.order().order.map(track => track.playbackId)], [...shuffled], 'repeat-one changes policy without rearranging the plan')
  assert.equal(f.queue.length, 0, 'repeat-one cancels the theme next bridge')
  assert.equal(w.status.mode, 2)
  await w.add([source[0]], true)
  assert.equal(w.status.staged, false, 'unreferenced repeat-one buffer can accept new edits')
  await w.setMode(0)
  assert.equal(f.queue.length, 1)
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  console.log('PASS: shuffle action is independent of playback policy; repeat-one and next registration remain editable')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 2, 'Source')
  f.pause()
  assert.equal(await w.clear(), true)
  assert.equal(f.queue.length, 0)
  assert.equal(f.live().stopAfter, true, 'cleared plan must not continue the old buffer')
  assert.equal(f.order().order.length, 3)
  await w.add([source[5]])
  assert.equal(f.live().stopAfter, false)
  assert.equal(f.queue.length, 1)
  await w.next()
  assert.equal(f.order().order[f.order().index].title, source[5].title)
  console.log('PASS: plan end stops after current without stopping now; append resumes the plan')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 1, 'Source')
  f.pause(); f.fail()
  const before = f.order().order.map(track => track.playbackId)
  assert.equal(await w.add([source[5]]), false)
  assert.deepEqual([...f.order().order.map(track => track.playbackId)], [...before])
  assert.equal(f.queue.length, 0)
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  assert.equal(await w.add([source[0]], true), true)
  console.log('PASS: incomplete writes leave decoder and visible order unchanged; subsequent edits recover')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 1, 'Source')
  await w.add([source[5]])
  const blocker = f.protect()
  await w.add([source[0]], true)
  const restored = f.create()
  await restored.restore()
  assert.equal(restored.status.ready, true)
  assert.equal(restored.status.staged, true)
  assert.equal(f.queue.length, 2, 'restore does not duplicate registration')
  const editor = restored.projection(f.live().current, true)
  assert.equal(editor.order[editor.index + 1].title, source[0].title)
  f.release(blocker)
  f.advance(); await restored.sync()
  const snapshot = restored.projection(f.live().current)
  assert.equal(snapshot.order[snapshot.index + 1].title, source[0].title)
  assert.equal(snapshot.order[snapshot.index + 1].playbackQueued, true)
  console.log('PASS: saved committed and deferred plans, stable IDs and queued markers survive restoration')
}

{
  const f = fixture(), w = f.workspace
  assert.equal(await w.seed([source[0]]), true)
  assert.equal(await w.add([source[1]]), true)
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 0)
  assert.equal(f.queue.length, 1)
  assert.equal(f.order().order.length, 2)
  f.advance(); await w.sync()
  assert.equal(f.order().order[f.order().index].title, source[0].title)
  console.log('PASS: stopped queue can be prepared and extended without starting playback')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 1, 'Source')
  f.queue.push({ playlist: 0, playlistItem: 4 })
  await w.add([source[5]])
  assert.equal(f.queue.length, 2)
  assert.equal(f.queue[0].playlist, 0, 'existing native entries retain priority')
  await w.add([source[0]], true)
  await w.next()
  assert.equal(f.live().playing, 0)
  assert.equal(f.order().external, true, 'external decoder is not treated as an item in the workspace')
  assert.equal(f.queue.length, 1, 'manual merge leaves native entries intact')
  f.advance(); await w.sync()
  assert.equal(f.order().order[f.order().index].title, source[0].title)
  console.log('PASS: external native queue priority and later plan handover')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 1, 'Source')
  const removedId = f.order().order[3].playbackId
  const movedId = f.order().order[4].playbackId
  await w.remove([removedId])
  await w.moveNext(movedId)
  await w.next()
  const snapshot = f.order()
  assert.equal(snapshot.order[snapshot.index].playbackId, movedId)
  assert.ok(!snapshot.order.some(track => track.playbackId === removedId))
  assert.equal(new Set(snapshot.order.map(track => track.playbackId)).size, snapshot.order.length, 'move must not duplicate occurrence IDs')
  console.log('PASS: remove and move-next edit a single occurrence without duplication')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, source.length - 1, 'Source', 2)
  await w.add([source[0]])
  assert.equal(f.queue.length, 0)
  assert.equal(await w.next(), true)
  assert.equal(f.order().order[f.order().index].title, source[0].title)
  assert.equal(await w.setMode(1), true)
  assert.equal(f.queue.length, 0, 'unchanged loop switch does not copy or schedule unnecessarily')
  console.log('PASS: manual Next escapes repeat-one and unchanged list-loop switches avoid copies')
}

{
  const f = fixture(), w = f.workspace
  assert.equal(await w.setMode(1), true)
  assert.equal(await w.start(source, 3, 'Source', 1, true), true)
  assert.equal(w.status.mode, 1)
  assert.equal(f.order().order[f.order().index].title, source[3].title)
  assert.equal(f.order().index, 0)
  console.log('PASS: random collection start retains the independent list-loop playback policy')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 1, 'Source')
  await w.add([source[5]])
  const before = f.order().order.map(track => track.playbackId)
  f.pause(); f.fail()
  assert.equal(await w.start(source, 4, 'Another selection'), false)
  assert.deepEqual([...f.order().order.map(track => track.playbackId)], [...before])
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  assert.equal(f.queue.length, 1)
  f.advance(); await w.sync()
  assert.equal(f.order().order[f.order().index].title, source[2].title)
  console.log('PASS: failed source replacement restores the previously registered complete plan')
}

for (const mode of [0, 1]) {
  const f = fixture(), w = f.workspace
  await w.start(source, 3, 'Source', 0, true)
  f.pause()
  const anchorId = f.order().order[0].playbackId
  f.lists[0].tracks.reverse()
  assert.equal(await w.restoreOrder(), true)
  assert.equal(await w.setMode(mode), true)
  const snapshot = f.order()
  assert.deepEqual([...snapshot.order.map(track => track.path)], [source[3], ...source.filter(track => track !== source[3])].map(track => track.path), 'restore only sorts the unplayed remainder and keeps the current occurrence in place')
  assert.equal(snapshot.index, 0)
  assert.equal(snapshot.order[snapshot.index].playbackId, anchorId)
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  await w.next()
  assert.equal(f.order().order[f.order().index].title, source[0].title)
  console.log(`PASS: pending-only restoration for mode ${mode}, preserving decoder, current position and history`)
}

for (const manual of [false, true]) {
  const f = fixture(), w = f.workspace
  await w.start(source, 3, 'Source', 0, true)
  await w.add([source[5]])
  const blocker = f.protect()
  await w.restoreOrder()
  assert.equal(w.status.staged, true)
  const before = f.order()
  const history = before.order.slice(0, before.index + (manual ? 1 : 2))
  const ids = new Set(history.map(track => track.playbackId))
  const expected = [...history, ...f.editor().base.filter(track => !ids.has(track.playbackId))]
  f.release(blocker)
  if (manual) await w.next()
  else { f.advance(); await w.sync() }
  const snapshot = f.order()
  assert.deepEqual([...snapshot.order.map(track => track.playbackId)], expected.map(track => track.playbackId), 'deferred restore preserves the actually consumed history and sorts only surviving future items')
  if (manual) assert.equal(snapshot.order[snapshot.index].title, source[0].title)
  console.log(`PASS: pending-only restoration survives ${manual ? 'manual' : 'natural'} deferred handover`)
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 3, 'Source', 0, true)
  const removed = f.order().order.find(track => track.title === source[1].title)
  await w.remove([removed.playbackId])
  await w.restoreOrder()
  await w.setMode(1)
  await w.next()
  assert.ok(!f.order().order.some(track => track.playbackId === removed.playbackId), 'restore retains explicit removals')
  assert.deepEqual([...f.order().order.map(track => track.path)], [source[3], ...source.filter(track => track !== source[3] && track !== source[1])].map(track => track.path))
  console.log('PASS: pending-only restoration retains deleted plan occurrences')
}

for (const mode of [0, 1, 2]) {
  const f = fixture(), w = f.workspace
  await w.start(source, 1, 'Source', mode)
  f.pause()
  await w.add([source[5]])
  await w.add([source[0]], true)
  let snapshot = f.editor()
  const addedId = snapshot.order[snapshot.index + 1].playbackId
  assert.equal(await w.remove([addedId]), true)
  assert.ok(!f.editor().order.some(track => track.playbackId === addedId))
  await w.add([source[4]], true)
  const nextId = f.editor().order[f.editor().index + 1].playbackId
  const movedId = f.editor().order.find(track => track.title === source[3].title).playbackId
  await w.moveNext(movedId)
  assert.equal(f.editor().order[f.editor().index + 1].playbackId, movedId)
  await w.remove([movedId])
  assert.equal(f.editor().order[f.editor().index + 1].playbackId, nextId)
  assert.equal(w.status.staged, false)
  assert.equal(w.status.mode, mode)
  assert.equal(f.queue.length, mode === 2 ? 0 : 1)
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  await w.next()
  assert.equal(f.order().order[f.order().index].playbackId, nextId)
  console.log(`PASS: uninterrupted add-next / delete / append / move / delete sequence in playback policy ${mode}`)
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 1, 'Source')
  await w.add([source[5]])
  const blocker = f.protect()
  const committed = f.order().order.map(track => track.playbackId)
  const clears = f.calls.filter(call => call[0] === 'clear').length
  await w.add([source[0]], true)
  const id = f.editor().order[f.editor().index + 1].playbackId
  assert.equal(f.editor().order[f.editor().index + 1].title, source[0].title)
  await w.remove([id])
  assert.ok(!f.editor().order.some(track => track.playbackId === id))
  await w.add([source[4]], true)
  const moved = f.editor().order.find(track => track.title === source[3].title)
  await w.moveNext(moved.playbackId)
  assert.equal(f.editor().order[f.editor().index + 1].playbackId, moved.playbackId)
  assert.deepEqual([...f.order().order.map(track => track.playbackId)], [...committed], 'Coverflow keeps the committed order while the editor changes')
  assert.equal(f.calls.filter(call => call[0] === 'clear').length, clears, 'external buffer references prevent all writes')
  assert.equal(w.status.staged, true)
  f.release(blocker); await w.sync()
  assert.equal(w.status.staged, false)
  await w.next()
  assert.equal(f.order().order[f.order().index].playbackId, moved.playbackId)
  console.log('PASS: protected native references do not freeze the editor; latest edits commit when released')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 1, 'Source')
  await w.add([source[5]])
  f.race()
  assert.equal(await w.add([source[0]], true), true, f.errors.join('; '))
  assert.equal(f.order().order[f.order().index].title, source[2].title, 'a concurrently consumed next item is the new decoder anchor')
  assert.equal(f.order().order[f.order().index + 1].title, source[0].title)
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1)
  assert.equal(f.queue.length, 1)
  await w.next()
  assert.equal(f.order().order[f.order().index].title, source[0].title)
  console.log('PASS: handover during bridge withdrawal swaps buffers without clearing the new decoder')
}

for (const failure of ['failRemoval', 'failRegistration']) {
  const f = fixture(), w = f.workspace
  await w.start(source, 1, 'Source')
  await w.add([source[5]])
  f.pause()
  const before = f.order().order.map(track => track.playbackId)
  const baseline = f.editor().base.map(track => track.playbackId)
  const beforeBridge = { ...f.queue[0] }
  f[failure]()
  assert.equal(await w.add([source[0]], true), false)
  assert.deepEqual([...f.order().order.map(track => track.playbackId)], [...before])
  assert.deepEqual([...f.editor().base.map(track => track.playbackId)], [...baseline], 'failed edits do not change the restore baseline')
  assert.deepEqual(f.queue, [beforeBridge])
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  assert.equal(await w.add([source[4]], true), true)
  assert.equal(f.editor().order[f.editor().index + 1].title, source[4].title)
  console.log(`PASS: ${failure} leaves/restores the previous complete schedule and supports retry`)
}

for (const mode of [0, 1, 2]) {
  const f = fixture(), w = f.workspace
  await w.start(source, 2, 'Source', mode)
  const prefix = f.order().order.slice(0, 3).map(track => track.playbackId)
  f.pause()
  await w.shuffle()
  assert.deepEqual([...f.order().order.slice(0, 3).map(track => track.playbackId)], [...prefix])
  assert.equal(w.status.mode, mode)
  const shuffled = f.order().order.map(track => track.playbackId)
  await w.setMode((mode + 1) % 3)
  assert.deepEqual([...f.order().order.map(track => track.playbackId)], [...shuffled], 'bottom mode changes never restore or reshuffle order')
  await w.restoreOrder()
  assert.deepEqual([...f.order().order.map(track => track.path)], source.map(track => track.path))
  assert.equal(w.status.mode, (mode + 1) % 3)
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  console.log(`PASS: shuffle / bottom mode / restore-order separation for playback policy ${mode}`)
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 0, 'Source')
  f.pause()
  f.lists[0].tracks.splice(2, 1)
  f.lists[0].tracks.push(source[1])
  assert.equal(await w.start(f.lists[0].tracks, 0, 'Source'), true)
  assert.deepEqual([...f.order().order.map(track => track.path)], f.lists[0].tracks.map(track => track.path))
  assert.equal(f.order().order[0].title, source[0].title)
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 2, 'an explicit collection restart is not a same-track pause toggle')
  console.log('PASS: explicit source reload includes edits even when the first song is still current')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 1, 'Source')
  await w.add([source[5]])
  f.queue.push({ playlist: 0, playlistItem: 4 })
  f.stop()
  const restored = f.create()
  await restored.restore()
  assert.equal(restored.status.ready, false)
  assert.equal(restored.status.sourceName, '')
  assert.equal(restored.projection(-1), null)
  assert.deepEqual(f.queue, [{ playlist: 0, playlistItem: 4 }], 'only the stale theme scheduling item is removed')
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1)
  console.log('PASS: stopped restart discards stale plan context without resuming playback or clearing external queue')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 2, 'Source')
  f.pause()
  const before = f.order().order.map(track => track.playbackId)
  const restored = f.create()
  await restored.restore()
  assert.equal(restored.status.ready, true)
  const snapshot = restored.projection(f.live().current)
  assert.deepEqual([...snapshot.order.map(track => track.playbackId)], [...before])
  assert.equal(snapshot.order[snapshot.index].title, source[2].title)
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  console.log('PASS: a live paused session restores the same current occurrence without restart')
}

{
  const f = fixture(), w = f.workspace
  await w.seed([source[0], source[1]])
  f.stop()
  const restored = f.create()
  await restored.restore()
  assert.equal(restored.status.ready, true, 'a deliberately prepared stopped queue is distinct from a stale playback session')
  assert.equal(restored.projection(-1).order.length, 2)
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 0)
  assert.equal(f.queue.length, 1)
  console.log('PASS: stopped seed queue remains available without a false current track or decoder start')
}

{
  const bundled = await build({ entryPoints: ['src/composables/useFoobar.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['foo-webview-sdk', 'vue'] })
  const f = fixture()
  await f.sdk.playlist.playTrack(0, 0)
  f.lists[0].tracks.splice(2, 1)
  f.lists[0].tracks.push(source[1])
  const module = { exports: {} }
  runInNewContext(bundled.outputFiles[0].text, {
    module, exports: module.exports,
    require: id => id === 'foo-webview-sdk' ? { ...f.sdk, __esModule: true, default: f.sdk } : require(id),
    crypto: { randomUUID }, console, URL, URLSearchParams, performance,
    window: { location: { search: '', href: 'https://theme.test/' } },
    setTimeout: () => 0, clearTimeout() {},
  })
  const player = module.exports.useFoobar()
  player.state.connected = true
  player.state.currentTrack = source[0]
  player.state.playbackState = 'paused'
  player.state.route = { view: 'playlist', playlistIndex: 0, playlistName: 'Source' }
  player.state.playlists = [{ index: 0, name: 'Source', trackCount: source.length }]
  assert.equal(await player.playCurrentCollection(), undefined)
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 2, 'the real red-button handler rebuilds rather than toggling the same first song')
  assert.deepEqual([...player.state.playbackTracks.map(track => track.path)], f.lists[0].tracks.map(track => track.path))
  await player.shufflePlaybackPlan()
  const shuffled = player.state.playbackTracks.map(track => track.playbackId)
  for (const mode of [1, 2, 0]) {
    await player.cyclePlaybackOrder()
    assert.equal(player.state.playbackOrder, mode)
    assert.deepEqual([...player.state.playbackTracks.map(track => track.playbackId)], [...shuffled])
  }
  assert.equal('shuffleEnabled' in player.state, false)
  console.log('PASS: real playlist red-button handler reloads edited source; bottom cycles exactly three policies without reordering')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, source.length - 1, 'Source', 1)
  await w.clear()
  const ids = f.order().order.map(track => track.playbackId)
  assert.equal(f.queue[0].playlistItem, 0)
  await w.setMode(0)
  assert.equal(f.queue.length, 0, 'default at the plan end cancels a previously registered loop restart')
  assert.equal(f.live().stopAfter, true)
  await w.setMode(2)
  assert.equal(f.queue.length, 0)
  assert.equal(f.live().stopAfter, false)
  await w.setMode(1)
  assert.equal(f.queue.length, 1)
  assert.equal(f.queue[0].playlistItem, 0)
  assert.deepEqual([...f.order().order.map(track => track.playbackId)], [...ids])
  console.log('PASS: policy changes at the plan end cancel/restore loop scheduling without changing the workset')
}

{
  const f = fixture(() => 0), w = f.workspace
  await w.start(source, 1, 'Source')
  f.lists[0].tracks.reverse()
  await w.shuffle()
  await w.add([source[0]], true)
  const inserted = f.editor().order[f.editor().index + 1]
  const removed = f.editor().order.find(track => track.title === source[4].title)
  await w.remove([removed.playbackId])
  await w.shuffle()
  f.pause()
  assert.equal(await w.restoreOrder(), true)
  const snapshot = f.order()
  assert.deepEqual([...snapshot.order.map(track => track.path)], [source[0], source[1], source[0], source[2], source[3], source[5]].map(track => track.path))
  assert.equal(snapshot.order[snapshot.index + 1].playbackId, inserted.playbackId)
  assert.notEqual(snapshot.order[0].playbackId, inserted.playbackId, 'duplicate file occurrences remain distinct')
  assert.ok(!snapshot.base.some(track => track.playbackId === removed.playbackId))
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  console.log('PASS: shuffle / insert-next / delete / reshuffle / restore retains explicit edits and ignores source changes')
}

{
  const f = fixture(() => 0), w = f.workspace
  await w.start(source, 1, 'Source')
  await w.shuffle()
  await w.next(); await w.next()
  assert.equal(f.order().order[f.order().index].title, source[4].title)
  const moved = f.editor().order.find(track => track.title === source[5].title)
  await w.moveNext(moved.playbackId)
  await w.add([source[0]], true)
  const inserted = f.editor().order[f.editor().index + 1]
  const before = f.order()
  const history = before.order.slice(0, before.index + 1).map(track => track.playbackId)
  await w.shuffle()
  f.pause()
  await w.restoreOrder()
  const restored = f.order()
  assert.deepEqual([...restored.order.slice(0, restored.index + 1).map(track => track.playbackId)], [...history])
  assert.equal(restored.index, before.index)
  assert.deepEqual([...restored.order.slice(restored.index + 1).map(track => track.playbackId)], [inserted.playbackId, moved.playbackId, before.order.find(track => track.title === source[2].title).playbackId])
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  console.log('PASS: late-baseline current track keeps actual history; new/moved Next priorities survive restore')
}

{
  const f = fixture(() => 0), w = f.workspace
  await w.start(source, 1, 'Source')
  const removed = new Set(f.editor().order.slice(2).map(track => track.playbackId))
  await w.shuffle(); await w.clear()
  await w.add([source[5]])
  await w.add([source[0]], true)
  const expected = f.editor().base.map(track => track.playbackId)
  await w.shuffle(); await w.restoreOrder()
  assert.deepEqual([...f.order().order.map(track => track.playbackId)], [...expected])
  assert.ok(f.order().base.every(track => !removed.has(track.playbackId)))
  console.log('PASS: clear removes future baseline occurrences; append and Next rebuild an editable baseline')
}

{
  const f = fixture(() => 0), w = f.workspace
  await w.start(source, 1, 'Source')
  await w.shuffle(); await w.add([source[0]], true)
  const removed = f.editor().order.find(track => track.title === source[4].title)
  await w.remove([removed.playbackId])
  const moved = f.editor().order.find(track => track.title === source[5].title)
  await w.moveNext(moved.playbackId)
  const expected = f.editor().base.map(track => track.playbackId)
  await w.shuffle(); f.pause()
  const restored = f.create()
  await restored.restore(); await restored.restoreOrder()
  assert.deepEqual([...restored.projection(f.live().current).order.map(track => track.playbackId)], [...expected])
  assert.equal(f.saved().baselineVersion, 2)
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  console.log('PASS: restart retains insertion, movement and deletion baseline metadata without restarting playback')
}

{
  const f = fixture(() => 0), w = f.workspace
  await w.start(source, 1, 'Source'); await w.shuffle()
  const blocker = f.protect()
  await w.add([source[0]], true)
  await w.restoreOrder(); await w.shuffle()
  const latest = f.editor().order.map(track => track.playbackId)
  assert.equal(f.saved().deferred.restoreOrder, false, 'a later shuffle supersedes a deferred restore request')
  const history = f.order().order.slice(0, f.order().index + 2).map(track => track.playbackId)
  const ids = new Set(history)
  const restored = f.create()
  await restored.restore()
  f.release(blocker); f.advance(); await restored.sync()
  let snapshot = restored.projection(f.live().current)
  assert.deepEqual([...snapshot.order.map(track => track.playbackId)], [...history, ...latest.filter(id => !ids.has(id))])
  const expected = [...history, ...snapshot.base.map(track => track.playbackId).filter(id => !ids.has(id))]
  f.pause(); await restored.restoreOrder()
  snapshot = restored.projection(f.live().current)
  assert.deepEqual([...snapshot.order.map(track => track.playbackId)], expected)
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  console.log('PASS: deferred edits survive restart and natural handover; restore does not overwrite a later shuffle')
}

{
  const f = fixture(() => 0), w = f.workspace
  await w.start(source, 1, 'Source'); await w.shuffle()
  await w.add([source[0]], true); await w.shuffle()
  const expected = f.order().order.map(track => track.playbackId)
  delete f.saved().baselineVersion
  f.saved().base = f.saved().base.reverse().map(track => ({ id: track.playbackId, path: track.path }))
  const restored = f.create()
  await restored.restore(); await restored.restoreOrder()
  assert.deepEqual([...restored.projection(f.live().current).order.map(track => track.playbackId)], [...expected])
  assert.equal(f.saved().baselineVersion, 2)
  console.log('PASS: legacy cache migration keeps verifiable current order rather than guessing old edit positions')
}
