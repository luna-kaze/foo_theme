export type RailFrame = { position: number; target: number; zoom: number; distant: boolean; active: boolean; settled: boolean }

export function createCoverflowRail(deps: {
  now: () => number
  requestFrame: (run: (time: number) => void) => number
  cancelFrame: (id: number) => void
  update: (frame: RailFrame) => void
}) {
  let position = 0, target = 0, zoom = 0, count = 1
  let frame = 0, previousTime = 0, inputTime = -Infinity
  let distant = false, active = false
  let samples: Array<{ time: number; distance: number }> = []
  const clamp = (value: number) => Math.max(0, Math.min(Math.max(0, count - 1), value))
  const publish = () => deps.update({ position, target, zoom, distant, active, settled: !active })
  function tick(time = deps.now()) {
    frame = 0
    const dt = Math.max(1, Math.min(50, time - previousTime || 16))
    previousTime = time
    const quiet = time - inputTime >= 200
    if (quiet) target = clamp(Math.round(target))
    position += (target - position) * (1 - Math.exp(-dt / 85))
    if (Math.abs(target - position) < .008) position = target
    if (quiet && position === target) distant = false
    zoom += ((distant ? 1 : 0) - zoom) * (1 - Math.exp(-dt / 75))
    if (Math.abs((distant ? 1 : 0) - zoom) < .005) zoom = distant ? 1 : 0
    active = !(quiet && position === target && zoom === 0)
    publish()
    if (active) frame = deps.requestFrame(tick)
  }
  function start() {
    active = true
    if (!frame) { previousTime = deps.now(); frame = deps.requestFrame(tick) }
  }
  return {
    reset(length: number, value: number) {
      if (frame) deps.cancelFrame(frame)
      frame = 0; count = Math.max(1, length)
      position = target = clamp(value); zoom = 0; distant = active = false
      samples = []; inputTime = -Infinity; publish()
    },
    wheel(delta: number, deltaMode: number, viewport: number) {
      const time = deps.now()
      const pixels = delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(200, viewport) : 1)
      const distance = pixels / 100
      if (!Number.isFinite(distance) || !distance) return
      target = clamp(target + distance)
      samples = samples.filter(sample => time - sample.time <= 130).slice(-15)
      samples.push({ time, distance: Math.abs(distance) })
      const speed = samples.reduce((sum, sample) => sum + sample.distance, 0) / Math.max(80, time - samples[0]!.time) * 1000
      if (Math.abs(distance) >= 4 || Math.abs(target - position) > 8 || samples.length >= 2 && speed >= 12) distant = true
      else if (speed < 6 && Math.abs(target - position) < .5) distant = false
      inputTime = time
      start()
    },
    aim(value: number) {
      target = clamp(value)
      if (Math.abs(target - position) > 8) distant = true
      inputTime = deps.now(); start()
    },
    resize(length: number) { count = Math.max(1, length); target = clamp(target); position = clamp(position) },
    dispose() { if (frame) deps.cancelFrame(frame); frame = 0; active = false },
  }
}
