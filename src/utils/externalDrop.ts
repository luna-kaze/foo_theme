export type DropPlaylist = { index: number; name: string }
export type ExternalDropTarget =
  | { kind: 'open' }
  | { kind: 'temporary' }
  | { kind: 'create'; anchor?: DropPlaylist; after?: boolean }
  | { kind: 'append'; playlist: DropPlaylist }
  | { kind: 'insert'; playlist: DropPlaylist; sourceIndex: number; key: string; after: boolean }
  | { kind: 'reject'; reason: string }

export function sidebarDropZone(y: number, top: number, height: number) {
  const edge = Math.min(10, height * .25)
  return y < top + edge ? 'before' : y > top + height - edge ? 'after' : 'append'
}

export function externalDropLabel(target: ExternalDropTarget) {
  if (target.kind === 'reject') return target.reason
  if (target.kind === 'temporary') return '临时加载并播放 · 不创建可见歌单'
  if (target.kind === 'create') return '在此新建播放列表'
  if (target.kind === 'append') return `添加到“${target.playlist.name}”末尾`
  if (target.kind === 'insert') return `插入“${target.playlist.name}”的歌曲${target.after ? '后' : '前'}`
  return '打开拖入的音乐'
}

/** HTML5 and native drop delivery have no guaranteed ordering. One session owns one import. */
export function createExternalDropSession(deps: {
  paths: (id?: string) => Promise<{ sessionId: string; paths: string[] }>
  execute: (paths: string[], target: ExternalDropTarget) => Promise<void>
  error: (error: unknown) => void
}) {
  let activeId = '', pending: { id: string; target: ExternalDropTarget } | null = null, disposed = false
  const completed = new Map<string, Promise<void>>()
  function begin(id: string) { activeId = id }
  function run(id: string, paths: string[], target: ExternalDropTarget) {
    if (disposed) return Promise.resolve()
    if (!id) { deps.error(new Error('未取得拖放会话，请重新拖入文件。')); return Promise.resolve() }
    const previous = completed.get(id)
    if (previous) return previous
    const task = Promise.resolve().then(async () => {
      if (disposed) return
      if (target.kind === 'reject') throw new Error(target.reason)
      const resolved = paths.length ? { sessionId: id, paths } : await deps.paths(id)
      if (resolved.sessionId !== id) throw new Error('拖放会话已变化，请重新拖入文件。')
      const finalPaths = resolved.paths
      if (disposed) return
      if (!finalPaths.length) throw new Error('未取得真实文件路径，请从资源管理器拖入文件或文件夹。')
      await deps.execute(finalPaths, target)
    }).catch(deps.error)
    completed.set(id, task)
    while (completed.size > 96) completed.delete(completed.keys().next().value!)
    return task
  }
  async function html(target: ExternalDropTarget) {
    const snapshot = { id: activeId, target }
    pending = snapshot
    try {
      const result = await deps.paths(snapshot.id || undefined)
      if (snapshot.id && result.sessionId !== snapshot.id) throw new Error('拖放会话已变化，请重新拖入文件。')
      if (!disposed) await run(result.sessionId, result.paths, target)
    } catch (error) { if (!disposed) deps.error(error) }
    finally { if (pending === snapshot) pending = null }
  }
  function native(event: { sessionId: string; paths: string[] }, target: ExternalDropTarget) {
    const resolved = pending && (!pending.id || pending.id === event.sessionId) ? pending.target : target
    return run(event.sessionId, event.paths, resolved)
  }
  return { begin, html, native, dispose: () => { disposed = true; pending = null; activeId = ''; completed.clear() } }
}
