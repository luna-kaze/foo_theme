import { reactive } from 'vue'
import fb from 'foo-webview-sdk'
import type { DisplayTrack } from '../types/music'
import { playablePath, trackKey } from '../utils/track'
import { shuffleIndices } from '../utils/shuffleOrder'

export type PlaybackMode = 0 | 1 | 2
type Buffer = { name: string; index: number; tracks: DisplayTrack[] }
type Bridge = { name: string; item: number }
type Snapshot = { sourceName: string; base: DisplayTrack[]; order: DisplayTrack[]; index: number; external: boolean }
type Dependencies = {
  connected: () => boolean
  owner: () => Promise<string>
  tracks: (index: number) => Promise<DisplayTrack[]>
  publish: () => void
  notify: (message: string, tone?: 'info' | 'success' | 'error') => void
}

export function createPlaybackWorkspace(deps: Dependencies) {
  const status = reactive({ ready: false, mode: 0 as PlaybackMode, busy: false, pending: false, staged: false, revision: 0, sourceName: '' })
  let actual: Buffer | null = null
  let planned: Buffer | null = null
  let bridge: Bridge | null = null
  let canonical: DisplayTrack[] = []
  let deferred: { tracks: DisplayTrack[]; base: DisplayTrack[]; mode: PlaybackMode; restoreOrder?: boolean } | null = null
  let serial: Promise<unknown> = Promise.resolve()
  let ownedStop = false
  let actualPosition = -1
  let external = false
  const key = 'foo-theme.playback-workspace.v1'

  function transaction(run: () => Promise<void>) {
    const task = serial.catch(() => {}).then(async () => {
      status.busy = true
      deps.publish()
      try { await run(); return true } catch (error) { deps.notify(error instanceof Error ? error.message : '播放计划更新失败。', 'error'); return false }
      finally { status.busy = false; deps.publish() }
    })
    serial = task
    return task
  }
  async function locate(name: string) {
    const lists = await fb.playlist.getAll()
    const found = lists.filter((list) => list.name === name)
    if (found.length > 1 || found[0]?.isLocked || found[0]?.isAutoplaylist) throw new Error('隐藏播放缓冲不唯一或不可写。')
    return found[0]?.index ?? -1
  }
  async function buffer(letter: 'A' | 'B') {
    const name = `正在播放 ${letter} [foo-theme:${await deps.owner()}]`
    let index = await locate(name)
    if (index < 0) index = (await fb.playlist.create(name)).index
    if (!Number.isInteger(index) || index < 0) throw new Error('无法创建隐藏播放缓冲。')
    return { name, index, tracks: [] } as Buffer
  }
  function identify(tracks: DisplayTrack[]) {
    return tracks.map((track) => ({ ...track, playbackId: `work:${crypto.randomUUID()}`, playbackPlaceholder: false }))
  }
  function indexed(target: Buffer) {
    return target.tracks.map((track, index) => ({ ...track, sourceIndex: index, playbackPlaylistIndex: target.index }))
  }
  async function location() {
    if (!deps.connected()) return { name: actual?.name ?? '', index: actual ? activeDemoIndex : -1 }
    const [playing, track, lists] = await Promise.all([fb.player.getPlayingPlaylist(), fb.player.getCurrentTrackIndex(), fb.playlist.getAll()])
    return { name: lists.find((list) => list.index === playing.playlist)?.name ?? '', index: track.index ?? -1 }
  }
  let activeDemoIndex = 0
  async function save() {
    if (!deps.connected() || !actual) return
    try {
      await fb.config.set(key, {
        mode: status.mode, sourceName: status.sourceName, actual: actual.name, planned: planned?.name ?? '', bridge, ownedStop,
        seed: actualPosition < 0 && !planned && bridge?.name === actual.name,
        actualIds: actual.tracks.map((track) => track.playbackId), actualKeys: actual.tracks.map(trackKey),
        plannedIds: planned?.tracks.map((track) => track.playbackId) ?? [], plannedKeys: planned?.tracks.map(trackKey) ?? [],
        base: canonical,
        queuedIds: [...actual.tracks, ...planned?.tracks ?? [], ...deferred?.tracks ?? []].filter((track) => track.playbackQueued).map((track) => track.playbackId),
        deferred,
      })
    } catch { /* Playback never depends on preference storage succeeding. */ }
  }
  function publish(reordered = false) {
    status.pending = Boolean(planned)
    status.staged = Boolean(deferred)
    if (reordered) status.revision += 1
    deps.publish()
  }
  async function removeBridge() {
    if (!bridge || !deps.connected()) { bridge = null; return }
    const index = await locate(bridge.name)
    if (index < 0) { bridge = null; return }
    const queue = await fb.queue.get()
    const position = queue.items.findIndex((item) => item.playlist === index && item.playlistItem === bridge!.item)
    if (position >= 0) {
      const result = await fb.queue.remove(position)
      if (result.success === false) throw new Error(result.error || '无法撤回旧的下一首登记。')
    }
    bridge = null
  }
  async function fill(target: Buffer, tracks: DisplayTrack[]) {
    if (!deps.connected()) { target.tracks = tracks; return }
    target.index = await locate(target.name)
    if (target.index < 0) throw new Error('隐藏播放缓冲已不存在，当前播放已保留。')
    const playing = await fb.player.getPlayingPlaylist()
    if (target.index === playing.playlist) throw new Error('目标缓冲正在播放，未覆盖当前歌曲。')
    const queued = await fb.queue.get()
    if (queued.items.some((item) => item.playlist === target.index)) throw new Error('目标缓冲已被下一曲引用，修改待切歌后应用。')
    if (target.index === (await fb.player.getPlayingPlaylist()).playlist) throw new Error('目标缓冲已开始播放，未覆盖当前歌曲。')
    const cleared = await fb.playlist.clear(target.index)
    if (cleared.success === false) throw new Error(cleared.error || '无法准备播放计划。')
    if (tracks.length) {
      const added = await fb.playlist.add(target.index, tracks.map(playablePath))
      if (added.success === false || added.addedCount !== tracks.length) throw new Error('计划未完整写入，当前播放已保留。')
      const copied = await deps.tracks(target.index)
      if (copied.length !== tracks.length || copied.some((track, index) => trackKey(track) !== trackKey(tracks[index]))) throw new Error('计划条目顺序不一致。')
    }
    target.tracks = tracks
  }
  async function nativeMode(mode: PlaybackMode) {
    if (!deps.connected()) return
    const result = await fb.player.setOrder(mode)
    if (result.success === false) throw new Error(result.error || '无法切换播放模式。')
  }
  async function stopAtBoundary(enabled: boolean) {
    if (!deps.connected()) return
    if (enabled && !(await fb.player.getStopAfterCurrent()).enabled) {
      const result = await fb.player.setStopAfterCurrent(true)
      if (result.success === false) throw new Error(result.error || '无法在计划末尾停止。')
      ownedStop = true
    } else if (!enabled && ownedStop) {
      const result = await fb.player.setStopAfterCurrent(false)
      if (result.success === false) throw new Error(result.error || '无法恢复计划播放。')
      ownedStop = false
    }
  }
  async function restoreScheduling(previousPlan: Buffer | null, previousBridge: Bridge | null) {
    if (!deps.connected()) { bridge = previousBridge; return }
    if (previousPlan) {
      previousPlan.index = await locate(previousPlan.name)
      if (previousPlan.index >= 0 && previousPlan.index !== (await fb.player.getPlayingPlaylist()).playlist) {
        const copied = await deps.tracks(previousPlan.index)
        if (copied.length !== previousPlan.tracks.length || copied.some((track, index) => trackKey(track) !== trackKey(previousPlan.tracks[index]))) await fill(previousPlan, previousPlan.tracks)
      }
    }
    if (!previousBridge) return
    const index = await locate(previousBridge.name)
    if (index < 0 || index === (await fb.player.getPlayingPlaylist()).playlist) return
    const queued = await fb.queue.add({ playlist: index, track: previousBridge.item })
    if (queued.success === false) throw new Error(queued.error || '无法恢复原计划下一首。')
    bridge = previousBridge
  }
  async function stage(tracks: DisplayTrack[], base: DisplayTrack[], mode: PlaybackMode, restoreOrder: boolean) {
    if (status.mode !== mode) await nativeMode(mode)
    deferred = { tracks, base, mode, restoreOrder }
    status.mode = mode
    publish(); await save()
  }
  async function commit(tracks: DisplayTrack[], base: DisplayTrack[], mode: PlaybackMode, restoreOrder = false) {
    if (!actual) throw new Error('请先选择曲目开始播放。')
    let live = await location()
    if (planned && live.name === planned.name) {
      actual = planned; planned = null; bridge = null
      tracks = deferredOrder({ tracks, base, mode, restoreOrder }, live.index)
    }
    external = live.name !== actual.name && live.name !== planned?.name
    if (!external) actualPosition = live.index
    const seeded = live.index < 0 && (!planned && bridge?.name === actual.name || !deps.connected())
    if (live.name !== actual.name && !seeded) { await stage(tracks, base, mode, restoreOrder); return }
    // Only our own scheduling reference is retractable. Other native queue
    // references keep the buffer immutable, while the editor remains writable.
    if (planned && deps.connected()) {
      planned.index = await locate(planned.name)
      const queue = await fb.queue.get()
      const own = bridge?.name === planned.name ? queue.items.findIndex((item) => item.playlist === planned!.index && item.playlistItem === bridge!.item) : -1
      if (queue.items.some((item, index) => item.playlist === planned!.index && index !== own)) { await stage(tracks, base, mode, restoreOrder); return }
    }
    const previousPlan = planned
    const previousBridge = bridge
    const previousMode = status.mode
    const previousStop = ownedStop
    if ((planned || seeded) && bridge) {
      await removeBridge()
      live = await location()
      if (planned && live.name === planned.name) {
        actual = planned; planned = null
        tracks = deferredOrder({ tracks, base, mode, restoreOrder }, live.index)
      }
      if (!seeded && live.name !== actual.name) {
        await restoreScheduling(null, previousBridge)
        await stage(tracks, base, mode, restoreOrder); return
      }
      actualPosition = live.index
    }
    const currentId = actual.tracks[live.index]?.playbackId
    let current = tracks.findIndex((track) => track.playbackId === currentId)
    // Do not remove the decoder's item; if absent, keep it as this cycle's anchor.
    if (current < 0 && actual.tracks[live.index]) {
      tracks = [actual.tracks[live.index], ...tracks]
      current = 0
    }
    const target = deps.connected() ? await buffer(actual.name.includes('正在播放 A ') ? 'B' : 'A') : { name: actual.name === 'demo:A' ? 'demo:B' : 'demo:A', index: -1, tracks: [] }
    if (deps.connected() && (await fb.queue.get()).items.some((item) => item.playlist === target.index)) {
      if (previousBridge && !bridge) await restoreScheduling(null, previousBridge)
      await stage(tracks, base, mode, restoreOrder); return
    }
    try {
      await fill(target, tracks)
      const latest = await location()
      const latestId = actual.tracks[latest.index]?.playbackId
      current = target.tracks.findIndex((track) => track.playbackId === latestId)
      if (!seeded && (latest.name !== actual.name || current < 0)) throw new Error('播放位置已变化，请重新修改计划。')
      if (seeded) current = -1
      const next = current + 1 < target.tracks.length ? current + 1 : mode === 1 ? 0 : -1
      await nativeMode(mode)
      await stopAtBoundary(next < 0 && mode !== 2)
      if (deps.connected() && next >= 0 && (mode !== 2 || seeded)) {
        const added = await fb.queue.add({ playlist: target.index, track: next })
        if (added.success === false) throw new Error(added.error || '无法登记计划下一首。')
        bridge = { name: target.name, item: next }
      }
    } catch (error) {
      await restoreScheduling(previousPlan?.name === target.name ? previousPlan : null, previousBridge)
      await nativeMode(previousMode)
      await stopAtBoundary(previousStop)
      throw error
    }
    if (seeded) { actual = target; planned = null; actualPosition = -1; external = false }
    else planned = target
    deferred = null
    canonical = base
    status.mode = mode
    publish(true)
    await save()
  }
  function deferredOrder(next: NonNullable<typeof deferred>, index: number) {
    if (next.restoreOrder) return next.tracks
    const history = actual!.tracks.slice(0, index + 1)
    const ids = new Set(history.map((track) => track.playbackId))
    return [...history, ...next.tracks.filter((track) => !ids.has(track.playbackId))]
  }
  async function syncInternal() {
    if (!actual) return
    const live = await location()
    external = live.name !== actual.name && live.name !== planned?.name
    if (!external) actualPosition = live.index
    if (bridge?.name === actual.name && live.name === actual.name && live.index >= 0) bridge = null
    if (planned && live.name === planned.name) {
      actual = planned; planned = null; bridge = null
      publish()
      if (deferred) {
        const next = deferred
        await commit(deferredOrder(next, live.index), next.base, next.mode, next.restoreOrder)
      } else await save()
    } else if (live.name === actual.name && deferred) {
      const next = deferred
      await commit(deferredOrder(next, live.index), next.base, next.mode, next.restoreOrder)
    } else if (live.name !== actual.name && !planned && !bridge) {
      status.ready = false
      publish()
    }
    if (actual && deps.connected()) actual.index = await locate(actual.name)
    if (planned && deps.connected()) planned.index = await locate(planned.name)
  }
  async function startInternal(tracks: DisplayTrack[], index: number, sourceName: string, mode: PlaybackMode, random = false) {
    if (!tracks.length || !tracks[index]) throw new Error('没有可播放的曲目。')
    const entries = identify(tracks)
    const chosen = entries[index]
    const order = random ? shuffleIndices(entries.length, index).map((position) => entries[position]) : entries
    const playIndex = order.findIndex((track) => track.playbackId === chosen.playbackId)
    const previousBridge = bridge
    const previousPlan = planned ?? (bridge?.name === actual?.name ? actual : null)
    const previousStop = ownedStop
    await removeBridge()
    await stopAtBoundary(false)
    let target: Buffer
    try {
      if (deps.connected()) {
        const [a, b, playing] = await Promise.all([buffer('A'), buffer('B'), fb.player.getPlayingPlaylist()])
        target = playing.playlist === a.index ? b : a
        await fill(target, order)
        await nativeMode(mode)
        const played = await fb.playlist.playTrack(target.index, playIndex)
        if (played.success === false) throw new Error(played.error || '无法播放所选曲目。')
      } else {
        target = { name: 'demo:A', index: -1, tracks: order }
        activeDemoIndex = playIndex
      }
    } catch (error) {
      if (deps.connected() && previousPlan) {
        try {
          await restoreScheduling(previousPlan, previousBridge)
          await nativeMode(status.mode)
          await stopAtBoundary(previousStop)
        } catch (restoreError) {
          throw new Error(`${error instanceof Error ? error.message : '播放失败'}；原计划恢复失败：${restoreError instanceof Error ? restoreError.message : '请重新选择播放曲目。'}`)
        }
      }
      throw error
    }
    actual = target; planned = null; deferred = null; canonical = entries
    actualPosition = playIndex; external = false
    status.ready = true; status.sourceName = sourceName; status.mode = mode
    publish(true)
    await save()
  }
  function projection(index: number, edited = false): Snapshot | null {
    const current = actual?.tracks[external ? actualPosition : index]
    const target = edited && deferred ? { name: 'editor', index: -1, tracks: deferred.tracks } : planned ?? actual
    if (!status.ready || !actual || !target) return null
    if (!current) return { sourceName: status.sourceName, base: canonical, order: indexed(target), index: -1, external }
    const order = indexed(target)
    const focused = order.findIndex((track) => track.playbackId === current.playbackId)
    return { sourceName: status.sourceName, base: canonical, order, index: focused >= 0 ? focused : 0, external }
  }
  async function setModeInternal(mode: PlaybackMode) {
    await syncInternal()
    const previousMode = status.mode
    const previousBridge = bridge
    const previousStop = ownedStop
    try {
      if (mode === 2 && planned) await removeBridge()
      await nativeMode(mode)
      if (planned && mode !== 2 && actual) {
        const live = await location()
        const id = actual.tracks[external ? actualPosition : live.index]?.playbackId
        const current = planned.tracks.findIndex((track) => track.playbackId === id)
        const next = current + 1 < planned.tracks.length ? current + 1 : mode === 1 ? 0 : -1
        if (bridge && (bridge.name !== planned.name || bridge.item !== next)) await removeBridge()
        await stopAtBoundary(next < 0)
        if (deps.connected() && next >= 0 && !bridge) {
          planned.index = await locate(planned.name)
          if (planned.index < 0) throw new Error('计划缓冲已不存在。')
          const result = await fb.queue.add({ playlist: planned.index, track: next })
          if (result.success === false) throw new Error(result.error || '无法登记计划下一首。')
          bridge = { name: planned.name, item: next }
        }
      } else await stopAtBoundary(false)
    } catch (error) {
      if (previousBridge && !bridge) await restoreScheduling(null, previousBridge)
      await nativeMode(previousMode)
      await stopAtBoundary(previousStop)
      throw error
    }
    status.mode = mode
    if (deferred) deferred.mode = mode
    publish(); await save()
  }
  function reorderPlan(restoreOrder: boolean) {
    return transaction(async () => {
      await syncInternal()
      if (!actual) throw new Error('请先选择曲目开始播放。')
      const live = await location()
      const target = deferred?.tracks ?? planned?.tracks ?? actual.tracks
      const id = actual.tracks[external ? actualPosition : live.index]?.playbackId
      const current = target.findIndex((track) => track.playbackId === id)
      const base = deferred?.base ?? canonical
      const positions = new Map(base.map((track, index) => [track.playbackId, index]))
      const rest = target.slice(current + 1)
      const ordered = restoreOrder ? [...target].sort((a, b) => (positions.get(a.playbackId) ?? 0) - (positions.get(b.playbackId) ?? 0))
        : [...target.slice(0, current + 1), ...shuffleIndices(rest.length).map((index) => rest[index])]
      if (!deferred && ordered.every((track, index) => track.playbackId === target[index]?.playbackId)) return
      await commit(ordered, base, status.mode, restoreOrder || deferred?.restoreOrder)
    })
  }
  function edit(run: (order: DisplayTrack[], index: number) => DisplayTrack[], added: DisplayTrack[] = []) {
    return transaction(async () => {
      await syncInternal()
      if (!actual) throw new Error('请先选择曲目开始播放。')
      const live = await location()
      const target = deferred?.tracks ?? planned?.tracks ?? actual.tracks
      const id = actual.tracks[external ? actualPosition : live.index]?.playbackId
      const index = target.findIndex((track) => track.playbackId === id)
      if (index < 0 && !(live.index < 0 && (bridge?.name === actual.name || !deps.connected()))) throw new Error('无法定位当前播放条目。')
      const next = run([...target], index)
      await commit(next, [...(deferred?.base ?? canonical), ...added], deferred?.mode ?? status.mode, deferred?.restoreOrder)
    })
  }
  return {
    status,
    setMode: (mode: PlaybackMode) => transaction(() => setModeInternal(mode)),
    start: (tracks: DisplayTrack[], index: number, name: string, mode: PlaybackMode = status.mode, random = false) => transaction(() => startInternal(tracks, index, name, mode, random)),
    sync: () => transaction(syncInternal),
    projection,
    locationName: () => actual?.name ?? '',
    bridge: () => bridge,
    contains: (name: string) => name === actual?.name || name === planned?.name,
    adopt: (tracks: DisplayTrack[], index: number, name: string, sourceName = name, demoIndex = 0, mode: PlaybackMode = status.mode) => transaction(async () => {
      actual = { name, index, tracks: identify(tracks) }
      canonical = actual.tracks; planned = null; deferred = null; bridge = null
      status.ready = true; status.sourceName = sourceName; status.mode = mode
      activeDemoIndex = demoIndex
      publish()
    }),
    seed: (tracks: DisplayTrack[]) => transaction(async () => {
      const entries = identify(tracks).map((track) => ({ ...track, playbackQueued: true }))
      const target = deps.connected() ? await buffer('A') : { name: 'demo:A', index: -1, tracks: [] }
      await fill(target, entries)
      if (deps.connected() && entries.length) { await fb.queue.add({ playlist: target.index, track: 0 }); bridge = { name: target.name, item: 0 } }
      actual = target; canonical = entries; planned = null; deferred = null; activeDemoIndex = -1
      actualPosition = -1; external = false
      status.ready = true; status.sourceName = '播放队列'
      publish(); await save()
    }),
    add: (tracks: DisplayTrack[], first = false) => {
      const entries = identify(tracks).map((track) => ({ ...track, playbackQueued: true }))
      return edit((order, index) => { order.splice(first ? index + 1 : order.length, 0, ...entries); return order }, entries)
    },
    shuffle: () => reorderPlan(false),
    restoreOrder: () => reorderPlan(true),
    remove: (ids: string[]) => edit((order, index) => order.filter((track, position) => position <= index || !ids.includes(track.playbackId ?? ''))),
    moveNext: (id: string) => edit((order, index) => {
      const position = order.findIndex((track) => track.playbackId === id)
      if (position <= index) return order
      const [track] = order.splice(position, 1)
      order.splice(index + 1, 0, track)
      return order
    }),
    clear: () => edit((order, index) => order.slice(0, index + 1)),
    next: () => transaction(async () => {
      await syncInternal()
      if (!actual) return
      if (deps.connected()) {
        if (planned && !bridge) {
          planned.index = await locate(planned.name)
          if (planned.index < 0) throw new Error('计划缓冲已不存在。')
          const live = await location()
          const id = actual.tracks[live.index]?.playbackId
          const current = planned.tracks.findIndex((track) => track.playbackId === id)
          const index = current + 1 < planned.tracks.length ? current + 1 : status.mode === 1 ? 0 : -1
          if (index < 0) return
          const result = await fb.queue.add({ playlist: planned.index, track: index })
          if (result.success === false) throw new Error(result.error || '无法登记下一首。')
          bridge = { name: planned.name, item: index }
        }
        await stopAtBoundary(false)
        await fb.player.next()
      } else {
        if (planned) { const id = actual.tracks[activeDemoIndex]?.playbackId; activeDemoIndex = planned.tracks.findIndex((track) => track.playbackId === id) + 1; actual = planned; planned = null; bridge = null }
        else activeDemoIndex += 1
        if (activeDemoIndex >= actual.tracks.length) activeDemoIndex = status.mode === 1 ? 0 : actual.tracks.length - 1
      }
      await syncInternal(); publish()
    }),
    demoIndex: () => activeDemoIndex,
    jump: (track: DisplayTrack) => transaction(async () => {
      if (!actual) return
      await syncInternal()
      if (deferred) throw new Error('最新计划正在等待宿主释放缓冲，请稍后播放该条目。')
      const target = planned ?? actual
      const index = target.tracks.findIndex((item) => item.playbackId === track.playbackId)
      if (index < 0) throw new Error('播放计划条目已变化。')
      await removeBridge()
      await stopAtBoundary(false)
      if (deps.connected()) target.index = await locate(target.name)
      if (deps.connected() && target.index < 0) throw new Error('计划缓冲已不存在。')
      if (deps.connected()) {
        const result = await fb.playlist.playTrack(target.index, index)
        if (result.success === false) throw new Error(result.error || '无法播放计划条目。')
      }
      else activeDemoIndex = index
      if (target === planned) { actual = planned; planned = null }
      await syncInternal(); publish()
    }),
    restore: async () => {
      if (!deps.connected()) return
      try {
        const saved = (await fb.config.get(key)).value as { mode: PlaybackMode; sourceName: string; actual: string; planned: string; bridge: Bridge | null; ownedStop?: boolean; seed?: boolean; actualIds: string[]; actualKeys: string[]; plannedIds: string[]; plannedKeys: string[]; queuedIds?: string[]; base: DisplayTrack[]; deferred?: typeof deferred } | null
        if (!saved?.actual || ![0, 1, 2, 3].includes(saved.mode)) return
        const suffix = `[foo-theme:${await deps.owner()}]`
        const ownedNames = [`正在播放 A ${suffix}`, `正在播放 B ${suffix}`]
        if (!ownedNames.includes(saved.actual) || saved.planned && (!ownedNames.includes(saved.planned) || saved.planned === saved.actual)) return
        const [playback, live, queue] = await Promise.all([fb.player.getState(), location(), fb.queue.get()])
        const savedBridgeIndex = saved.bridge && ownedNames.includes(saved.bridge.name) ? await locate(saved.bridge.name) : -1
        const queuedSeed = saved.seed && !saved.planned && saved.bridge?.name === saved.actual && queue.items.some((item) => item.playlist === savedBridgeIndex && item.playlistItem === saved.bridge!.item)
        const active = playback.state !== 'stopped' && live.index >= 0 && (live.name === saved.actual || live.name === saved.planned)
        if (!active && !queuedSeed) {
          if (saved.bridge && savedBridgeIndex >= 0) { bridge = saved.bridge; await removeBridge() }
          ownedStop = Boolean(saved.ownedStop)
          await stopAtBoundary(false)
          actual = null; planned = null; deferred = null; canonical = []
          status.ready = false; status.sourceName = ''; publish()
          await fb.config.set(key, null)
          return
        }
        const index = await locate(saved.actual)
        if (index < 0) return
        const tracks = await deps.tracks(index)
        if (!Array.isArray(saved.actualIds) || tracks.length !== saved.actualIds.length || new Set(saved.actualIds).size !== tracks.length || !saved.actualIds.every((id) => typeof id === 'string' && id.startsWith('work:')) || tracks.length !== saved.actualKeys.length || tracks.some((track, index) => trackKey(track) !== saved.actualKeys[index])) return
        actual = { name: saved.actual, index, tracks: tracks.map((track, index) => ({ ...track, playbackId: saved.actualIds[index] })) }
        planned = null
        if (saved.planned) {
          const next = await locate(saved.planned)
          if (next >= 0) {
            const tracks = await deps.tracks(next)
            if (tracks.length === saved.plannedIds.length && new Set(saved.plannedIds).size === tracks.length && saved.plannedIds.every((id) => typeof id === 'string' && id.startsWith('work:')) && tracks.length === saved.plannedKeys.length && tracks.every((track, index) => trackKey(track) === saved.plannedKeys[index])) planned = { name: saved.planned, index: next, tracks: tracks.map((track, index) => ({ ...track, playbackId: saved.plannedIds[index] })) }
          }
        }
        const all = [...actual.tracks, ...planned?.tracks ?? []]
        const validEntries = (entries: DisplayTrack[]) => Array.isArray(entries) && entries.every((track) => typeof track.path === 'string' && typeof track.playbackId === 'string' && track.playbackId.startsWith('work:') && typeof track.title === 'string' && typeof track.duration === 'number') && new Set(entries.map((track) => track.playbackId)).size === entries.length
        if (!validEntries(saved.base)) { actual = null; planned = null; return }
        canonical = saved.base
        deferred = saved.deferred && validEntries(saved.deferred.tracks) && validEntries(saved.deferred.base) && [0, 1, 2, 3].includes(saved.deferred.mode) ? saved.deferred : null
        for (const track of all) track.playbackQueued = saved.queuedIds?.includes(track.playbackId!) ?? false
        const currentQueue = await fb.queue.get()
        const candidate = saved.bridge
        const target = candidate && (planned?.name === candidate.name ? planned : actual.name === candidate.name ? actual : null)
        bridge = candidate && target?.tracks[candidate.item] && currentQueue.items.some((item) => item.playlist === target.index && item.playlistItem === candidate.item) ? candidate : null
        ownedStop = Boolean(saved.ownedStop)
        status.mode = Number(saved.mode) === 3 ? 0 : saved.mode; status.sourceName = saved.sourceName; status.ready = true
        if (deferred) deferred.mode = status.mode
        await syncInternal(); publish()
      } catch { /* Invalid saved data leaves native playback untouched. */ }
    },
  }
}
