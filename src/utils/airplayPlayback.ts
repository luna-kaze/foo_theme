import { reactive } from 'vue'
import type { DisplayTrack } from '../types/music'

export function airplayPath(track: { absolutePath?: string; path?: string; id?: string } | null | undefined) {
  for (const value of [track?.absolutePath, track?.path, track?.id]) {
    const path = value?.replace(/\|subsong:0$/i, '') ?? ''
    if (/^airplay:\/\/live\/[1-9]\d*$/.test(path)) return path
  }
  return ''
}
type Snapshot = { track: DisplayTrack | null; position?: number; duration?: number; receiving?: boolean }
type Dependencies = {
  read: () => Promise<Snapshot>
  artwork: (path: string) => Promise<string>
  validateArtwork?: (url: string) => Promise<boolean>
  enter: () => Promise<boolean>
  leave: (track: DisplayTrack) => Promise<void>
  publish: (track: DisplayTrack, artwork: string, history: DisplayTrack[], position?: number) => void
  command: (direction: number, path: string) => Promise<boolean>
  notify: (message: string) => void
}

/** A stopped decoder is not evidence that the remote session or its presentation ended. */
export function createAirplayPlayback(deps: Dependencies) {
  const state = reactive({ active: false, phase: 'live' as 'live' | 'handover' | 'stopped', path: '', pending: false, direction: 0, confirmedDirection: 0, artworkRevision: 0, artworkPending: false, message: '', history: [] as DisplayTrack[] })
  let epoch = 0, metadataRevision = 0, commandRevision = 0, sourceRevision = 0
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let refreshDue = 0, stoppedUntil = 0, intentUntil = 0, intentDirection = 0
  let entry: Promise<boolean> | null = null, serial: Promise<unknown> = Promise.resolve()
  let current: DisplayTrack | null = null, currentArtwork = '', currentArtworkPath = ''
  let imageBusySource = -1, imageAttempts = 0, lastPosition = 0, commandPosition = 0
  let decoderHeldStopped = false
  function stop() {
    epoch++; metadataRevision++; sourceRevision++; commandRevision++
    if (refreshTimer) clearTimeout(refreshTimer)
    if (pendingTimer) clearTimeout(pendingTimer)
    refreshTimer = pendingTimer = null; entry = null; current = null; currentArtwork = ''; currentArtworkPath = ''
    intentUntil = 0; intentDirection = 0; imageBusySource = -1
    decoderHeldStopped = false
    Object.assign(state, { active: false, phase: 'stopped', path: '', pending: false, direction: 0, confirmedDirection: 0, artworkPending: false, message: '', history: [] })
  }
  function publish(position?: number) {
    if (!current) return
    const track = { ...current, artworkUrl: currentArtwork, playbackId: `airplay:${state.path}`, sourceIndex: state.history.length }
    deps.publish(track, currentArtwork, [...state.history, track], position)
  }
  async function fetchArtwork() {
    const owner = epoch, source = sourceRevision, path = state.path
    if (!state.active || imageBusySource === source) return
    imageBusySource = source
    try {
      const image = await deps.artwork(path)
      const valid = Boolean(image) && (!deps.validateArtwork || await deps.validateArtwork(image))
      // Metadata edits for the SAME URI must not discard a valid slow image.
      if (owner !== epoch || source !== sourceRevision || path !== state.path || !state.active) return
      imageAttempts++
      if (valid) {
        const changed = image !== currentArtwork || currentArtworkPath !== path || state.artworkPending
        currentArtwork = image; currentArtworkPath = path; state.artworkPending = false
        if (changed) { state.artworkRevision++; publish() }
      } else state.artworkPending = true
      // Empty/transient/error responses never erase a previously decoded image.
    } catch { if (owner === epoch && source === sourceRevision) { imageAttempts++; state.artworkPending = true } }
    finally { if (imageBusySource === source) imageBusySource = -1 }
  }
  async function accept(snapshot: Snapshot) {
    const path = airplayPath(snapshot.track)
    if (!snapshot.track || !path) return
    const changed = state.path !== path
    if (!state.active) { state.active = true; epoch++; entry = deps.enter() }
    const owner = epoch
    metadataRevision++
    if (changed && current) state.history = [...state.history, { ...current, artworkUrl: currentArtworkPath === airplayPath(current) ? currentArtwork : '', playbackId: `airplay:${airplayPath(current)}`, sourceIndex: state.history.length }].slice(-6)
    if (changed) {
      sourceRevision++; imageAttempts = 0; state.artworkPending = true
      state.confirmedDirection = intentUntil > Date.now() ? intentDirection : 0
      intentUntil = 0; intentDirection = 0
      state.pending = false; state.message = ''; commandRevision++
      if (pendingTimer) clearTimeout(pendingTimer)
      pendingTimer = null
    }
    state.path = path
    if (changed || snapshot.receiving) decoderHeldStopped = false
    if (changed || state.phase !== 'stopped' || snapshot.receiving) state.phase = 'live'
    current = { ...snapshot.track, path, absolutePath: path, title: snapshot.track.title || 'AirPlay 实时音频', duration: snapshot.duration ?? snapshot.track.duration }
    publish(snapshot.position)
    if (snapshot.position != null) lastPosition = snapshot.position
    const ready = await entry
    if (!ready || owner !== epoch || !state.active || state.path !== path) return
    await fetchArtwork()
  }
  async function refresh() {
    if (!state.active) return
    const owner = epoch, request = ++metadataRevision
    try {
      const snapshot = await deps.read()
      if (owner !== epoch || request !== metadataRevision || !state.active || !snapshot.track) return
      if (!airplayPath(snapshot.track)) { stop(); await deps.leave(snapshot.track); return }
      await accept(snapshot)
    } catch { /* Null handles, stop/start and temporary transport errors preserve presentation. */ }
  }
  function schedule(delay: number) {
    if (!state.active) return
    const due = Date.now() + delay
    if (refreshTimer && refreshDue <= due) return
    if (refreshTimer) clearTimeout(refreshTimer)
    const owner = epoch
    refreshDue = due
    refreshTimer = setTimeout(async () => {
      refreshTimer = null
      await refresh()
      if (!state.active || owner !== epoch) return
      if (state.phase === 'stopped' && Date.now() >= stoppedUntil) return
      const next = state.artworkPending ? [350, 800, 1500, 2500][Math.min(imageAttempts, 3)]! : 5000
      schedule(next)
    }, delay)
  }
  function reconcile() { schedule(100) }
  function beginIntent(direction: number) {
    intentDirection = direction < 0 ? -1 : 1; intentUntil = Date.now() + 6000
    state.direction = intentDirection; state.pending = true; state.phase = 'handover'
    commandPosition = lastPosition
    state.message = '等待 AirPlay 发送端更新曲目'
    const request = ++commandRevision, owner = epoch
    if (pendingTimer) clearTimeout(pendingTimer)
    pendingTimer = setTimeout(() => {
      if (!state.active || owner !== epoch || request !== commandRevision) return
      if (!state.pending) { intentUntil = 0; intentDirection = 0; if (decoderHeldStopped) { state.phase = 'stopped'; stoppedUntil = Date.now() }; return }
      state.pending = false; intentUntil = 0; intentDirection = 0
      if (decoderHeldStopped) { state.phase = 'stopped'; stoppedUntil = Date.now() }
      state.message = '发送端尚未更新曲目，已保留最近封面'
    }, 6000)
    return request
  }
  function recordStarting(direction: number) {
    if (!state.active) return
    // Observing native Next/Previous must NOT send a second DACP command.
    if (!(state.pending && intentUntil > Date.now() && state.direction === (direction < 0 ? -1 : 1))) beginIntent(direction)
    reconcile()
  }
  function decoderStopped() {
    if (!state.active) return
    metadataRevision++
    decoderHeldStopped = true
    state.phase = intentUntil > Date.now() ? 'handover' : 'stopped'
    stoppedUntil = Date.now() + 6000
    if (state.phase === 'stopped') { state.pending = false; state.message = '已停止接收 · 保留最近曲目与封面' }
    reconcile()
  }
  function remote(direction: number) {
    const owner = epoch
    const task = serial.catch(() => {}).then(async () => {
      if (!state.active || owner !== epoch || !await entry || owner !== epoch) return false
      const vacantAllowed = state.phase === 'handover' && intentUntil > Date.now()
      const previousPhase = state.phase
      const request = beginIntent(direction)
      try {
        const success = await deps.command(direction, vacantAllowed ? state.path : '')
        if (!success && owner === epoch && request === commandRevision) {
          state.pending = false; intentUntil = 0; state.message = '未能发送 AirPlay 切歌请求，已保留封面'
          state.phase = previousPhase
          if (pendingTimer) clearTimeout(pendingTimer)
          pendingTimer = null
        }
        if (success && owner === epoch) reconcile()
        return success
      } catch (error) {
        if (owner === epoch && request === commandRevision) {
          state.pending = false; intentUntil = 0; state.message = 'AirPlay 切歌请求失败，已保留封面'
          state.phase = previousPhase
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
      state.pending = false; state.message = 'AirPlay 发送端已更新播放位置'
      // Keep direction until a generation change or expiry, not just a time reset.
    }
  }
  function artworkFailed() { if (state.active) { state.artworkPending = true; reconcile() } }
  return { state, accept, refresh, reconcile, remote, observePosition, recordStarting, decoderStopped, artworkFailed, stop, dispose: stop }
}

export function decodeAirplayArtwork(source: string): Promise<boolean> {
  if (!source || typeof Image === 'undefined') return Promise.resolve(false)
  return new Promise(resolve => {
    const image = new Image()
    let done = false
    const finish = (valid: boolean) => { if (done) return; done = true; clearTimeout(timer); image.onload = image.onerror = null; resolve(valid) }
    const timer = setTimeout(() => finish(false), 3500)
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0)
    image.onerror = () => finish(false)
    image.decoding = 'async'; image.src = source
    if (image.decode) void image.decode().then(() => finish(image.naturalWidth > 0 && image.naturalHeight > 0)).catch(() => finish(false))
  })
}
