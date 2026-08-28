import type { AlbumInfo, PlaylistInfo, QueueItem, TrackInfo } from 'foo-webview-sdk'

export type ViewId = 'home' | 'albums' | 'songs' | 'playlist' | 'album' | 'favourites' | 'radio' | 'search'
export type NowPlayingTab = 'lyrics' | 'queue'
export type DialogId = 'createPlaylist' | null

export interface AlbumCard extends AlbumInfo {
  id: string
  artworkUrl: string
}

export interface DisplayTrack extends TrackInfo {
  artworkUrl?: string
  isPlaying?: boolean
  sourceIndex?: number
  customValue?: string
  playCount?: number
  lastPlayed?: string
}

export type ViewRoute =
  | { view: 'home' }
  | { view: 'albums' }
  | { view: 'songs' }
  | { view: 'favourites' }
  | { view: 'album'; albumName: string; albumArtist: string }
  | { view: 'playlist'; playlistIndex: number; playlistName: string }
  | { view: 'search'; query: string }
  | { view: 'radio'; nonce: number; snapshot?: DisplayTrack[] }

export interface DisplayQueueItem extends QueueItem {
  queueSource: 'explicit' | 'playlist'
  sourceIndex: number
  artworkUrl?: string
}

export interface ParsedLyric {
  time: number
  text: string
  estimated?: boolean
}

export interface TrackDetails {
  track: DisplayTrack
  path: string
  tags: Record<string, string | string[]>
  info: {
    duration?: number
    bitrate?: number
    sampleRate?: number
    channels?: number
    codec?: string
  }
  playCount: number
  firstPlayed: string
  lastPlayed: string
  added: string
  rating: number
  replayGain: {
    trackGain?: string
    trackPeak?: string
    albumGain?: string
    albumPeak?: string
    hasReplayGain?: boolean
  }
}

export interface PlayerUiState {
  connected: boolean
  loading: boolean
  view: ViewId
  route: ViewRoute
  search: string
  albums: AlbumCard[]
  tracks: DisplayTrack[]
  recentTracks: DisplayTrack[]
  viewTracks: DisplayTrack[]
  visibleTracks: DisplayTrack[]
  playlists: PlaylistInfo[]
  activePlaylist: PlaylistInfo | null
  browsingPlaylist: PlaylistInfo | null
  selectedAlbum: AlbumCard | null
  queue: DisplayQueueItem[]
  currentTrack: DisplayTrack | null
  playbackHistory: DisplayTrack[]
  currentArtwork: string
  lyrics: ParsedLyric[]
  lyricsSynced: boolean
  isPlaying: boolean
  playbackState: 'stopped' | 'playing' | 'paused'
  canSeek: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  playbackOrder: number
  nowPlayingOpen: boolean
  nowPlayingTab: NowPlayingTab
  canGoBack: boolean
  canGoForward: boolean
  dialog: DialogId
  toast: { message: string; tone: 'info' | 'success' | 'error' } | null
  error: string
  searchLoading: boolean
  dndSupported: boolean
  importing: boolean
  libraryFilters: {
    artist: string
    albumArtist: string
    genre: string
    folder: string
    field: 'all' | 'title' | 'artist' | 'album' | 'genre' | 'path'
    operator: 'contains' | 'equals' | 'startsWith'
    value: string
    playState: 'all' | 'played' | 'unplayed' | 'recent'
  }
  libraryStatus: { initialized: boolean; scanning: boolean | null; itemCount: number }
  customColumn: { label: string; pattern: string }
}
