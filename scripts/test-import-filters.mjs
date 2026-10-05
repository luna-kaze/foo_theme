import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const bundle = await build({ entryPoints: ['src/utils/importFilters.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue', 'foo-webview-sdk'] })
let saved = null, fail = false
const sdk = {
  config: { get: async () => ({ value: saved }), set: async (_key, value) => { if (!fail) saved = { excluded: [...value.excluded] }; return { success: !fail, error: fail ? 'Save failed' : undefined } } },
  discovery: { getInputFormats: async () => ({ fileTypes: [{ mask: '*.flac;*.m4a;*.wav;*.special' }] }) },
}
const exported = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, { module: exported, exports: exported.exports, require: id => id === 'foo-webview-sdk' ? { ...sdk, __esModule: true, default: sdk } : require(id) })
const api = exported.exports
assert.deepEqual([...api.parseImportExclusions('.LRC, *.JPG; txt，lrc')], ['lrc', 'jpg', 'txt'])
assert.throws(() => api.parseImportExclusions('*'), /后缀/)
const files = ['01.flac', '02.m4a', '03.special', 'song.LRC', 'sub.srt', 'cover.jpg', 'booklet.PDF', 'Thumbs.db', 'desktop.ini', 'notes.txt', 'album.cue', 'playlist.m3u8', 'unknown.exe']
assert.deepEqual([...await api.filterImportCandidates(files)], ['01.flac', '02.m4a', '03.special', 'album.cue', 'playlist.m3u8'])
assert.equal(api.isExcludedImport('C:\\Music\\Song.LRC|subsong:0'), true)
await api.saveImportFilters('.lrc;*.flac')
assert.deepEqual(saved.excluded, ['lrc', 'flac'])
assert.deepEqual([...await api.filterImportCandidates(['track.flac', 'track.m4a', 'album.cue'])], ['track.m4a', 'album.cue'])
fail = true
await assert.rejects(api.saveImportFilters('mp3'), /Save failed/)
assert.deepEqual([...api.importFilterSettings.excluded], ['lrc', 'flac'])
console.log('PASS: suffix settings normalize case/globs, persist safely and filter lyrics/images/text before parsing while preserving CUE and installed audio formats')

const source = readFileSync('src/composables/useFoobar.ts', 'utf8') + '\nexport { expandImportPaths }\n'
const theme = await build({ stdin: { contents: source, resolveDir: `${process.cwd()}/src/composables`, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue', 'foo-webview-sdk'] })
const root = 'C:\\Music\\Album'
const host = {
  config: { get: async () => ({ value: null }) },
  discovery: sdk.discovery,
  file: { getInfo: async () => ({ exists: true, isDirectory: true }), list: async () => ({ files: ['02.flac', '01.flac', 'Song.lrc', 'cover.jpg', 'readme.txt'].map(name => `${root}\\${name}`) }) },
}
const actual = { exports: {} }
runInNewContext(theme.outputFiles[0].text, {
  module: actual, exports: actual.exports, require: id => id === 'foo-webview-sdk' ? { ...host, __esModule: true, default: host } : require(id),
  crypto: { randomUUID }, URL, URLSearchParams, performance, console,
  window: { location: { search: '', href: 'https://theme.test/' } }, setTimeout: () => 1, clearTimeout() {},
})
assert.deepEqual([...await actual.exports.expandImportPaths([root])], [`${root}\\01.flac`, `${root}\\02.flac`])
console.log('PASS: the actual folder expansion imports exactly two songs from a music+lyrics+cover folder, in natural order')
