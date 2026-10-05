import { reactive } from 'vue'
import type { DisplayTrack } from '../types/music'

export function airplayPath(track: { absolutePath?: string; path?: string; id?: string } | null | undefined) {
  for (const value of [track?.absolutePath, track?.path, track?.id]) {
    const path = value?.replace(/\|subsong:0$/i, '') ?? ''
    if (/^airplay:\/\/live\/[1-9]\d*$/.test(path)) return path
  }
  return ''
}
type Snapshot = { track: DisplayTrack | null; position?: number; duration?: number }
type Dependencies = {
  read: () => Promise<Snapshot>
  artwork: (path: string) => Promise<string>
  enter: () => Promise<boolean>
  leave: (track: DisplayTrack) => Promise<void>
  publish: (track: DisplayTrack, artwork: string, history: DisplayTrack[], position?: number) => void
  command: (direction: number, path: string) => Promise<boolean>
  notify: (message: string) => void
}

/** Remote commands never preview/replay a URL; received snapshots own the screen. */
export function createAirplayPlayback(deps: Dependencies) {
  const state = reactive({ active: false, path: '', pending: false, direction: 0, message: '', history: [] as DisplayTrack[] })
  let epoch = 0, revision = 0, commandRevision = 0
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let entry: Promise<boolean> | null = null
  let serial: Promise<unknown> = Promise.resolve()
  let current: DisplayTrack | null = null, currentArtwork = '', currentArtworkPath = ''
  let artworkRequest = 0
  let emptyArtworkAttempts = 0, awaitingArtwork = false
  let lastPosition = 0, commandPosition = 0
  function stop() {
    epoch += 1; revision += 1; artworkRequest += 1; commandRevision += 1
    if (refreshTimer) clearTimeout(refreshTimer)
    if (pendingTimer) clearTimeout(pendingTimer)
    refreshTimer = pendingTimer = null; entry = null; current = null; currentArtwork = ''; currentArtworkPath = ''
    Object.assign(state, { active: false, path: '', pending: false, direction: 0, message: '', history: [] })
  }
  function publish(position?: number) {
    if (!current) return
    const track = { ...current, artworkUrl: currentArtwork, playbackId: `airplay:${state.path}`, sourceIndex: state.history.length }
    deps.publish(track, currentArtwork, [...state.history, track], position)
  }
  async function accept(snapshot: Snapshot) {
    const path = airplayPath(snapshot.track)
    if (!snapshot.track || !path) return
    const entering = !state.active
    const changed = state.path !== path
    if (entering) { state.active = true; epoch += 1; entry = deps.enter() }
    const owner = epoch, request = ++revision
    state.path = path
    if (changed) { emptyArtworkAttempts = 0; awaitingArtwork = true; if (!state.pending) state.direction = 0 }
    if (changed && current) state.history = [...state.history, { ...current, artworkUrl: currentArtworkPath === airplayPath(current) ? currentArtwork : '', playbackId: `airplay:${airplayPath(current)}`, sourceIndex: state.history.length }].slice(-6)
    current = { ...snapshot.track, path, absolutePath: path, title: snapshot.track.title || 'AirPlay 实时音频', duration: snapshot.duration ?? snapshot.track.duration }
    // Keep the outgoing image until the current stream's image arrives; never clear it just to reload.
    if (changed && state.pending) {
      state.pending = false; state.message = ''; commandRevision += 1
      if (pendingTimer) clearTimeout(pendingTimer)
      pendingTimer = null
    }
    publish(snapshot.position)
    if (snapshot.position != null) lastPosition = snapshot.position
    const ready = await entry
    if (!ready || owner !== epoch || !state.active || state.path !== path || request !== revision) return
    const imageRequest = ++artworkRequest
    try {
      const artwork = await deps.artwork(path)
      if (owner !== epoch || request !== revision || imageRequest !== artworkRequest || state.path !== path || !state.active) return
      if (artwork) { currentArtwork = artwork; currentArtworkPath = path; awaitingArtwork = false; publish() }
      else if (awaitingArtwork && ++emptyArtworkAttempts >= 3) { currentArtwork = ''; currentArtworkPath = path; awaitingArtwork = false; publish() }
    } catch { /* A late/retried cover must not blank the live presentation. */ }
  }
  async function refresh() {
    if (!state.active) return
    const owner = epoch, request = ++revision
    try {
      const snapshot = await deps.read()
      if (owner !== epoch || request !== revision || !state.active || !snapshot.track) return
      if (!airplayPath(snapshot.track)) { stop(); await deps.leave(snapshot.track); return }
      await accept(snapshot)
    } catch { /* Bounded reconciliation retries cover transient decoder handovers. */ }
  }
  function reconcile(attempt = 0) {
    if (refreshTimer) clearTimeout(refreshTimer)
    const owner = epoch
    refreshTimer = setTimeout(async () => {
      refreshTimer = null
      await refresh()
      if (state.active && owner === epoch && attempt < 3) reconcile(attempt + 1)
    }, attempt === 0 ? 100 : [0, 350, 800, 1400][attempt])
  }
  function remote(direction: number) {
    const path = state.path, owner = epoch
    const task = serial.catch(() => {}).then(async () => {
      if (!state.active || owner !== epoch || !path || !await entry || owner !== epoch) return false
      const request = ++commandRevision
      state.pending = true; state.direction = direction < 0 ? -1 : 1
      commandPosition = lastPosition
      state.message = '正在请求 AirPlay 发送端切歌'
      if (pendingTimer) clearTimeout(pendingTimer)
      pendingTimer = setTimeout(() => {
        if (!state.active || owner !== epoch || request !== commandRevision) return
        state.pending = false; state.message = '发送端尚未更新曲目，可再次手动操作'
      }, 6000)
      try {
        const success = await deps.command(direction, state.path)
        if (!success && owner === epoch && request === commandRevision) {
          state.pending = false; state.message = '未能发送 AirPlay 切歌请求'
          if (pendingTimer) clearTimeout(pendingTimer)
          pendingTimer = null
        }
        if (success && owner === epoch && request === commandRevision) state.message = '已发送切歌请求，等待 AirPlay 发送端'
        if (success && owner === epoch) reconcile()
        return success
      } catch (error) {
        if (owner === epoch && request === commandRevision) {
          state.pending = false; state.message = 'AirPlay 切歌请求失败'
          if (pendingTimer) clearTimeout(pendingTimer)
          pendingTimer = null
          deps.notify(error instanceof Error ? error.message : state.message)
        }
        return false
      }
    })
    serial = task
    return task
  }
  function observePosition(position: number) {
    if (!state.active || !Number.isFinite(position)) return
    lastPosition = position
    if (state.pending && state.direction < 0 && commandPosition > 2 && position <= 2) {
      state.pending = false; state.message = 'AirPlay 发送端已更新播放位置'; commandRevision += 1
      if (pendingTimer) clearTimeout(pendingTimer)
      pendingTimer = null
    }
  }
  return { state, accept, refresh, reconcile, remote, observePosition, stop, dispose: stop }
}
