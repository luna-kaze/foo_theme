/** Preview every input, but commit only the latest target after a quiet gap. */
export function createSettledNavigation<T>(deps: {
  preview: (target: T, request: number) => void
  commit: (target: T, signal: AbortSignal) => Promise<boolean>
  waitUntilReady?: (target: T, request: number, signal: AbortSignal) => Promise<boolean>
  clear: () => void
  delay?: number
}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let serial: Promise<unknown> = Promise.resolve()
  let controller: AbortController | undefined
  const waiters: Array<(success: boolean) => void> = []
  return {
    schedule(target: T) {
      const request = ++generation
      controller?.abort()
      const current = controller = new AbortController()
      if (timer) clearTimeout(timer)
      deps.preview(target, request)
      timer = setTimeout(() => {
        timer = undefined
        const run = async () => {
          let success = false
          try {
            const ready = await (deps.waitUntilReady?.(target, request, current.signal) ?? Promise.resolve(true))
            if (!ready || current.signal.aborted || request !== generation) return
            serial = serial.catch(() => {}).then(async () => {
              if (current.signal.aborted || request !== generation) return false
              return deps.commit(target, current.signal)
            })
            success = await serial as boolean
          } finally {
            if (request === generation) {
              deps.clear()
              waiters.splice(0).forEach(resolve => resolve(success))
            }
          }
        }
        void run().catch(() => {})
      }, deps.delay ?? 350)
      return new Promise<boolean>(resolve => waiters.push(resolve))
    },
    cancel(clearPreview = true) {
      generation += 1
      controller?.abort()
      if (timer) clearTimeout(timer)
      timer = undefined
      if (clearPreview) deps.clear()
      waiters.splice(0).forEach(resolve => resolve(false))
    },
  }
}

export type PlaybackFocusState = { active: boolean; id: string | null; request: number; settled: boolean }

/** Readiness is keyed by both occurrence ID and intent generation. */
export function createPlaybackFocusGate() {
  let state: PlaybackFocusState = { active: false, id: null, request: 0, settled: true }
  const waiting = new Set<{ id: string; request: number; finish: (ready: boolean) => void }>()
  return {
    report(next: PlaybackFocusState) {
      state = next
      for (const waiter of [...waiting]) {
        if (!state.active || (state.settled && state.id === waiter.id && state.request === waiter.request)) waiter.finish(true)
      }
    },
    wait(id: string, request: number, signal: AbortSignal) {
      if (signal.aborted) return Promise.resolve(false)
      if (!state.active || (state.settled && state.id === id && state.request === request)) return Promise.resolve(true)
      return new Promise<boolean>(resolve => {
        const abort = () => waiter.finish(false)
        const timer = setTimeout(() => waiter.finish(false), 2000)
        const waiter = { id, request, finish(ready: boolean) {
          if (!waiting.delete(waiter)) return
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
          resolve(ready)
        } }
        waiting.add(waiter)
        signal.addEventListener('abort', abort, { once: true })
      })
    },
  }
}
