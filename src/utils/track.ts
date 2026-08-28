import type { DisplayTrack } from '../types/music'

function trackLocator(track: DisplayTrack) {
  const suffix = track.path.match(/\|subsong:(\d+)$/i)
  const path = track.path.replace(/\|subsong:\d+$/i, '').toLocaleLowerCase()
  const subsong = Number(track.subsong ?? suffix?.[1] ?? 0)
  return `${path}\u0000${subsong}`
}

export function isSameTrack(left: DisplayTrack | null, right: DisplayTrack | null) {
  if (!left || !right) return false
  if (left.id != null && right.id != null) return left.id === right.id
  return trackLocator(left) === trackLocator(right)
}
