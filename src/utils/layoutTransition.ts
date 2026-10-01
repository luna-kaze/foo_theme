import { nextTick } from 'vue'

type LayoutSnapshot = { rect: DOMRect; opacity: number }
type LayoutTransition = {
  animations: Animation[]
  renderedElements: HTMLElement[]
  overflowAnchor: string
  scrollBehavior: string
}
const activeTransitions = new WeakMap<HTMLElement, LayoutTransition>()
const renderedElements = new WeakMap<HTMLElement, { owner: LayoutTransition; contentVisibility: string }>()

function renderDuringTransition(element: HTMLElement, transition: LayoutTransition) {
  const previous = renderedElements.get(element)
  renderedElements.set(element, { owner: transition, contentVisibility: previous?.contentVisibility ?? element.style.contentVisibility })
  transition.renderedElements.push(element)
  // A card whose final slot is offscreen still needs to paint while flying
  // through the viewport. content-visibility:auto otherwise skips its artwork.
  element.style.contentVisibility = 'visible'
}

function movementDuration(distance: number) {
  // No per-card delay: short moves settle promptly, longer paths get more time.
  return Math.round(Math.min(880, Math.max(380, 320 + distance / .9)))
}

function layoutItems(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('[data-layout-key]')]
}

function visibleSnapshots(root: HTMLElement, viewport: HTMLElement | null) {
  const bounds = viewport?.getBoundingClientRect() ?? new DOMRect(0, 0, globalThis.innerWidth, globalThis.innerHeight)
  const top = bounds.top - 480
  const bottom = bounds.bottom + 480
  const snapshots = new Map<string, LayoutSnapshot>()
  for (const element of layoutItems(root)) {
    const key = element.dataset.layoutKey
    if (!key) continue
    const rect = element.getBoundingClientRect()
    if (rect.bottom < top || rect.top > bottom) continue
    snapshots.set(key, { rect, opacity: Number(getComputedStyle(element).opacity) })
  }
  return snapshots
}

function animateChrome(root: HTMLElement, viewport: HTMLElement | null) {
  const bounds = viewport?.getBoundingClientRect()
  return [...root.querySelectorAll<HTMLElement>('[data-layout-chrome]')].flatMap((element) => {
    const rail = element.dataset.layoutChrome === 'rail'
    const rect = element.getBoundingClientRect()
    if (!rail && bounds && (rect.bottom < bounds.top || rect.top > bounds.bottom)) return []
    // Never override the rail's translateY(-50%) positioning transform.
    const frames: Keyframe[] = rail ? [
      { opacity: 0 },
      { opacity: 1 },
    ] : [
      { opacity: 0, transform: 'translateY(6px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ]
    return element.animate(frames, {
      duration: 360,
      delay: 0,
      easing: 'ease-in-out',
      fill: 'both',
    })
  })
}

export async function animateLayoutReorder(root: HTMLElement | null, update: () => void) {
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!root) {
    update()
    await nextTick()
    return
  }

  const viewport = root.closest<HTMLElement>('.workspace-scroll')
  // Read the on-screen geometry BEFORE cancelling: rapid clicks continue from
  // the interpolated positions, rather than jumping to the previous endpoint.
  const snapshots = reducedMotion ? new Map<string, LayoutSnapshot>() : visibleSnapshots(root, viewport)
  const previous = activeTransitions.get(root)
  const transition: LayoutTransition = {
    animations: [],
    renderedElements: [],
    overflowAnchor: previous?.overflowAnchor ?? viewport?.style.overflowAnchor ?? '',
    scrollBehavior: previous?.scrollBehavior ?? viewport?.style.scrollBehavior ?? '',
  }
  activeTransitions.set(root, transition)
  previous?.animations.forEach((animation) => animation.cancel())
  const scrollTop = viewport?.scrollTop ?? 0
  if (viewport) {
    viewport.style.overflowAnchor = 'none'
    viewport.style.scrollBehavior = 'auto'
  }

  try {
    update()
    await nextTick()
    if (activeTransitions.get(root) !== transition || !root.isConnected) return
    // Keep the heading/button at their viewport positions, not the first card.
    if (viewport) viewport.scrollTop = scrollTop
    if (reducedMotion) return

    const animations = transition.animations
    const items = layoutItems(root)
    const viewportBounds = viewport?.getBoundingClientRect()
    // Apply rendering overrides together BEFORE measuring any final positions,
    // so intrinsic placeholder heights cannot shift later cards mid-animation.
    for (const element of items) {
      if (element.dataset.layoutKey && snapshots.has(element.dataset.layoutKey)) renderDuringTransition(element, transition)
    }
    for (const element of items) {
      const key = element.dataset.layoutKey
      const snapshot = key ? snapshots.get(key) : null
      const current = element.getBoundingClientRect()
      if (!snapshot) {
        // Newly visible cards may have been outside the old measurement buffer.
        // Fade them in instead of letting them pop instantly beside moving cards.
        if (viewportBounds && current.bottom >= viewportBounds.top && current.top <= viewportBounds.bottom) {
          animations.push(element.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 460,
            delay: 0,
            easing: 'ease-in-out',
            fill: 'both',
          }))
        }
        continue
      }
      const deltaX = snapshot.rect.left - current.left
      const deltaY = snapshot.rect.top - current.top
      const scaleX = current.width ? snapshot.rect.width / current.width : 1
      const scaleY = current.height ? snapshot.rect.height / current.height : 1
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1 && Math.abs(scaleX - 1) < .01 && Math.abs(scaleY - 1) < .01) continue
      const baseTransform = getComputedStyle(element).transform || 'none'
      const distance = Math.max(Math.hypot(deltaX, deltaY), Math.abs(snapshot.rect.width - current.width), Math.abs(snapshot.rect.height - current.height))
      animations.push(element.animate([
        { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})${baseTransform === 'none' ? '' : ` ${baseTransform}`}`, opacity: snapshot.opacity },
        { transform: baseTransform, opacity: 1 },
      ], {
        duration: movementDuration(distance),
        delay: 0,
        easing: 'cubic-bezier(.33,0,.2,1)',
        fill: 'both',
      }))
    }
    animations.push(...animateChrome(root, viewport))
    await Promise.allSettled(animations.map((animation) => animation.finished))
  } finally {
    transition.animations.forEach((animation) => animation.cancel())
    for (const element of transition.renderedElements) {
      const rendered = renderedElements.get(element)
      if (rendered?.owner !== transition) continue
      element.style.contentVisibility = rendered.contentVisibility
      renderedElements.delete(element)
    }
    if (activeTransitions.get(root) === transition) {
      activeTransitions.delete(root)
      if (viewport) {
        viewport.style.overflowAnchor = transition.overflowAnchor
        viewport.style.scrollBehavior = transition.scrollBehavior
      }
    }
  }
}
