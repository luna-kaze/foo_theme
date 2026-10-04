type Tier = 'near' | 'shrinking' | 'high' | 'restoring' | 'inactive'
type Bucket = { frames: number[]; events: Record<string, { count: number; totalMs: number; maxMs: number; items: number }> }
export type CoverflowPerformanceReport = ReturnType<typeof report>
const tiers: Tier[] = ['near', 'shrinking', 'high', 'restoring', 'inactive']
let tier: Tier = 'near', previousTier: Tier = 'near', enabled = false, frame = 0, timer = 0, started = 0, previous = 0
let observer: PerformanceObserver | null = null
let buckets = createBuckets()
let timeline: Array<{ time: number; tier: Tier }> = []
let heapStart: number | null = null
let dom: Record<string, { covers: number; images: number; dots: number }> = {}
function createBuckets() {
  const bucket = (): Bucket => ({ frames: [], events: {} })
  return { near: bucket(), shrinking: bucket(), high: bucket(), restoring: bucket(), inactive: bucket() }
}
function heap() {
  return (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null
}
function recordAt(name: string, ms: number, items: number, atTier: Tier) {
  const event = buckets[atTier].events[name] ??= { count: 0, totalMs: 0, maxMs: 0, items: 0 }
  event.count += 1; event.totalMs += ms; event.maxMs = Math.max(event.maxMs, ms); event.items += items
}
function report() {
  const heapEnd = heap()
  return {
    durationMs: performance.now() - started,
    frameMetric: 'requestAnimationFrame scheduling intervals; not GPU-presented FPS',
    heapDeltaBytes: heapStart == null || heapEnd == null ? null : heapEnd - heapStart,
    tiers: Object.fromEntries(tiers.map(name => {
      const sorted = [...buckets[name].frames].sort((a, b) => a - b)
      return [name, {
        samples: sorted.length, averageFrameMs: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
        p95FrameMs: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] : null,
        framesOver32Ms: sorted.filter(value => value > 32).length,
        events: buckets[name].events, maxDom: dom[name] ?? null,
      }]
    })),
  }
}
export const coverflowPerformance = {
  get active() { return enabled },
  setTier(next: Tier) {
    if (tier === next) return
    tier = next
    if (enabled) timeline.push({ time: performance.now(), tier })
  },
  record(name: string, ms = 0, items = 0) { if (enabled) recordAt(name, ms, items, tier) },
  start() {
    if (enabled) return
    buckets = createBuckets(); dom = {}; previous = 0; started = performance.now(); heapStart = heap()
    timeline = [{ time: started, tier }]; enabled = true
    const tick = (time: number) => {
      if (!enabled) return
      if (previous) { const samples = buckets[previousTier].frames; samples.push(time - previous); if (samples.length > 10000) samples.shift() }
      previous = time; previousTier = tier; frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    timer = window.setInterval(() => {
      const view = document.querySelector('.coverflow')
      if (!view) return
      const sample = { covers: view.querySelectorAll('.coverflow-card').length, images: view.querySelectorAll('.coverflow-card img').length, dots: view.querySelectorAll('.coverflow__dot').length }
      const old = dom[tier] ?? { covers: 0, images: 0, dots: 0 }
      dom[tier] = { covers: Math.max(old.covers, sample.covers), images: Math.max(old.images, sample.images), dots: Math.max(old.dots, sample.dots) }
    }, 250)
    if (typeof PerformanceObserver !== 'undefined') {
      const types = ['longtask', 'resource'].filter(type => PerformanceObserver.supportedEntryTypes.includes(type))
      if (types.length) {
        observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.startTime < started) continue
            const atTier = [...timeline].reverse().find(change => change.time <= entry.startTime)?.tier ?? tier
            if (entry.entryType === 'longtask') recordAt('longTask', entry.duration, 0, atTier)
            else if ((entry as PerformanceResourceTiming).initiatorType === 'img') recordAt('imageResource', entry.duration, 0, atTier)
          }
        })
        observer.observe({ entryTypes: types })
      }
    }
  },
  snapshot: report,
  stop() {
    enabled = false; cancelAnimationFrame(frame); window.clearInterval(timer); observer?.disconnect(); observer = null
    return report()
  },
}

declare global { interface Window { fooThemeCoverflowPerformance: typeof coverflowPerformance } }
export function installCoverflowPerformance() {
  window.fooThemeCoverflowPerformance = coverflowPerformance
  return () => { if (enabled) coverflowPerformance.stop(); delete (window as Partial<Window>).fooThemeCoverflowPerformance }
}
