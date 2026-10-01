import { nextTick } from 'vue'

type AlbumEntry = {
  albumId: string
  targetKey: string
  direction: 'enter' | 'return'
  animations: Animation[]
  overlay: HTMLElement | null
  hidden: Array<{ element: HTMLElement; opacity: string }>
}

function reducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function visibleAlbumArtwork(albumId: string) {
  const viewport = document.querySelector<HTMLElement>('.workspace-scroll')
  const bounds = viewport?.getBoundingClientRect()
  return [...document.querySelectorAll<HTMLElement>('.workspace-scroll .album-card[data-layout-key]')]
    .filter((element) => element.dataset.layoutKey === `album:${albumId}`)
    .map((element) => element.querySelector<HTMLElement>('.album-card__art'))
    .find((element) => {
      if (!element || !element.getClientRects().length) return false
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && (!bounds || rect.top >= bounds.top - 8 && rect.bottom <= bounds.bottom + 8)
    }) ?? null
}

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

function hideArtwork(entry: AlbumEntry, element: HTMLElement) {
  if (entry.hidden.some((hidden) => hidden.element === element)) return
  entry.hidden.push({ element, opacity: element.style.opacity })
  element.style.opacity = '0'
}

function flyArtwork(entry: AlbumEntry, target: HTMLElement, duration: number) {
  if (!entry.overlay) return false
  const source = entry.overlay.getBoundingClientRect()
  const destination = target.getBoundingClientRect()
  if (!source.width || !source.height || !destination.width || !destination.height) return false
  entry.animations.push(entry.overlay.animate([
    { transform: 'translate(0,0) scale(1)' },
    { transform: `translate(${destination.left - source.left}px, ${destination.top - source.top}px) scale(${destination.width / source.width}, ${destination.height / source.height})` },
  ], { duration, easing: 'cubic-bezier(.33,0,.2,1)', fill: 'both' }))
  return true
}

export function createNavigationTransitions() {
  let albumEntry: AlbumEntry | null = null
  let origin: { albumId: string; key: string } | null = null

  function cancelAlbum() {
    if (!albumEntry) return
    const previous = albumEntry
    albumEntry = null
    previous.animations.forEach((animation) => animation.cancel())
    previous.overlay?.remove()
    previous.hidden.forEach(({ element, opacity }) => { element.style.opacity = opacity })
    document.body.classList.remove('album-entry-pending')
  }

  async function openAlbum(albumId: string, targetKey: string, originKey: string, navigate: () => Promise<unknown>, isCurrent: () => boolean) {
    cancelAlbum()
    const source = visibleAlbumArtwork(albumId)
    origin = source ? { albumId, key: originKey } : null
    const reduced = reducedMotion()
    const entry: AlbumEntry = { albumId, targetKey, direction: 'enter', animations: [], overlay: reduced ? null : snapshotArtwork(source), hidden: [] }
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
    const overlay = reduced ? null : snapshotArtwork(albumEntry?.overlay ?? source)
    cancelAlbum()
    const entry: AlbumEntry = { albumId: returning.albumId, targetKey: returning.key, direction: 'return', animations: [], overlay, hidden: [] }
    albumEntry = entry
    if (source && overlay) hideArtwork(entry, source)
    try {
      await navigate()
      await nextTick()
      if (albumEntry !== entry || !isCurrent() || reduced) return
      const target = visibleAlbumArtwork(returning.albumId)
      if (!target) return
      if (overlay) hideArtwork(entry, target)
      flyArtwork(entry, target, 520)
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
    cancel() { cancelAlbum(); origin = null },
  }
}
