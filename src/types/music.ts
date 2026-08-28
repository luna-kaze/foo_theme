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
}

export interface DisplayQueueItem extends QueueItem {
  queueSource: 'explicit' | 'playlist'
  sourceIndex: number
}

export interface ParsedLyric {
  time: number
  text: string
  estimated?: boolean
}

export interface PlayerUiState {
  connected: boolean
  loading: boolean
  view: ViewId
  search: string
  albums: AlbumCard[]
  tracks: DisplayTrack[]
  recentTracks: DisplayTrack[]
  viewTracks: DisplayTrack[]
  visibleTracks: DisplayTrack[]
  playlists: PlaylistInfo[]
  activePlaylist: PlaylistInfo | null
  selectedAlbum: AlbumCard | null
  queue: DisplayQueueItem[]
  currentTrack: DisplayTrack | null
  currentArtwork: string
  lyrics: ParsedLyric[]
  lyricsSynced: boolean
  isPlaying: boolean
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
}
