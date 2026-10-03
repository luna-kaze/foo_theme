import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const compiled = await build({ entryPoints: ['src/composables/playbackWorkspace.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['foo-webview-sdk', 'vue'] })
const source = Array.from({ length: 6 }, (_, index) => ({ path: `C:\\Music\\${index}.flac`, subsong: 0, title: `Track ${index}`, artist: 'Artist', album: 'Album', albumArtist: 'Artist', duration: 180 }))

function fixture() {
  const lists = [{ name: 'Source', tracks: [...source] }]
  const queue = [], calls = [], errors = []
  const preferences = new Map()
  let playing = -1, current = -1, stopAfter = false, failAdd = false
  let playback = { state: 'paused', position: 43 }
  const fb = {
    config: { get: async key => ({ value: preferences.get(key) }), set: async (key, value) => { preferences.set(key, structuredClone(value)); return { success: true } } },
    player: {
      getPlayingPlaylist: async () => ({ playlist: playing }),
      getCurrentTrackIndex: async () => ({ index: current }),
      getStopAfterCurrent: async () => ({ enabled: stopAfter }),
      setStopAfterCurrent: async enabled => { stopAfter = enabled; calls.push(['stopAfter', enabled]); return { success: true } },
      setOrder: async order => { calls.push(['order', order]); return { success: true } },
      next: async () => { calls.push(['next']); advance() },
    },
    playlist: {
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
      add: async ({ playlist, track }) => { queue.push({ playlist, playlistItem: track }); return { success: true } },
      remove: async index => { queue.splice(index, 1); return { success: true } },
    },
  }
  function advance() {
    const next = queue.shift()
    if (next) { playing = next.playlist; current = next.playlistItem }
    else if (!stopAfter) current += 1
    else { playing = -1; current = -1 }
  }
  const module = { exports: {} }
  runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'foo-webview-sdk' ? { ...fb, __esModule: true, default: fb } : require(id), crypto: { randomUUID }, console })
  const create = () => module.exports.createPlaybackWorkspace({ connected: () => true, owner: async () => 'test-owner', tracks: async index => lists[index].tracks.map(track => ({ ...track })), publish() {}, notify: message => errors.push(message) })
  const workspace = create()
  return { workspace, create, lists, queue, calls, errors, advance, pause: () => { playback = { state: 'paused', position: 43 } }, live: () => ({ playing, current, playback, stopAfter }), fail: () => { failAdd = true }, order: () => workspace.projection(current) }
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
  const committed = f.order().order.map(track => track.playbackId)
  const queuedIndex = f.queue[0].playlist
  const queuedContents = f.lists[queuedIndex].tracks.map(track => track.path)
  assert.equal(await w.add([source[0]], true), true)
  assert.equal(w.status.staged, true)
  assert.deepEqual([...f.order().order.map(track => track.playbackId)], [...committed], 'uncommitted edits do not animate or replace the visible plan')
  assert.deepEqual(f.lists[queuedIndex].tracks.map(track => track.path), queuedContents)
  assert.equal(f.queue.length, 1)
  assert.equal(f.live().playing, decoder)
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  assert.equal(f.calls.filter(call => call[0] === 'play').length, 1, 'planning never restarts playback')
  assert.deepEqual(f.lists[0].tracks, original.reverse(), 'planning does not touch the source')
  assert.equal(await w.next(), true)
  assert.equal(f.order().order[f.order().index].title, source[0].title, 'manual Next applies the latest next-insert')
  assert.equal(w.status.staged, false)
  assert.equal(f.lists.length, 3, 'only two fixed buffers are created')
  console.log('PASS: source isolation, duplicate identity, paused decoder, guarded buffer, deferred visibility and latest manual Next')
}

{
  const f = fixture(), w = f.workspace
  await w.start(source, 1, 'Source')
  f.pause()
  await w.add([source[5]])
  await w.add([source[0]], true)
  const revision = w.status.revision
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
  await w.reorder(3)
  assert.equal(w.status.mode, 3)
  assert.equal(f.calls.at(-1)[1], 0, 'shuffle uses explicit default-order playback')
  await w.reorder(2)
  assert.equal(f.queue.length, 0, 'repeat-one cancels the theme next bridge')
  assert.equal(w.status.mode, 2)
  await w.add([source[0]], true)
  assert.equal(w.status.staged, false, 'unreferenced repeat-one buffer can accept new edits')
  await w.reorder(0)
  assert.equal(f.queue.length, 1)
  assert.deepEqual(f.live().playback, { state: 'paused', position: 43 })
  console.log('PASS: explicit shuffle, repeat-one edits and resume of queued handover')
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
  await w.add([source[0]], true)
  const restored = f.create()
  await restored.restore()
  assert.equal(restored.status.ready, true)
  assert.equal(restored.status.staged, true)
  assert.equal(f.queue.length, 1, 'restore does not duplicate registration')
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
  assert.equal(await w.reorder(1), true)
  assert.equal(f.queue.length, 0, 'unchanged loop switch does not copy or schedule unnecessarily')
  console.log('PASS: manual Next escapes repeat-one and unchanged list-loop switches avoid copies')
}

{
  const f = fixture(), w = f.workspace
  assert.equal(await w.setMode(3), true)
  assert.equal(await w.start(source, 3, 'Source'), true)
  assert.equal(w.status.mode, 3)
  assert.equal(f.order().order[f.order().index].title, source[3].title)
  assert.equal(f.order().index, 0)
  console.log('PASS: mode selected before playback applies to the new isolated workset')
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
