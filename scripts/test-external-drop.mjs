import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const { build, transform } = require('esbuild')
const drop = await build({ entryPoints: ['src/utils/externalDrop.ts'], bundle: true, platform: 'node', format: 'cjs', write: false })
const module = { exports: {} }
runInNewContext(drop.outputFiles[0].text, { module, exports: module.exports })
const { createExternalDropSession, sidebarDropZone } = module.exports
assert.equal(sidebarDropZone(101, 100, 40), 'before')
assert.equal(sidebarDropZone(120, 100, 40), 'append')
assert.equal(sidebarDropZone(139, 100, 40), 'after')
for (const nativeFirst of [true, false]) {
  let release
  const calls = [], errors = []
  const target = { kind: 'temporary' }
  const session = createExternalDropSession({ paths: async () => new Promise(resolve => { release = resolve }), execute: async (paths, destination) => calls.push({ paths, destination }), error: error => errors.push(error) })
  session.begin('gesture-1')
  if (nativeFirst) await session.native({ sessionId: 'gesture-1', paths: ['song.flac'] }, target)
  const html = session.html(target)
  if (!nativeFirst) await session.native({ sessionId: 'gesture-1', paths: ['song.flac'] }, { kind: 'open' })
  release({ sessionId: 'gesture-1', paths: ['song.flac'] }); await html
  assert.equal(calls.length, 1); assert.equal(calls[0].destination.kind, 'temporary')
  session.begin('gesture-2')
  await session.native({ sessionId: 'gesture-2', paths: ['song.flac'] }, target)
  assert.equal(calls.length, 2, 'another intentional drop of the same file is not suppressed')
  await session.native({ sessionId: 'gesture-3', paths: ['song.flac'] }, { kind: 'reject', reason: 'Locked' })
  assert.equal(calls.length, 2); assert.equal(errors.length, 1)
  session.dispose()
}
console.log('PASS: sidebar boundary/append zones and exactly-once processing in either native/HTML drop ordering')

const compiled = await build({ entryPoints: ['src/utils/externalImport.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['foo-webview-sdk'] })
const track = (name, subsong = 0) => ({ path: `C:\\Music\\${name}`, title: name, artist: 'Artist', album: 'Album', duration: 180, subsong })
function fixture() {
  let lists = [{ name: 'Music', tracks: [track('A.flac'), track('B.flac'), track('C.flac')] }, { name: 'AirPlay', tracks: [] }, { name: 'Other', tracks: [track('Last.flac')] }]
  const calls = [], plays = []
  let visible = [], mutate = null
  const info = () => lists.map((list, index) => ({ index, name: list.name, trackCount: list.tracks.length, isLocked: !!list.locked, isAutoplaylist: false, isPlaying: false }))
  const sdk = {
    playlist: {
      getAll: async () => info(),
      getCount: async index => ({ count: lists[index].tracks.length }),
      create: async name => { lists.push({ name, tracks: [] }); return { index: lists.length - 1 } },
      remove: async index => { lists.splice(index, 1); return { success: true } },
      clear: async index => { calls.push(['clear', lists[index].name]); lists[index].tracks = []; return { success: true } },
      addSequential: async (index, paths) => {
        calls.push(['resolve', paths.length])
        const items = paths.flatMap(path => path.endsWith('.txt') ? [] : path.endsWith('.cue') ? [{ ...track('disc.cue', 0), path }, { ...track('disc.cue', 1), path }] : [{ ...track(path), path }])
        lists[index].tracks.push(...items); return { success: true, addedCount: items.length }
      },
      addHandles: async (index, paths) => { lists[index].tracks.push(...paths.map(path => ({ ...track(path), path }))); return { success: true, addedCount: paths.length } },
      insertTracks: async (index, position, paths) => { calls.push(['insert', lists[index].name, position, [...paths]]); lists[index].tracks.splice(position, 0, ...paths.map(path => ({ ...track(path), path }))); return { success: true, addedCount: paths.length } },
    },
    queue: { get: async () => ({ items: [] }) },
    file: { getInfo: async path => ({ exists: true, isDirectory: path.endsWith('folder.v2') }) },
  }
  const exports = { exports: {} }
  runInNewContext(compiled.outputFiles[0].text, { module: exports, exports: exports.exports, require: id => id === 'foo-webview-sdk' ? { ...sdk, __esModule: true, default: sdk } : require(id) })
  const importer = exports.exports.createExternalImporter({
    owner: async () => 'owner', expand: async paths => { mutate?.(); return [...paths] },
    tracks: async index => lists[index].tracks.map((item, sourceIndex) => ({ ...item, sourceIndex })),
    visible: () => visible,
    refresh: async () => { visible = info().filter(item => item.name !== 'AirPlay' && !item.name.includes('[foo-theme:')) },
    reorder: async order => {
      const previous = [...lists], picked = order.map(index => previous[index]); let cursor = 0
      lists = previous.map(list => list.name === 'AirPlay' || list.name.includes('[foo-theme:') ? list : picked[cursor++])
    },
    select: async index => calls.push(['select', lists[index].name]),
    play: async (tracks, name) => { plays.push({ tracks, name }); return true },
    fallback: async paths => calls.push(['fallback', [...paths]]),
  })
  return { importer, calls, plays, lists: () => lists, mutate: callback => { mutate = callback }, key: index => `c:\\music\\${['a', 'b', 'c'][index]}.flac\u00000` }
}
{
  const f = fixture()
  await f.importer.importPaths(['C:\\Incoming\\new.flac'], { kind: 'append', playlist: { index: 0, name: 'Music' } })
  assert.equal(f.calls.find(call => call[0] === 'insert')[2], 3)
  assert.equal(f.plays.length, 0)
  const buffer = f.lists().find(list => list.name.includes('拖放解析'))
  assert.equal(buffer.tracks.length, 0)
  console.log('PASS: playlist-body drop appends without starting playback and clears only the owned import buffer')
}
{
  const f = fixture()
  await f.importer.importPaths(['C:\\Incoming\\disc.cue'], { kind: 'insert', playlist: { index: 0, name: 'Music' }, sourceIndex: 1, key: f.key(1), after: false })
  const insert = f.calls.find(call => call[0] === 'insert')
  assert.equal(insert[2], 1)
  assert.ok(insert[3][0].endsWith('|subsong:0')); assert.ok(insert[3][1].endsWith('|subsong:1'))
  assert.equal(f.lists()[0].tracks.length, 5)
  console.log('PASS: exact row insertion preserves order and resolved CUE subsong identities')
}
{
  const f = fixture()
  await f.importer.importPaths(['C:\\Incoming\\folder.v2'], { kind: 'create', anchor: { index: 0, name: 'Music' }, after: false })
  assert.deepEqual(f.lists().filter(list => !list.name.includes('[foo-theme:') && list.name !== 'AirPlay').map(list => list.name), ['folder.v2', 'Music', 'Other'])
  assert.equal(f.lists()[1].name, 'AirPlay', 'hidden AirPlay remains in its native slot')
  assert.equal(f.plays.length, 0)
  console.log('PASS: boundary drop creates and positions a named playlist without moving hidden AirPlay or starting playback')
}
{
  const f = fixture()
  await f.importer.importPaths(['C:\\Incoming\\1.flac', 'C:\\Incoming\\2.flac'], { kind: 'temporary' })
  assert.equal(f.plays.length, 1); assert.equal(f.plays[0].tracks.length, 2)
  assert.equal(f.lists().filter(list => !list.name.includes('[foo-theme:')).length, 3)
  console.log('PASS: left-card drop plays only the dropped collection without creating a visible permanent playlist')
}
{
  const f = fixture()
  f.mutate(() => f.lists()[0].tracks.reverse())
  await assert.rejects(f.importer.importPaths(['C:\\Incoming\\new.flac'], { kind: 'insert', playlist: { index: 0, name: 'Music' }, sourceIndex: 1, key: f.key(1), after: true }), /顺序发生变化/)
  assert.equal(f.calls.some(call => call[0] === 'insert'), false)
  const g = fixture(); g.lists()[0].locked = true
  await assert.rejects(g.importer.importPaths(['file.flac'], { kind: 'append', playlist: { index: 0, name: 'Music' } }), /不可写/)
  const h = fixture()
  await assert.rejects(h.importer.importPaths(['notes.txt'], { kind: 'temporary' }), /没有解析/)
  assert.equal(h.plays.length, 0)
  console.log('PASS: stale rows, locked targets and all-unsupported input never write to a destination or start playback')
}

// Exercise the real page hit resolver without opening a browser or changing host files.
const app = readFileSync('src/App.vue', 'utf8')
const resolver = app.match(/function externalDropTarget\(x: number, y: number\): ExternalDropTarget \{[\s\S]*?\n\}/)[0]
const code = await transform(`${resolver}\nmodule.exports = externalDropTarget`, { loader: 'ts', format: 'cjs' })
let hit = null
const state = { playlists: [{ index: 2, name: 'Target' }], visibleTracks: [{ ...track('B.flac'), sourceIndex: 12 }] }
const exported = { exports: {} }
runInNewContext(code.code, { module: exported, state, dragState: {}, document: { elementFromPoint: () => hit }, scenePending: { value: false }, sceneSwitching: { value: false }, displayedScene: { value: { route: { view: 'playlist', playlistIndex: 2, playlistName: 'Target' } } }, sidebarDropZone, markExternalDrop() {}, trackKey: item => item ? `${item.path}|${item.subsong}` : '' })
const row = { dataset: { trackIndex: '0', sourceIndex: '12', trackIdentity: encodeURIComponent('rendered-track-identity') }, getBoundingClientRect: () => ({ top: 100, height: 40, bottom: 140 }) }
const list = { dataset: { playlistIndex: '2' } }
hit = { closest: selector => selector.startsWith('.track-list') ? list : selector.startsWith('.track-row') ? row : null }
const resolved = exported.exports(20, 139)
assert.equal(resolved.kind, 'insert'); assert.equal(resolved.sourceIndex, 12); assert.equal(resolved.after, true)
state.visibleTracks[0].sourceIndex = 99
assert.equal(exported.exports(20, 139).sourceIndex, 12, 'rendered DOM identity wins over a pending reactive row refresh')
assert.equal(exported.exports(20, 139).key, 'rendered-track-identity')
hit = { closest: selector => selector === '[data-external-play-target]' ? {} : null }
assert.equal(exported.exports(20, 700).kind, 'temporary')
console.log('PASS: actual hit resolver uses original source indices for filtered rows and gives the bottom card its temporary-play semantics')
