import type { DisplayTrack } from '../types/music'
import { playablePath, trackSubsong } from './track'
import fb from 'foo-webview-sdk'

/** Filesystem security checks receive the container path; track selection is separate. */
export function metadataLocation(track: DisplayTrack) {
  let path = playablePath(track).replace(/\|subsong:\d+$/i, '')
  if (/^file:\/\//i.test(path)) {
    const uri = new URL(path)
    const pathname = decodeURIComponent(uri.pathname)
    path = uri.hostname ? `\\\\${uri.hostname}${pathname.replaceAll('/', '\\')}` : pathname.replace(/^\/+([a-z]:)/i, '$1').replaceAll('/', '\\')
  }
  return { path, cueIndex: trackSubsong(track) }
}

function pathKey(path: string) { return path.replace(/^file:\/\//i, '').replace(/^\/+([a-z]:)/i, '$1').replaceAll('/', '\\').toLowerCase() }
export async function writeMetadataAndWait(track: DisplayTrack, tags: Record<string, string>) {
  const location = metadataLocation(track)
  if (!/^[a-z]:[\\/]|^\\\\/i.test(location.path)) throw new Error('标签编辑仅支持本地音频文件。')
  let outcome: { success: boolean; status: string } | null = null
  let complete: ((value: { success: boolean; status: string }) => void) | null = null
  const finished = new Promise<{ success: boolean; status: string }>(resolve => { complete = resolve })
  const unsubscribe = fb.on('metadata:writeComplete', event => {
    if (event.operation !== 'write' || event.subsong !== location.cueIndex || pathKey(event.path) !== pathKey(location.path)) return
    outcome = { success: event.success, status: event.status }; complete?.(outcome)
  })
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const response = await fb.metadata.write(location.path, tags, { cueIndex: location.cueIndex })
    if (!response.success) throw new Error(response.error || '未能写入曲目标签。')
    if (response.dispatched) {
      const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 30000) })
      const result = outcome ?? await Promise.race([finished, timeout])
      if (!result) throw new Error('标签写入尚未确认完成，请稍后刷新属性，不要重复保存。')
      if (!result.success) throw new Error(result.status === 'aborted' ? '标签写入已取消。' : '宿主未能完成标签写入。')
    }
    return response
  } finally { unsubscribe(); if (timer) clearTimeout(timer) }
}
