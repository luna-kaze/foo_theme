export function formatTime(seconds = 0): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const remainder = String(whole % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

export function formatCount(value: number, noun: string): string {
  return `${value.toLocaleString()} ${noun}${value === 1 ? '' : 's'}`
}
