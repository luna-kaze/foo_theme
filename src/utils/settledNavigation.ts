/** Preview every input, but commit only the latest target after a quiet gap. */
export function createSettledNavigation<T>(deps: {
  preview: (target: T) => void
  commit: (target: T) => Promise<boolean>
  clear: () => void
  delay?: number
}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let serial: Promise<unknown> = Promise.resolve()
  const waiters: Array<(success: boolean) => void> = []
  return {
    schedule(target: T) {
      const request = ++generation
      if (timer) clearTimeout(timer)
      deps.preview(target)
      timer = setTimeout(() => {
        timer = undefined
        serial = serial.catch(() => {}).then(async () => {
          if (request !== generation) return
          let success = false
          try { success = await deps.commit(target) } finally {
            if (request === generation) {
              deps.clear()
              waiters.splice(0).forEach(resolve => resolve(success))
            }
          }
        })
        void serial.catch(() => {})
      }, deps.delay ?? 180)
      return new Promise<boolean>(resolve => waiters.push(resolve))
    },
    cancel() {
      generation += 1
      if (timer) clearTimeout(timer)
      timer = undefined
      deps.clear()
      waiters.splice(0).forEach(resolve => resolve(false))
    },
  }
}
