import type { AlbumInfo, ArtistInfo, LibraryStats, PlaylistInfo, QueueItem, TrackInfo } from 'foo-webview-sdk'

export type ViewId = 'home' | 'overview' | 'artists' | 'artist' | 'albums' | 'songs' | 'folders' | 'folder' | 'playlist' | 'album' | 'favourites' | 'radio' | 'search' | 'ipod'
export type NowPlayingTab = 'lyrics' | 'queue'
export type DialogId = 'createPlaylist' | null
export type LibraryFilterField = 'all' | 'title' | 'artist' | 'albumArtist' | 'album' | 'genre' | 'path'
export type LibraryFilterOperator = 'contains' | 'equals' | 'startsWith'
export type LibraryFilterMatchMode = 'all' | 'any'
export interface LibraryFilterRule {
  id: string
  field: LibraryFilterField
  operator: LibraryFilterOperator
  value: string
}

export interface AlbumCard extends AlbumInfo {
  id: string
  artworkUrl: string
  sortName?: string
}

export interface ArtistCard extends ArtistInfo {
  sortName?: string
}

export interface DisplayTrack extends TrackInfo {
  artworkUrl?: string
  isPlaying?: boolean
  sourceIndex?: number
  customValue?: string
  playCount?: number
  lastPlayed?: string
  isFavourite?: boolean
  playbackId?: string
  playbackPlaylistIndex?: number
  playbackPlaceholder?: boolean
  playbackQueued?: boolean
}

export interface LibraryFolderCard {
  rootId: string
  pathId: string
  name: string
  absolutePath: string
  trackCount: number
  hasChildren: boolean
}

export type ViewRoute =
  | { view: 'home' }
  | { view: 'overview' }
  | { view: 'artists' }
  | { view: 'artist'; artist: string }
  | { view: 'albums' }
  | { view: 'songs' }
  | { view: 'folders' }
  | { view: 'folder'; rootId: string; pathId: string; name: string }
  | { view: 'favourites' }
  | { view: 'album'; albumName: string; albumArtist: string }
  | { view: 'playlist'; playlistIndex: number; playlistName: string }
  | { view: 'search'; query: string }
  | { view: 'ipod' }
  | { view: 'radio'; nonce: number; snapshot?: DisplayTrack[] }

export interface RouteSceneData {
  key: string
  cacheKey: string
  route: ViewRoute
  albums: AlbumCard[]
  tracks: DisplayTrack[]
  artists: ArtistCard[]
  folders: LibraryFolderCard[]
  stats: LibraryStats
  selectedAlbum: AlbumCard | null
  activePlaylist: PlaylistInfo | null
  search: string
  searchArtists: ArtistCard[]
  loading: boolean
  searchLoading: boolean
}

export interface DisplayQueueItem extends QueueItem {
  queueSource: 'explicit' | 'playlist'
  sourceIndex: number
  artworkUrl?: string
  playbackId?: string
  playbackPlaylistIndex?: number
  playbackQueued?: boolean
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
  artists: ArtistCard[]
  libraryFolders: LibraryFolderCard[]
  libraryStats: LibraryStats
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
  playbackTracks: DisplayTrack[]
  playbackPlanIds: string[]
  playbackTrackIndex: number
  playingPlaylistIndex: number
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
  shuffleEnabled: boolean
  shufflePending: boolean
  shuffleStaged: boolean
  shuffleBusy: boolean
  shuffleRevision: number
  shuffleSourceName: string
  nowPlayingOpen: boolean
  isFullscreen: boolean
  nowPlayingTab: NowPlayingTab
  canGoBack: boolean
  canGoForward: boolean
  dialog: DialogId
  toast: { message: string; tone: 'info' | 'success' | 'error' } | null
  error: string
  searchLoading: boolean
  dndSupported: boolean
  importing: boolean
  alphabetIndexView: boolean
  libraryFilters: {
    artist: string
    albumArtist: string
    folder: string
    rating: 'all' | 'unrated' | '1' | '2' | '3' | '4' | '5'
    favourite: 'all' | 'favourite' | 'unfavourite'
    matchMode: LibraryFilterMatchMode
    rules: LibraryFilterRule[]
  }
  libraryStatus: { initialized: boolean; scanning: boolean | null; itemCount: number }
  customColumn: { label: string; pattern: string }
}
