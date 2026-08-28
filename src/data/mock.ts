import type { AlbumCard, DisplayTrack, ParsedLyric } from '../types/music'
import type { PlaylistInfo, QueueItem } from 'foo-webview-sdk'

const palettes = [
  ['#f4b7a9', '#a83f68', '#301b3c'],
  ['#d7de8a', '#5f875e', '#26384c'],
  ['#ffcc82', '#e75b64', '#553555'],
  ['#b9e2e4', '#4b7da3', '#2b3758'],
  ['#dccbf2', '#8868a8', '#38364f'],
  ['#ebd8b3', '#b77950', '#4a3d3a'],
]

function makeCover(index: number, title: string): string {
  const [a, b, c] = palettes[index % palettes.length]
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset=".54" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient><filter id="n"><feTurbulence baseFrequency=".65" numOctaves="3" stitchTiles="stitch"/><feBlend mode="soft-light" in="SourceGraphic"/></filter></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="455" cy="145" r="190" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="55"/><path d="M-60 510 Q160 300 330 470 T700 360" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="90"/><rect width="600" height="600" opacity=".18" filter="url(#n)"/><text x="48" y="530" fill="white" font-family="Segoe UI,sans-serif" font-size="82" font-weight="700" letter-spacing="-4">${initials}</text></svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

const albumSource = [
  ['Afterglow', 'Noa Vale', '2026'],
  ['Tidal Memory', 'Juniper Glass', '2025'],
  ['Halcyon Lines', 'Milo Grey', '2024'],
  ['Night Architecture', 'Lumen Field', '2026'],
  ['Soft Signals', 'Mara Voss', '2025'],
  ['Parallel Bloom', 'The Sundays Club', '2023'],
] as const

export const mockAlbums: AlbumCard[] = albumSource.map(([name, artist, year], index) => ({
  id: `album-${index}`,
  name,
  artist,
  year,
  trackCount: 10 + index,
  duration: 2400 + index * 180,
  firstTrackPath: `demo://album-${index}/1`,
  artworkUrl: makeCover(index, name),
}))

const titles = [
  'Places We Leave',
  'Ribbon of Light',
  'Slow Current',
  'Paper Moons',
  'Aperture',
  'Violet Hour',
  'Still Life in Motion',
  'Northbound',
]

export const mockTracks: DisplayTrack[] = titles.map((title, index) => {
  const album = mockAlbums[index % mockAlbums.length]
  return {
    id: `track-${index}`,
    title,
    artist: album.artist,
    album: album.name,
    date: album.year,
    duration: 202 + index * 17,
    path: `demo://track-${index}`,
    absolutePath: `demo://track-${index}`,
    trackNumber: index + 1,
    genre: index % 2 ? 'Alternative' : 'Electronic',
    rating: index === 0 || index === 3 ? 5 : 0,
    artworkUrl: album.artworkUrl,
  }
})

export const mockPlaylists: PlaylistInfo[] = [
  { index: 0, name: '收藏曲目', trackCount: 42, isActive: true, isPlaying: true, isLocked: false },
  { index: 1, name: '夜间驾驶', trackCount: 18, isActive: false, isPlaying: false, isLocked: false },
  { index: 2, name: '深度专注', trackCount: 31, isActive: false, isPlaying: false, isLocked: false },
]

export const mockQueue: QueueItem[] = mockTracks.slice(1, 6).map((track, index) => ({
  ...track,
  playlist: 0,
  playlistItem: index + 1,
}))

export const mockLyrics: ParsedLyric[] = [
  { time: 0, text: 'A little light across the room' },
  { time: 12, text: 'The quiet shape of an afternoon' },
  { time: 24, text: 'We keep the places that we leave' },
  { time: 38, text: 'Like folded notes inside a sleeve' },
  { time: 53, text: 'Everything moves, everything stays' },
  { time: 69, text: 'We find our names in borrowed days' },
]
