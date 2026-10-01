import { nextTick } from 'vue'

type AlbumEntry = {
  albumId: string
  animations: Animation[]
  overlay: HTMLElement | null
}

function reducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function visibleAlbumArtwork(albumId: string) {
  const viewport = document.querySelector<HTMLElement>('.workspace-scroll')
  const bounds = viewport?.getBoundingClientRect()
  return [...document.querySelectorAll<HTMLElement>('.album-card[data-layout-key]')]
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
    left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`,
    borderRadius: getComputedStyle(source).borderRadius,
  })
  const image = artwork.cloneNode(true) as HTMLElement
  image.querySelectorAll('img').forEach((element) => { element.loading = 'eager' })
  overlay.append(image)
  document.body.append(overlay)
  return overlay
}

export function createNavigationTransitions() {
  let pageAnimations: Animation[] = []
  let albumEntry: AlbumEntry | null = null

  function cancelPage() {
    pageAnimations.forEach((animation) => animation.cancel())
    pageAnimations = []
  }

  function cancelAlbum() {
    if (!albumEntry) return
    const previous = albumEntry
    albumEntry = null
    previous.animations.forEach((animation) => animation.cancel())
    previous.overlay?.remove()
    document.body.classList.remove('album-entry-pending')
  }

  function enterPage() {
    cancelPage()
    if (reducedMotion() || albumEntry) return
    // Animate the content sections, not their ancestor: a transform on the
    // route container would change the containing block of the fixed A–Z rail.
    const sections = document.querySelectorAll<HTMLElement>(
      '.workspace-scroll .library-view > :not(.library-loading):not(.alphabet-browser), .workspace-scroll .library-view > .alphabet-browser > .alphabet-browser__groups',
    )
    pageAnimations = [...sections].filter((element) => element.getClientRects().length).map((element) => {
      const animation = element.animate([
        { transform: 'translateX(18px)', opacity: .65 },
        { transform: 'translateX(0)', opacity: 1 },
      ], { duration: 280, easing: 'cubic-bezier(.2,.78,.16,1)', fill: 'both' })
      void animation.finished.then(() => animation.cancel(), () => {})
      return animation
    })
  }

  async function openAlbum(albumId: string, navigate: () => Promise<unknown>, isCurrent: () => boolean) {
    cancelPage()
    cancelAlbum()
    if (reducedMotion()) {
      await navigate()
      return
    }
    const entry: AlbumEntry = { albumId, animations: [], overlay: snapshotArtwork(visibleAlbumArtwork(albumId)) }
    albumEntry = entry
    document.body.classList.add('album-entry-pending')
    try {
      const navigation = navigate()
      const viewport = document.querySelector<HTMLElement>('.workspace-scroll')
      if (viewport) viewport.scrollTop = 0
      await navigation
      await nextTick()
      if (albumEntry !== entry || !isCurrent()) return
      const detail = [...document.querySelectorAll<HTMLElement>('.library-view[data-detail-album]')]
        .find((element) => element.dataset.detailAlbum === albumId)
      const target = detail?.querySelector<HTMLElement>('.album-detail-heading__art')
      if (!detail || !target) return

      if (entry.overlay) {
        const sourceBounds = entry.overlay.getBoundingClientRect()
        const targetBounds = target.getBoundingClientRect()
        const animation = entry.overlay.animate([
          { transform: 'translate(0,0) scale(1)' },
          { transform: `translate(${targetBounds.left - sourceBounds.left}px, ${targetBounds.top - sourceBounds.top}px) scale(${targetBounds.width / sourceBounds.width}, ${targetBounds.height / sourceBounds.height})` },
        ], { duration: 620, easing: 'cubic-bezier(.33,0,.2,1)', fill: 'both' })
        entry.animations.push(animation)
      } else {
        entry.animations.push(target.animate([
          { opacity: 0, transform: 'scale(.96)' },
          { opacity: 1, transform: 'scale(1)' },
        ], { duration: 480, easing: 'ease-out', fill: 'both' }))
      }

      const parts = [
        { element: detail.querySelector<HTMLElement>('.album-detail-heading__back'), delay: 0 },
        { element: detail.querySelector<HTMLElement>('.album-detail-heading__copy'), delay: 100 },
        { element: detail.querySelector<HTMLElement>(':scope > .track-list'), delay: 180 },
      ]
      for (const { element, delay } of parts) {
        if (!element) continue
        entry.animations.push(element.animate([
          { opacity: 0, transform: 'translateY(12px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 420, delay, easing: 'cubic-bezier(.2,.78,.16,1)', fill: 'both' }))
      }
      await Promise.allSettled(entry.animations.map((animation) => animation.finished))
    } finally {
      // A cancelled old navigation must never reveal/clear a newer album entry.
      if (albumEntry === entry) cancelAlbum()
    }
  }

  return {
    enterPage,
    openAlbum,
    cancelPage,
    cancelAlbum,
    get albumId() { return albumEntry?.albumId ?? null },
    cancel() { cancelPage(); cancelAlbum() },
  }
}
