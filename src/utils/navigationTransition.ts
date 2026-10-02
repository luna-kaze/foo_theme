import { nextTick, shallowRef } from 'vue'

// Read by AlbumGrid before the returning scene's first paint, including a
// cache miss. DOM-only hiding after scroll restoration is two frames too late.
export const albumReturnTarget = shallowRef<string | null>(null)

type AlbumEntry = {
  albumId: string
  targetKey: string
  direction: 'enter' | 'return'
  animations: Animation[]
  overlay: HTMLElement | null
  hidden: Array<{ element: HTMLElement; opacity: string; transform: string; transition: string }>
  cleanups: Array<() => void>
}

function reducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function albumArtwork(albumId: string) {
  return [...document.querySelectorAll<HTMLElement>('.workspace-scroll .album-card[data-layout-key]')]
    .filter((element) => element.dataset.layoutKey === `album:${albumId}`)
    .map((element) => element.querySelector<HTMLElement>('.album-card__art'))
    .find((element) => {
      if (!element || !element.getClientRects().length) return false
      return element.getBoundingClientRect().width > 0
    }) ?? null
}

function fullyVisible(element: HTMLElement | null) {
  if (!element) return false
  const bounds = document.querySelector<HTMLElement>('.workspace-scroll')?.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && (!bounds || rect.top >= bounds.top && rect.bottom <= bounds.bottom && rect.left >= bounds.left && rect.right <= bounds.right)
}

function nextFrame() { return new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) }

function snapshotArtwork(source: HTMLElement | null) {
  const artwork = source?.querySelector<HTMLElement>('.artwork-image')
  if (!source || !artwork) return null
  const rect = source.getBoundingClientRect()
  const overlay = document.createElement('div')
  overlay.className = 'album-entry-artwork'
  overlay.setAttribute('aria-hidden', 'true')
  Object.assign(overlay.style, {
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    borderRadius: getComputedStyle(source).borderRadius,
  })
  const image = artwork.cloneNode(true) as HTMLElement
  image.querySelectorAll('img').forEach((element) => { element.loading = 'eager' })
  overlay.append(image)
  document.body.append(overlay)
  return overlay
}

function hideArtwork(entry: AlbumEntry, element: HTMLElement, freezePosition = false) {
  if (entry.hidden.some((hidden) => hidden.element === element)) return
  entry.hidden.push({ element, opacity: element.style.opacity, transform: element.style.transform, transition: element.style.transition })
  if (freezePosition) {
    element.style.transition = 'none'
    element.style.transform = 'none'
  }
  element.style.opacity = '0'
}

function flyArtwork(entry: AlbumEntry, target: HTMLElement, duration: number) {
  if (!entry.overlay) return false
  const source = entry.overlay.getBoundingClientRect()
  const destination = target.getBoundingClientRect()
  if (!source.width || !source.height || !destination.width || !destination.height) return false
  const scaleX = destination.width / source.width
  const radius = parseFloat(getComputedStyle(target).borderRadius) || 0
  entry.animations.push(entry.overlay.animate([
    { transform: 'translate(0,0) scale(1)', borderRadius: entry.overlay.style.borderRadius },
    { transform: `translate(${destination.left - source.left}px, ${destination.top - source.top}px) scale(${scaleX}, ${destination.height / source.height})`, borderRadius: `${radius / scaleX}px` },
  ], { duration, easing: 'cubic-bezier(.33,0,.2,1)', fill: 'both' }))
  return true
}

export function createNavigationTransitions() {
  let albumEntry: AlbumEntry | null = null
  let origin: { albumId: string; key: string; scrollTop: number; cardOffset: number | null } | null = null

  function cancelAlbum() {
    if (!albumEntry) return
    const previous = albumEntry
    albumEntry = null
    albumReturnTarget.value = null
    previous.animations.forEach((animation) => animation.cancel())
    previous.cleanups.forEach((cleanup) => cleanup())
    previous.overlay?.remove()
    previous.hidden.forEach(({ element, opacity, transform, transition }) => {
      element.style.opacity = opacity
      element.style.transform = transform
      element.style.transition = transition
    })
    document.body.classList.remove('album-entry-pending')
  }

  async function openAlbum(albumId: string, targetKey: string, originKey: string, navigate: () => Promise<unknown>, isCurrent: () => boolean) {
    cancelAlbum()
    const source = albumArtwork(albumId)
    const viewport = document.querySelector<HTMLElement>('.workspace-scroll')
    const card = source?.closest<HTMLElement>('.album-card')
    origin = source && viewport ? {
      albumId, key: originKey, scrollTop: viewport.scrollTop,
      cardOffset: card ? card.getBoundingClientRect().top - viewport.getBoundingClientRect().top : null,
    } : null
    const reduced = reducedMotion()
    const entry: AlbumEntry = { albumId, targetKey, direction: 'enter', animations: [], overlay: !reduced && fullyVisible(source) ? snapshotArtwork(source) : null, hidden: [], cleanups: [] }
    albumEntry = entry
    if (!reduced) {
      document.body.classList.add('album-entry-pending')
      if (source && entry.overlay) hideArtwork(entry, source)
    }
    try {
      await navigate()
      await nextTick()
      if (albumEntry !== entry || !isCurrent() || reduced) return
      const detail = [...document.querySelectorAll<HTMLElement>('.workspace-scroll .library-view[data-detail-album]')]
        .find((element) => element.dataset.detailAlbum === albumId)
      const target = detail?.querySelector<HTMLElement>('.album-detail-heading__art')
      if (!detail || !target) return
      if (!flyArtwork(entry, target, 620)) entry.animations.push(target.animate([
        { opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'scale(1)' },
      ], { duration: 480, easing: 'ease-out', fill: 'both' }))
      const parts = [
        { element: detail.querySelector<HTMLElement>('.album-detail-heading__back'), delay: 0 },
        { element: detail.querySelector<HTMLElement>('.album-detail-heading__copy'), delay: 100 },
        { element: detail.querySelector<HTMLElement>(':scope > .track-list'), delay: 180 },
      ]
      for (const { element, delay } of parts) {
        if (element) entry.animations.push(element.animate([
          { opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 420, delay, easing: 'cubic-bezier(.2,.78,.16,1)', fill: 'both' }))
      }
      await Promise.allSettled(entry.animations.map((animation) => animation.finished))
    } finally {
      if (albumEntry === entry) cancelAlbum()
    }
  }

  async function returnAlbum(navigate: () => Promise<unknown>, isCurrent: () => boolean) {
    const returning = origin
    if (!returning) { await navigate(); return }
    const reduced = reducedMotion()
    const source = document.querySelector<HTMLElement>('.workspace-scroll .album-detail-heading__art')
    // Capture the live flying cover before cancelling an interrupted entrance.
    const flightSource = albumEntry?.overlay ?? source
    const overlay = !reduced && fullyVisible(flightSource) ? snapshotArtwork(flightSource) : null
    cancelAlbum()
    const entry: AlbumEntry = { albumId: returning.albumId, targetKey: returning.key, direction: 'return', animations: [], overlay, hidden: [], cleanups: [] }
    albumEntry = entry
    if (!reduced) albumReturnTarget.value = returning.albumId
    if (source && overlay) hideArtwork(entry, source)
    try {
      if (!reduced) {
        const detail = source?.closest<HTMLElement>('.library-view')
        const outgoing = detail ? [...detail.querySelectorAll<HTMLElement>('.album-detail-heading__copy, .album-detail-heading__back, .track-list')].filter((element) => element.getClientRects().length) : []
        const exits = outgoing.map((element) => element.animate([
          { opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform },
          { opacity: 0, transform: 'translateY(-6px)' },
        ], { duration: 120, easing: 'ease-in', fill: 'both' }))
        entry.animations.push(...exits)
        await Promise.allSettled(exits.map((animation) => animation.finished))
        if (albumEntry !== entry) return
      }
      await navigate()
      await nextTick()
      if (albumEntry !== entry || !isCurrent()) return
      const viewport = document.querySelector<HTMLElement>('.workspace-scroll')
      if (viewport) {
        const scrollBehavior = viewport.style.scrollBehavior
        const overflowAnchor = viewport.style.overflowAnchor
        viewport.style.scrollBehavior = 'auto'
        viewport.style.overflowAnchor = 'none'
        const interrupt = () => { if (albumEntry === entry) cancelAlbum() }
        viewport.addEventListener('wheel', interrupt, { passive: true })
        viewport.addEventListener('touchmove', interrupt, { passive: true })
        window.addEventListener('resize', interrupt)
        entry.cleanups.push(() => {
          viewport.style.scrollBehavior = scrollBehavior
          viewport.style.overflowAnchor = overflowAnchor
          viewport.removeEventListener('wheel', interrupt)
          viewport.removeEventListener('touchmove', interrupt)
          window.removeEventListener('resize', interrupt)
        })
        // A cached page can initially have a clamped scroll range. Restore
        // again after activation/layout, then reconcile the actual clicked card.
        viewport.scrollTop = returning.scrollTop
        await nextFrame()
        if (albumEntry !== entry || !isCurrent()) return
        viewport.scrollTop = returning.scrollTop
        const card = albumArtwork(returning.albumId)?.closest<HTMLElement>('.album-card')
        if (card && returning.cardOffset != null) viewport.scrollTop += card.getBoundingClientRect().top - viewport.getBoundingClientRect().top - returning.cardOffset
        await nextFrame()
        if (albumEntry !== entry || !isCurrent()) return
      }
      const target = albumArtwork(returning.albumId)
      if (!target) return
      if (reduced) return
      if (overlay && fullyVisible(target)) {
        hideArtwork(entry, target, true)
        flyArtwork(entry, target, 520)
      } else {
        overlay?.remove()
        entry.overlay = null
        entry.animations.push(target.animate([{ opacity: .82 }, { opacity: 1 }], { duration: 180, easing: 'ease-out', fill: 'both' }))
      }
      await Promise.allSettled(entry.animations.map((animation) => animation.finished))
    } finally {
      if (albumEntry === entry) cancelAlbum()
    }
  }

  return {
    openAlbum, returnAlbum, cancelAlbum,
    get targetKey() { return albumEntry?.targetKey ?? null },
    get direction() { return albumEntry?.direction ?? null },
    get originKey() { return origin?.key ?? null },
    get originAlbumId() { return origin?.albumId ?? null },
    get originScrollTop() { return origin?.scrollTop ?? 0 },
    cancel() { cancelAlbum(); origin = null },
  }
}
