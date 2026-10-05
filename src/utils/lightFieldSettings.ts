import { reactive } from 'vue'
import fb from 'foo-webview-sdk'

export const lightFieldDefaults = {
  brightness: 1, saturation: 1, contrast: 1, hue: 0, opacity: 1,
  baseOpacity: 1, primaryIntensity: 1, secondaryIntensity: 1,
  glowScale: 1, blur: 0, speed: 1, motion: 1, vignette: 1, animated: true,
}
export type LightFieldSettings = typeof lightFieldDefaults
export type LightFieldNumericKey = Exclude<keyof LightFieldSettings, 'animated'>
export const lightFieldControls: { key: LightFieldNumericKey; label: string; min: number; max: number; step: number; unit?: string }[] = [
  { key: 'brightness', label: '整体亮度', min: .3, max: 3, step: .05 },
  { key: 'saturation', label: '色彩饱和度', min: 0, max: 3, step: .05 },
  { key: 'contrast', label: '对比度', min: .5, max: 2, step: .05 },
  { key: 'hue', label: '色相偏移', min: -180, max: 180, step: 1, unit: '°' },
  { key: 'opacity', label: '背景不透明度', min: 0, max: 1, step: .05 },
  { key: 'baseOpacity', label: '底色层强度', min: 0, max: 1, step: .05 },
  { key: 'primaryIntensity', label: '中心旋转层强度', min: 0, max: 2, step: .05 },
  { key: 'secondaryIntensity', label: '边缘旋转层强度', min: 0, max: 2, step: .05 },
  { key: 'glowScale', label: '旋转色域大小', min: .6, max: 1.6, step: .05 },
  { key: 'blur', label: '柔化模糊', min: 0, max: 80, step: 1, unit: 'px' },
  { key: 'speed', label: '流动速度', min: .25, max: 3, step: .05 },
  { key: 'motion', label: '旋转与位移幅度', min: 0, max: 3, step: .05 },
  { key: 'vignette', label: '暗角与遮罩', min: 0, max: 3, step: .05 },
]
export const lightFieldSettings = reactive<LightFieldSettings>({ ...lightFieldDefaults })
const configKey = 'foo-theme.fullscreen-light-field.v1'
let revision = 0, loadGeneration = 0

export function normalizeLightFieldSettings(input: unknown): LightFieldSettings {
  const output = { ...lightFieldDefaults }
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  for (const control of lightFieldControls) {
    const number = value[control.key]
    if (typeof number === 'number' && Number.isFinite(number)) output[control.key] = Math.max(control.min, Math.min(control.max, number))
  }
  if (typeof value.animated === 'boolean') output.animated = value.animated
  return output
}

export function updateLightFieldSettings(value: Partial<LightFieldSettings>) {
  revision += 1
  Object.assign(lightFieldSettings, normalizeLightFieldSettings({ ...lightFieldSettings, ...value }))
}
export function resetLightFieldSettings() { updateLightFieldSettings(lightFieldDefaults) }

export async function loadLightFieldSettings(connected: boolean) {
  const generation = ++loadGeneration, startRevision = revision
  let value: unknown
  try { value = JSON.parse(globalThis.localStorage?.getItem(configKey) || 'null') } catch { /* Defaults remain valid without local storage. */ }
  if (connected) {
    const result = await fb.config.get(configKey)
    if (result.value != null) value = result.value
  }
  if (generation !== loadGeneration || startRevision !== revision) return
  Object.assign(lightFieldSettings, normalizeLightFieldSettings(value))
}

export async function saveLightFieldSettings(connected: boolean) {
  const value = normalizeLightFieldSettings(lightFieldSettings)
  if (connected) {
    const result = await fb.config.set(configKey, value)
    if (!result.success) throw new Error(result.error || '无法保存全屏背景参数。')
  }
  try {
    if (!globalThis.localStorage && !connected) throw new Error('Storage unavailable')
    globalThis.localStorage?.setItem(configKey, JSON.stringify(value))
  } catch {
    if (!connected) throw new Error('浏览器无法保存背景参数。')
  }
}

export function lightFieldStyle(value: LightFieldSettings) {
  const s = normalizeLightFieldSettings(value)
  return {
    '--light-filter': s.brightness === 1 && s.saturation === 1 && s.contrast === 1 && s.hue === 0 ? 'none' : `brightness(${s.brightness}) saturate(${s.saturation}) contrast(${s.contrast}) hue-rotate(${s.hue}deg)`,
    '--light-base-opacity': s.baseOpacity,
    '--light-primary-intensity': s.primaryIntensity,
    '--light-secondary-intensity': s.secondaryIntensity,
    '--light-glow-scale': s.glowScale,
    '--light-blur': `${s.blur}px`,
    '--light-primary-period': `${19 / s.speed}s`,
    '--light-secondary-period': `${27 / s.speed}s`,
    '--light-motion': s.motion,
    '--light-vignette': s.vignette,
  }
}
