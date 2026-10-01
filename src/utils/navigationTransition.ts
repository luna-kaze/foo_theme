import { nextTick } from 'vue'

type AlbumEntry = {
  albumId: string
  animations: Animation[]
  overlay: HTMLElement | null
}

type PageEntry = {
  viewport: HTMLElement
  overlay: HTMLElement | null
  animations: Animation[]
}

function pageSections() {
  return [...document.querySelectorAll<HTMLElement>(
    '.workspace-scroll .library-view > :not(.alphabet-browser), .workspace-scroll .library-view > .alphabet-browser > .alphabet-browser__groups, .workspace-scroll .ipod-page',
  )].filter((element) => element.getClientRects().length)
}

function clonePageContent(source: HTMLElement, viewportBounds: DOMRect): HTMLElement {
  const repeated = '.track-list, .album-grid, .library-card-grid'
  let copy: HTMLElement
  if (source.matches(repeated)) {
    copy = source.cloneNode(false) as HTMLElement
    const bounds = source.getBoundingClientRect()
    Object.assign(copy.style, { display: 'block', position: 'relative', height: `${bounds.height}px` })
    // A large library can contain thousands of rows/cards. Keep the container's
    // geometry but only clone what the exiting viewport can actually show.
    for (const child of [...source.children]) {
      if (!(child instanceof HTMLElement)) continue
      const rect = child.getBoundingClientRect()
      if (rect.bottom < viewportBounds.top - 12 || rect.top > viewportBounds.bottom + 12) continue
      const item = child.cloneNode(true) as HTMLElement
      Object.assign(item.style, {
        position: 'absolute', left: `${rect.left - bounds.left - source.clientLeft}px`,
        top: `${rect.top - bounds.top - source.clientTop}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, margin: '0',
        contentVisibility: 'visible',
      })
      copy.append(item)
    }
  } else if (source.querySelector(repeated)) {
    copy = source.cloneNode(false) as HTMLElement
    for (const child of [...source.childNodes]) {
      copy.append(child instanceof HTMLElement ? clonePageContent(child, viewportBounds) : child.cloneNode(true))
    }
  } else {
    copy = source.cloneNode(true) as HTMLElement
  }
  // WAAPI state is not copied by cloneNode. Freeze a currently moving section
  // in its on-screen state before cancelling an interrupted transition.
  const style = getComputedStyle(source)
  if (style.transform && style.transform !== 'none') copy.style.transform = style.transform
  if (style.opacity) copy.style.opacity = style.opacity
  return copy
}

function snapshotPage(viewport: HTMLElement) {
  const page = viewport.querySelector<HTMLElement>('.library-view, .ipod-page')
  if (!page || !page.getClientRects().length) return null
  const viewportBounds = viewport.getBoundingClientRect()
  const pageBounds = page.getBoundingClientRect()
  const overlay = document.createElement('div')
  overlay.className = 'page-exit-snapshot'
  overlay.setAttribute('aria-hidden', 'true')
  overlay.setAttribute('inert', '')
  Object.assign(overlay.style, {
    left: `${viewportBounds.left}px`, top: `${viewportBounds.top}px`,
    width: `${viewportBounds.width}px`, height: `${viewportBounds.height}px`,
  })
  const motion = document.createElement('div')
  motion.className = 'page-exit-snapshot__motion'
  const copy = clonePageContent(page, viewportBounds)
  // The fixed rail stays in the real page, outside the moving snapshot.
  copy.querySelectorAll('.alphabet-index').forEach((element) => element.remove())
  copy.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
  copy.removeAttribute('id')
  Object.assign(copy.style, {
    position: 'absolute', left: `${pageBounds.left - viewportBounds.left}px`,
    top: `${pageBounds.top - viewportBounds.top}px`, width: `${pageBounds.width}px`,
    maxWidth: 'none', margin: '0', transform: 'none',
  })
  motion.append(copy)
  overlay.append(motion)
  document.body.append(overlay)
  return { overlay, motion }
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
  let pageEntry: PageEntry | null = null
  let albumEntry: AlbumEntry | null = null

  function cancelPage() {
    if (!pageEntry) return
    const previous = pageEntry
    pageEntry = null
    previous.animations.forEach((animation) => animation.cancel())
    previous.overlay?.remove()
    previous.viewport.classList.remove('page-transition-exiting')
  }

  function cancelAlbum() {
    if (!albumEntry) return
    const previous = albumEntry
    albumEntry = null
    previous.animations.forEach((animation) => animation.cancel())
    previous.overlay?.remove()
    document.body.classList.remove('album-entry-pending')
  }

  async function transitionPage(isCurrent: () => boolean) {
    const skip = reducedMotion() || Boolean(albumEntry)
    const viewport = document.querySelector<HTMLElement>('.workspace-scroll')
    const snapshot = !skip && viewport ? snapshotPage(viewport) : null
    cancelPage()
    if (skip || !viewport) return
    const entry: PageEntry = { viewport, overlay: snapshot?.overlay ?? null, animations: [] }
    pageEntry = entry
    viewport.classList.add('page-transition-exiting')
    try {
      const exit = snapshot?.motion.animate([
        { transform: 'translateX(0)' },
        { transform: 'translateX(-12px)' },
      ], { duration: 110, easing: 'ease-in', fill: 'both' })
      if (exit) {
        entry.animations.push(exit)
        // Attach the rejection handler immediately, including same-tick cancels.
        void exit.finished.catch(() => {})
      }
      // The pre-navigation sync watcher runs before state assignments queue a
      // Vue render. Yield once so nextTick can wait for that upcoming patch.
      await Promise.resolve()
      await nextTick()
      if (exit) await Promise.allSettled([exit.finished])
      if (pageEntry !== entry || !isCurrent()) return

      // Sections move together; never transform the ancestor of the fixed rail.
      for (const element of pageSections()) {
        entry.animations.push(element.animate([
          { transform: 'translateX(18px)' },
          { transform: 'translateX(0)' },
        ], { duration: 180, easing: 'cubic-bezier(.2,.78,.16,1)', fill: 'both' }))
      }
      viewport.classList.remove('page-transition-exiting')
      entry.overlay?.remove()
      entry.overlay = null
      await Promise.allSettled(entry.animations.map((animation) => animation.finished))
    } finally {
      // Old cancelled work must not unhide or remove the next transition.
      if (pageEntry === entry) cancelPage()
    }
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
    transitionPage,
    openAlbum,
    cancelPage,
    cancelAlbum,
    get albumId() { return albumEntry?.albumId ?? null },
    cancel() { cancelPage(); cancelAlbum() },
  }
}
