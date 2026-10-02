import { bridge, fb } from 'foo-webview-sdk'

export async function pickImageFile(title: string) {
  // SDK 1.12 declares string[]; the host actually expects filter objects.
  const picked = await bridge.invoke<Awaited<ReturnType<typeof fb.dialog.openFile>>>('dialog.openFile', {
    title, multiple: false,
    filters: [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  })
  if (picked.error) throw new Error(`图片选择器：${picked.error}`)
  const path = picked.filePaths?.[0]
  if (picked.canceled || !path) return null
  if (!/\.(jpe?g|png|webp)$/i.test(path)) throw new Error('请选择 JPG、PNG 或 WebP 图片。')
  const bytes = await fb.file.readBinary(path)
  if (bytes.length > 8_000_000) throw new Error('请选择小于 8MB 的图片。')
  return { path, bytes }
}
