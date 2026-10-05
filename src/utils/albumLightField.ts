export type LightColor = { r: number; g: number; b: number }
export type AlbumLightField = { key: string; base: string; primary: string; secondary: string; palette: LightColor[]; fallback: boolean; disc?: HTMLCanvasElement }
type WeightedColor = LightColor & { weight: number }
const limit = (value: number, min = 0, max = 255) => Math.max(min, Math.min(max, value))
const distance = (a: LightColor, b: LightColor) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2

/** Histogram, not a spatial blur: the poster's face/text/layout never survives. */
export function extractLightPalette(pixels: ArrayLike<number>): LightColor[] {
  const bins = new Map<number, WeightedColor>()
  let red = 0, green = 0, blue = 0, count = 0
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3]! < 128) continue
    const r = pixels[index]!, g = pixels[index + 1]!, b = pixels[index + 2]!
    red += r; green += g; blue += b; count += 1
    const value = Math.max(r, g, b)
    if (value < 20 || Math.min(r, g, b) > 235) continue
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5)
    const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 }
    bin.r += r; bin.g += g; bin.b += b; bin.weight += 1
    bins.set(key, bin)
  }
  const candidates = [...bins.values()].map(color => ({ r: color.r / color.weight, g: color.g / color.weight, b: color.b / color.weight, weight: color.weight })).sort((a, b) => b.weight - a.weight)
  const palette: LightColor[] = []
  for (const color of candidates) {
    if (palette.every(other => distance(other, color) > 1800)) palette.push({ r: color.r, g: color.g, b: color.b })
    if (palette.length === 4) break
  }
  if (!palette.length) palette.push(count ? { r: red / count, g: green / count, b: blue / count } : { r: 80, g: 87, b: 94 })
  return palette
}

function lightColor(color: LightColor, brightness: number, saturation = 1.7): LightColor {
  const mean = color.r * .2126 + color.g * .7152 + color.b * .0722
  const channels = [color.r, color.g, color.b].map(value => limit(mean + (value - mean) * saturation))
  const maximum = Math.max(...channels, 1)
  const gain = brightness / maximum
  return { r: Math.round(channels[0]! * gain), g: Math.round(channels[1]! * gain), b: Math.round(channels[2]! * gain) }
}
function rgba(color: LightColor, alpha = 1) { return `rgba(${color.r},${color.g},${color.b},${alpha})` }
function canvas(width: number, height: number) {
  const element = document.createElement('canvas')
  element.width = width; element.height = height
  const context = element.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable')
  return { element, context }
}
function glow(context: CanvasRenderingContext2D, width: number, height: number, color: LightColor, x: number, y: number, scaleX: number, scaleY: number, opacity: number) {
  context.save(); context.translate(width * x, height * y); context.scale(width * scaleX, height * scaleY)
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1)
  gradient.addColorStop(0, rgba(color, opacity)); gradient.addColorStop(.3, rgba(color, opacity * .85))
  gradient.addColorStop(.7, rgba(color, opacity * .25)); gradient.addColorStop(1, rgba(color, 0))
  context.fillStyle = gradient; context.fillRect(-1, -1, 2, 2); context.restore()
}
export function renderAlbumLightField(key: string, palette: LightColor[], fallback = false): AlbumLightField {
  const main = palette[0]!, accent = palette[1] ?? main, third = palette[2] ?? accent
  const average = palette.reduce((sum, color) => ({ r: sum.r + color.r / palette.length, g: sum.g + color.g / palette.length, b: sum.b + color.b / palette.length }), { r: 0, g: 0, b: 0 })
  const baseColor = lightColor({ r: average.r * .78 + 30, g: average.g * .78 + 27, b: average.b * .78 + 25 }, 92, .65)
  const base = canvas(1024, 768)
  base.context.fillStyle = rgba(baseColor); base.context.fillRect(0, 0, 1024, 768)
  glow(base.context, 1024, 768, lightColor(main, 128, 1.5), .32, .78, .74, .65, .72)
  glow(base.context, 1024, 768, lightColor(accent, 120, 1.5), .85, .44, .8, .84, .56)
  glow(base.context, 1024, 768, lightColor(third, 82, .8), .08, .08, .9, .65, .38)
  const primary = canvas(512, 512), secondary = canvas(512, 512)
  glow(primary.context, 512, 512, lightColor(main, 142), .5, .5, .72, .72, .76)
  glow(secondary.context, 512, 512, lightColor(accent, 134), .5, .5, .72, .72, .63)
  return { key, base: base.element.toDataURL('image/png'), primary: primary.element.toDataURL('image/png'), secondary: secondary.element.toDataURL('image/png'), palette, fallback }
}
async function readPalette(source: string) {
  const image = new Image()
  image.crossOrigin = 'anonymous'; image.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Artwork load timed out')), 3000)
    image.onload = () => { clearTimeout(timer); resolve() }
    image.onerror = () => { clearTimeout(timer); reject(new Error('Artwork load failed')) }
    image.src = source
  })
  const sample = canvas(48, 48)
  sample.context.drawImage(image, 0, 0, 48, 48)
  return extractLightPalette(sample.context.getImageData(0, 0, 48, 48).data)
}
export async function generateAlbumLightField(source: string, fallbackSource?: () => Promise<string>): Promise<AlbumLightField> {
  if ((!source || source.startsWith('fb2k://')) && fallbackSource) {
    try { const safeSource = await fallbackSource(); if (safeSource) return renderAlbumLightField(source, await readPalette(safeSource)) } catch { /* Direct source can still be readable. */ }
  }
  if (!source) return renderAlbumLightField(source, [{ r: 80, g: 87, b: 94 }], true)
  try { return renderAlbumLightField(source, await readPalette(source)) } catch {
    if (fallbackSource) {
      try { const safeSource = await fallbackSource(); if (safeSource) return renderAlbumLightField(source, await readPalette(safeSource)) } catch { /* Neutral field preserves readable artwork-free cases. */ }
    }
    return renderAlbumLightField(source, [{ r: 80, g: 87, b: 94 }], true)
  }
}

export function createAlbumLightFieldCache(generate: typeof generateAlbumLightField = generateAlbumLightField) {
  const cache = new Map<string, Promise<AlbumLightField>>()
  let generation = 0
  return {
    async request(source: string, fallbackSource?: () => Promise<string>) {
      const request = ++generation
      let pending = cache.get(source)
      if (!pending) {
        pending = generate(source, fallbackSource).catch(error => { cache.delete(source); throw error })
        cache.set(source, pending)
      }
      else { cache.delete(source); cache.set(source, pending) }
      while (cache.size > 8) cache.delete(cache.keys().next().value!)
      const field = await pending
      return request === generation ? field : null
    },
    cancel() { generation += 1 },
    dispose() { generation += 1; cache.clear() },
  }
}
