import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
const require = createRequire(import.meta.url)
const compiled = await require('esbuild').build({ entryPoints: ['src/composables/useArtistProfiles.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue', 'foo-webview-sdk'] })
const firstId = '11111111-1111-1111-1111-111111111111', secondId = '22222222-2222-2222-2222-222222222222'
const cache = new Map(), calls = []
let rejectWrite = false
const textElement = () => ({ value: '', set innerHTML(value) { this.value = value.replace(/&amp;/g, '&') } })
const sdk = {
  misc: { getProfilePath: async () => ({ path: 'C:\\VirtualProfile' }) },
  config: { get: async () => ({ value: { autoApple: true, storefront: 'cn', lastfmApiKey: 'a'.repeat(32) } }) },
  file: { exists: async path => ({ exists: !path.endsWith('.json') || cache.has(path) }), mkdir: async () => ({ success: true }), read: async path => ({ content: cache.get(path) }), write: async (path, data) => { if (rejectWrite) return { success: false }; cache.set(path, data); return { success: true } } },
  http: { request: async (url, options) => {
    const u = new URL(url); calls.push(url)
    let data
    if (u.hostname === 'itunes.apple.com') data = { results: [{ artistId: 10, artistName: 'Photo Person', primaryGenreName: 'J-pop' }] }
    else if (u.hostname === 'music.apple.com') return { success: true, status: 200, body: '<script type="application/ld+json">'+JSON.stringify({ '@type': 'Person', name: 'Photo Person', url: 'https://music.apple.com/cn/artist/photo-person/10', image: 'https://is1-ssl.mzstatic.com/photo.jpg', description: '在 Apple Music 中畅听 Photo Person 的音乐。查找热门歌曲和专辑。' })+'</script>' }
    else if (u.hostname.endsWith('.mzstatic.com')) return { success: true, status: 200, headers: { 'content-type': 'image/jpeg' }, body: 'YWJj' }
    else if (u.hostname === 'musicbrainz.org') {
      if (u.pathname.endsWith('/artist/')) data = { artists: [{ id: firstId, name: 'Bio One', country: 'JP', type: 'Person' }, { id: secondId, name: 'Bio Two', country: 'JP', type: 'Person' }] }
      else { const id = u.pathname.split('/').at(-1); data = { id, name: id === secondId ? 'Bio Two' : 'Bio One', country: 'JP', type: 'Person', 'life-span': { begin: '1990-01-01' }, relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q10' } }] } }
    }
    else if (u.hostname === 'www.wikidata.org') data = { entities: { Q10: { descriptions: { zh: { value: '日本歌手' } }, sitelinks: { zhwiki: { title: '正确艺术家' } }, claims: { P18: [{ rank: 'preferred', mainsnak: { datavalue: { value: 'Photo.jpg' } } }] } } } }
    else if (u.hostname === 'zh.wikipedia.org') data = { query: { pages: [{ extract: '这是经过身份匹配的真实艺术家简介。包含经历和音乐活动。' }] } }
    else if (u.hostname === 'ws.audioscrobbler.com') data = { artist: { name: 'Bio Two', mbid: u.searchParams.get('mbid'), bio: { content: '' }, stats: { listeners: '42', playcount: '100' }, tags: { tag: [{ name: 'j-pop' }] }, similar: { artist: [] } } }
    else throw new Error('Unexpected source: ' + u.hostname)
    return { success: true, status: 200, body: JSON.stringify(data) }
  } },
}
function instance() {
  const module = { exports: {} }
  runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'foo-webview-sdk' ? { fb: sdk } : require(id), URL, URLSearchParams, document: { createElement: textElement }, setTimeout: fn => { queueMicrotask(fn); return 1 }, clearTimeout() {} })
  module.exports.configureArtistProfiles({ connected: () => true, tracks: () => [] })
  return module.exports
}
const api = instance(), name = 'Library Artist'
const profile = api.getArtistProfile(name)
profile.mbid = firstId; profile.biography = '原来的简介'; profile.sourceUrl = `https://musicbrainz.org/artist/${firstId}`
profile.appleImage = 'data:image/jpeg;base64,b2xk'; profile.appleUrl = 'https://music.apple.com/cn/artist/20'; profile.appleId = '20'
profile.appleBiography = '在 Apple Music 中畅听 Library Artist 的音乐。查找热门歌曲和专辑。'
assert.equal(api.artistBiography({ ...profile, biography: '', lastfmBiography: '' }).text, '', 'old cached SEO cannot become a biography')
const photos = await api.searchArtistMatches(name, 'picture', 'Photo Person')
const priorInfo = JSON.stringify({ id: profile.mbid, bio: profile.biography, url: profile.sourceUrl })
const photoPreview = await api.previewArtistMatch(name, photos[0])
assert.equal(profile.appleId, '20', 'preview must not overwrite the current photo')
await api.applyArtistMatch(name, photoPreview)
assert.equal(profile.appleId, '10'); assert.equal(profile.picturePinned, true)
assert.equal(JSON.stringify({ id: profile.mbid, bio: profile.biography, url: profile.sourceUrl }), priorInfo)
assert.equal(api.artistPortraitSource(profile), 'Apple Music')
assert.equal(profile.photoSearchName, 'Photo Person')
assert.equal(profile.searchName, '')
console.log('PASS: picture search and preview are non-destructive; confirming a photo changes only image fields and pins its independent identity')

const priorPhoto = JSON.stringify({ image: profile.appleImage, id: profile.appleId, url: profile.appleUrl, pref: profile.picturePreference, query: profile.photoSearchName })
const candidates = await api.searchArtistMatches(name, 'info', 'Bio Two')
const infoPreview = await api.previewArtistMatch(name, candidates.find(candidate => candidate.id === secondId))
assert.equal(profile.mbid, firstId, 'preview never changes live biography identity')
assert.ok(infoPreview.biography.includes('真实艺术家简介'))
assert.ok(!calls.some(url => url.includes('commons.wikimedia.org')), 'info-only preview must not query/replace photos')
await api.applyArtistMatch(name, infoPreview)
assert.equal(profile.mbid, secondId); assert.equal(profile.manualIdentity, true)
assert.equal(profile.searchName, 'Bio Two')
assert.equal(JSON.stringify({ image: profile.appleImage, id: profile.appleId, url: profile.appleUrl, pref: profile.picturePreference, query: profile.photoSearchName }), priorPhoto)
assert.ok(api.artistBiography(profile).text.includes('真实艺术家简介'))
await api.loadOnlineArtistProfile(name)
assert.equal(profile.mbid, secondId); assert.equal(profile.appleId, '10')
assert.equal(profile.photoSearchName, 'Photo Person')
assert.equal(profile.searchName, 'Bio Two')
assert.equal(JSON.stringify({ image: profile.appleImage, id: profile.appleId, url: profile.appleUrl, pref: profile.picturePreference, query: profile.photoSearchName }), priorPhoto)
profile.failedImages.push(profile.appleImage)
profile.localImage = 'data:image/jpeg;base64,d3JvbmctbG9jYWw='
assert.equal(api.artistPortraitUrl(profile), '', 'a confirmed photo must not fall back to an old wrong person')
console.log('PASS: info matching preserves every photo choice, refresh respects both pins, and failed pinned images never fall back to a wrong identity')

await assert.rejects(api.applyArtistMatch('Another Artist', photoPreview), /艺术家已变化/)
rejectWrite = true
await assert.rejects(api.applyArtistMatch(name, photoPreview), /未能保存/)
rejectWrite = false
const saved = [...cache.values()].map(value => JSON.parse(value)).find(value => value.name === name)
assert.equal(saved.version, 3); assert.equal(saved.picturePinned, true); assert.equal(saved.photoSearchName, 'Photo Person'); assert.equal(saved.searchName, 'Bio Two')
const restored = instance()
await restored.ensureLocalArtistProfile(name)
assert.equal(restored.getArtistProfile(name).appleId, '10'); assert.equal(restored.getArtistProfile(name).mbid, secondId)
const file = [...cache.keys()].find(path => JSON.parse(cache.get(path)).name === name)
cache.set(file, JSON.stringify({ ...saved, version: 2, picturePreference: 'auto', manualImage: 'data:image/jpeg;base64,bWFudWFs', appleBiography: 'Listen to Library Artist on Apple Music. Find top songs and albums.' }))
const migrated = instance()
await migrated.ensureLocalArtistProfile(name)
assert.equal(migrated.getArtistProfile(name).picturePreference, 'manual')
assert.equal(migrated.getArtistProfile(name).picturePinned, true)
assert.equal(migrated.getArtistProfile(name).appleBiography, '')
console.log('PASS: independent pins survive cache reload; legacy manual portraits migrate and promotional cached biography text is removed')
