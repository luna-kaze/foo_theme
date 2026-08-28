import type { TrackInfo } from 'foo-webview-sdk'
import type { DisplayTrack } from '../types/music'

type TrackIdentity = Pick<TrackInfo, 'id' | 'path' | 'absolutePath' | 'subsong'> & { fullPath?: string }

function basePath(track: TrackIdentity) {
  return (track.fullPath || track.absolutePath || track.path || track.id || '').replace(/\|subsong:\d+$/i, '')
}

function normalizedPath(path: string) {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) return path
  return path.replaceAll('/', '\\').toLocaleLowerCase('en-US')
}

export function trackSubsong(track: TrackIdentity) {
  const source = track.fullPath || track.path || ''
  return Number(track.subsong ?? source.match(/\|subsong:(\d+)$/i)?.[1] ?? 0)
}

export function playablePath(track: TrackIdentity) {
  const source = track.fullPath || track.path || track.absolutePath || ''
  if (!source || /\|subsong:\d+$/i.test(source)) return source
  const subsong = trackSubsong(track)
  return subsong > 0 ? `${source}|subsong:${subsong}` : source
}

export function trackKey(track: TrackIdentity | null | undefined) {
  if (!track) return ''
  return `${normalizedPath(basePath(track))}\u0000${trackSubsong(track)}`
}

export function isSameTrack(left: DisplayTrack | null, right: DisplayTrack | null) {
  if (!left || !right) return false
  return trackKey(left) === trackKey(right)
}

export function albumKey(album: { name?: string; artist?: string }) {
  return `${album.name?.trim().toLocaleLowerCase() ?? ''}\u0000${album.artist?.trim().toLocaleLowerCase() ?? ''}`
}
