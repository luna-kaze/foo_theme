import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const vue = require('vue'), { parse, compileScript } = require('@vue/compiler-sfc')
const { build } = require('esbuild')
const searches = new Map(), previews = new Map(), events = [], hooks = []
const provider = {
  getArtistProfile: () => ({ photoSearchName: '', searchName: '' }),
  searchArtistMatches: async (_name, _kind, query) => new Promise(resolve => searches.set(query, resolve)),
  previewArtistMatch: async (_name, candidate) => new Promise(resolve => previews.set(candidate.id, resolve)),
  applyArtistMatch: async () => {}, chooseArtistPhoto: async () => false,
}
const descriptor = parse(readFileSync('src/components/ArtistMatchDialog.vue', 'utf8')).descriptor
const script = compileScript(descriptor, { id: 'artist-match-test' })
const compiled = await build({ stdin: { contents: script.content, resolveDir: `${process.cwd()}/src/components`, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], plugins: [{ name: 'provider', setup(build) { build.onResolve({ filter: /composables\/useArtistProfiles$/ }, () => ({ path: 'artist-match-provider', external: true })) } }] })
const module = { exports: {} }
runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'artist-match-provider' ? provider : id === 'vue' ? { ...vue, onMounted() {}, onBeforeUnmount: fn => hooks.push(fn) } : require(id), document: { activeElement: { isConnected: false } }, window: { addEventListener() {}, removeEventListener() {} } })
const scope = vue.effectScope()
const state = scope.run(() => module.exports.default.setup({ name: 'Artist', kind: 'picture' }, { expose() {}, emit: (name, value) => events.push({ name, value }) }))
const flush = async () => { for (let i = 0; i < 8; i++) await vue.nextTick() }
const candidate = id => ({ kind: 'picture', id, name: id, detail: '', query: id, url: 'https://music.apple.com/cn/artist/10' })
const preview = id => ({ owner: 'Artist', candidate: candidate(id), image: 'data:image/jpeg;base64,YQ==', biography: '', source: 'Apple Music' })
state.query.value = 'new'
const newSearch = state.search()
searches.get('new')([candidate('new')]); await newSearch; await flush()
searches.get('Artist')([candidate('old')]); await flush()
assert.equal(state.candidates.value[0].id, 'new')
const selectOther = state.select(candidate('other'))
previews.get('new')(preview('new')); await flush()
assert.equal(state.preview.value, null, 'late previous preview cannot replace a newer selected candidate')
previews.get('other')(preview('other')); await selectOther
assert.equal(state.preview.value.candidate.id, 'other')
await state.apply()
assert.deepEqual(events.at(-1), { name: 'applied', value: 'picture' })
await state.localPhoto()
assert.equal(events.filter(event => event.name === 'applied').length, 1, 'cancelled file selection must not apply a new match')
state.keyboard({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} })
assert.equal(events.at(-1).name, 'close')
const late = state.select(candidate('closed'))
hooks.forEach(fn => fn()); scope.stop()
previews.get('closed')(preview('closed')); await late
assert.equal(state.preview.value, null)
console.log('PASS: candidate search/preview generations reject stale responses, only the chosen type applies, cancelled file choice is non-destructive and Escape/unmount preserve isolation')
