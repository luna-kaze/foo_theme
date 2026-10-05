import fb, { type PlaylistInfo } from 'foo-webview-sdk'
import type { DisplayTrack } from '../types/music'
import { playablePath, trackKey } from './track'
import type { ExternalDropTarget } from './externalDrop'
import { isExcludedImport } from './importFilters'

export function createExternalImporter(deps: {
  owner: () => Promise<string>
  expand: (paths: string[]) => Promise<string[]>
  tracks: (index: number) => Promise<DisplayTrack[]>
  reorder: (order: number[]) => Promise<void>
  visible: () => PlaylistInfo[]
  refresh: (index?: number) => Promise<void>
  select: (index: number) => Promise<void>
  play: (tracks: DisplayTrack[], name: string) => Promise<boolean | void>
  fallback: (paths: string[]) => Promise<void>
}) {
  let serial: Promise<unknown> = Promise.resolve()
  async function check<T extends { success?: boolean; error?: string }>(action: Promise<T>) {
    const result = await action
    if (result.success === false) throw new Error(result.error || '导入操作失败。')
    return result
  }
  function importPaths(paths: string[], target: ExternalDropTarget): Promise<void> {
    const task = serial.catch(() => {}).then(async () => {
      if (target.kind === 'reject') throw new Error(target.reason)
      if (target.kind === 'open') { await deps.fallback(paths); return }
      const originalLists = await fb.playlist.getAll()
      const anchor = target.kind === 'create' ? target.anchor : 'playlist' in target ? target.playlist : null
      const original = anchor ? originalLists.find(list => list.index === anchor.index && list.name === anchor.name) : null
      if (anchor && !original) throw new Error('目标播放列表已变化，请重新拖放。')
      if (original && target.kind !== 'create' && (original.isLocked || original.isAutoplaylist)) throw new Error('目标播放列表不可写。')
      const originalTracks = target.kind === 'insert' ? await deps.tracks(target.playlist.index) : []
      if (target.kind === 'insert' && trackKey(originalTracks[target.sourceIndex]) !== target.key) throw new Error('目标歌曲已变化，请重新拖放。')
      const expanded = await deps.expand(paths)
      if (!expanded.length) throw new Error('拖入的项目中没有可读取的音频文件。')
      const name = `拖放解析 [foo-theme:${await deps.owner()}]`
      const all = await fb.playlist.getAll()
      const stages = all.filter(list => list.name === name)
      if (stages.length > 1 || stages[0]?.isLocked || stages[0]?.isAutoplaylist || stages[0]?.isPlaying) throw new Error('导入缓冲不可用。')
      if (!stages.length) await fb.playlist.create(name)
      async function stageIndex() {
        const matches = (await fb.playlist.getAll()).filter(list => list.name === name)
        if (matches.length !== 1 || matches[0]!.isPlaying || matches[0]!.isLocked || matches[0]!.isAutoplaylist) throw new Error('导入缓冲已变化或不可写。')
        const index = matches[0]!.index
        if ((await fb.queue.get()).items.some(item => item.playlist === index)) throw new Error('导入缓冲已被宿主队列引用。')
        return index
      }
      await check(fb.playlist.clear(await stageIndex()))
      try {
        for (let start = 0; start < expanded.length; start += 500) await check(fb.playlist.addSequential(await stageIndex(), expanded.slice(start, start + 500)))
        const resolved = await deps.tracks(await stageIndex())
        const tracks: DisplayTrack[] = []
        const checkedFiles = new Map<string, boolean>()
        for (const track of resolved) {
          let path = (track.absolutePath || track.path || '').replace(/\|subsong:\d+$/i, '')
          if (!path || isExcludedImport(path)) continue
          if (/^file:\/\//i.test(path)) {
            try { path = decodeURIComponent(path.replace(/^file:/i, '')) } catch { continue }
            path = path.replace(/^\/+([a-z]:)/i, '$1')
            if (path.startsWith('//')) path = path.replaceAll('/', '\\')
          }
          if (isExcludedImport(path)) continue
          if (/^[a-z]:[\\/]|^\\\\/i.test(path)) {
            const key = path.replaceAll('/', '\\').toLowerCase()
            if (!checkedFiles.has(key)) {
              const info = await fb.file.getInfo(path)
              checkedFiles.set(key, info.success !== false && info.exists && !info.isDirectory && info.isFile !== false)
            }
            if (!checkedFiles.get(key)) continue
          }
          tracks.push(track)
        }
        if (!tracks.length) throw new Error('没有解析出可播放的音轨。')
        if (target.kind === 'temporary') {
          if (await deps.play(tracks, '临时打开的音乐') === false) throw new Error('未能开始临时播放。')
          return
        }
        const currentLists = await fb.playlist.getAll()
        // SDK playlists have no stable ID. Refuse ambiguous reorders instead of writing to another list.
        if (originalLists.some(list => currentLists.find(item => item.index === list.index)?.name !== list.name)) throw new Error('解析期间播放列表顺序发生变化，请重新拖放。')
        if (target.kind === 'create') {
          const info = paths.length === 1 ? await fb.file.getInfo(paths[0]!) : null
          const base = paths.length === 1 ? paths[0]!.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1)! : '导入的音乐'
          const first = info?.isDirectory ? base : base.replace(/\.[^.]+$/, '')
          let createdName = first || '导入的音乐', suffix = 2
          while (createdName.trim().toLocaleLowerCase() === 'airplay' || currentLists.some(list => list.name === createdName)) createdName = `${first || '导入的音乐'} (${suffix++})`
          const created = await fb.playlist.create(createdName)
          let populated = false
          try {
            const added = await check(fb.playlist.addHandles(created.index, tracks.map(playablePath)))
            populated = added.addedCount > 0
            if (added.addedCount !== tracks.length) throw new Error(`只导入了 ${added.addedCount}/${tracks.length} 首曲目。`)
            await deps.refresh()
            const order = deps.visible().map(list => list.index).filter(index => index !== created.index)
            const position = target.anchor ? order.indexOf(target.anchor.index) + (target.after ? 1 : 0) : order.length
            if (target.anchor && !order.includes(target.anchor.index)) throw new Error('新建位置已变化。')
            order.splice(position, 0, created.index)
            const wantedNames = order.map(index => deps.visible().find(list => list.index === index)!.name)
            await deps.reorder(order)
            await deps.refresh()
            if (deps.visible().some((list, index) => list.name !== wantedNames[index])) throw new Error('新建歌单已导入，但未能移动到指定位置。')
            const located = deps.visible().find(list => list.name === createdName)
            if (located) await deps.select(located.index)
          } catch (error) {
            if (!populated) await fb.playlist.remove(created.index)
            throw error
          }
          return
        }
        const destination = currentLists.find(list => list.index === target.playlist.index && list.name === target.playlist.name)
        if (!destination || destination.isLocked || destination.isAutoplaylist) throw new Error('目标播放列表已失效或不可写。')
        let position = (await fb.playlist.getCount(destination.index)).count
        if (target.kind === 'insert') {
          const current = await deps.tracks(destination.index)
          if (current.length !== originalTracks.length || current.some((track, index) => trackKey(track) !== trackKey(originalTracks[index]))) throw new Error('解析期间目标歌曲顺序发生变化，请重新拖放。')
          position = target.sourceIndex + (target.after ? 1 : 0)
        }
        const added = await check(fb.playlist.insertTracks(destination.index, position, tracks.map(playablePath)))
        await deps.refresh(destination.index)
        if (added.addedCount !== tracks.length) throw new Error(`只插入了 ${added.addedCount}/${tracks.length} 首曲目。`)
      } finally {
        try { await fb.playlist.clear(await stageIndex()) } catch { /* Never clear a renamed, queued, locked or playing user buffer. */ }
      }
    })
    serial = task
    return task
  }
  return { importPaths }
}
