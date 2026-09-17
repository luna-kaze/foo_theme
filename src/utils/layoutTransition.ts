import { nextTick } from 'vue'

type LayoutSnapshot = { rect: DOMRect }

function layoutItems(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('[data-layout-key]')]
}

function visibleSnapshots(root: HTMLElement, viewport: HTMLElement | null) {
  const bounds = viewport?.getBoundingClientRect() ?? new DOMRect(0, 0, globalThis.innerWidth, globalThis.innerHeight)
  const top = bounds.top - 480
  const bottom = bounds.bottom + 480
  const snapshots = new Map<string, LayoutSnapshot>()
  let anchor: { key: string; top: number } | null = null

  for (const element of layoutItems(root)) {
    const key = element.dataset.layoutKey
    if (!key) continue
    const rect = element.getBoundingClientRect()
    if (rect.bottom < top || rect.top > bottom) continue
    snapshots.set(key, { rect })
    if (!anchor && rect.bottom > bounds.top) anchor = { key, top: rect.top }
  }
  return { snapshots, anchor }
}

function animateChrome(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('[data-layout-chrome]')].map((element, index) => {
    const rail = element.dataset.layoutChrome === 'rail'
    return element.animate([
      { opacity: 0, transform: rail ? 'translateX(10px)' : 'translateY(9px)' },
      { opacity: 1, transform: 'translate3d(0,0,0)' },
    ], {
      duration: rail ? 230 : 280,
      delay: Math.min(index * 14, 84),
      easing: 'cubic-bezier(.2,.78,.18,1)',
      fill: 'both',
    })
  })
}

export async function animateLayoutReorder(root: HTMLElement | null, update: () => void) {
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!root || reducedMotion) {
    update()
    await nextTick()
    return
  }

  root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel())
  const viewport = root.closest<HTMLElement>('.workspace-scroll')
  const { snapshots, anchor } = visibleSnapshots(root, viewport)

  update()
  await nextTick()

  if (viewport && anchor) {
    const nextAnchor = layoutItems(root).find((element) => element.dataset.layoutKey === anchor.key)
    if (nextAnchor) viewport.scrollTop += nextAnchor.getBoundingClientRect().top - anchor.top
  }

  const animations: Animation[] = []
  let visibleIndex = 0
  for (const element of layoutItems(root)) {
    const key = element.dataset.layoutKey
    const previous = key ? snapshots.get(key) : null
    if (!previous) continue
    const current = element.getBoundingClientRect()
    const deltaX = previous.rect.left - current.left
    const deltaY = previous.rect.top - current.top
    const scaleX = current.width ? previous.rect.width / current.width : 1
    const scaleY = current.height ? previous.rect.height / current.height : 1
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1 && Math.abs(scaleX - 1) < .01 && Math.abs(scaleY - 1) < .01) continue
    animations.push(element.animate([
      { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`, opacity: .72 },
      { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 },
    ], {
      duration: 390,
      delay: Math.min(visibleIndex * 9, 72),
      easing: 'cubic-bezier(.2,.8,.16,1)',
      fill: 'both',
    }))
    visibleIndex += 1
  }
  animations.push(...animateChrome(root))
  await Promise.allSettled(animations.map((animation) => animation.finished))
  animations.forEach((animation) => animation.cancel())
}
