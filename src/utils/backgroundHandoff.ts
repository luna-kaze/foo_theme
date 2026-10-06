/** Smooth material blending separately from the native window/layout resize. */
export function createBackgroundHandoff(deps: { render: (value: number) => void; raf?: typeof requestAnimationFrame; cancel?: typeof cancelAnimationFrame }) {
  const raf = deps.raf ?? requestAnimationFrame, cancel = deps.cancel ?? cancelAnimationFrame
  let value = 0, target = 0, frame = 0, last = 0, disposed = false
  function tick(now: number) {
    frame = 0
    if (disposed) return
    const dt = last ? Math.max(0, Math.min(.05, (now - last) / 1000)) : 1 / 60
    last = now
    value += (target - value) * (1 - Math.exp(-dt * 10))
    if (Math.abs(target - value) < .001) value = target
    deps.render(value)
    if (value !== target) frame = raf(tick)
    else last = 0
  }
  return {
    set(progress: number, ready: boolean) {
      target = ready ? Math.max(0, Math.min(1, progress)) : 0
      if (!disposed && !frame && value !== target) frame = raf(tick)
    },
    dispose() { disposed = true; if (frame) cancel(frame); frame = 0 },
  }
}
