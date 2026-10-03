/** Native scrollbars keep their gutter; only their thumb visibility changes. */
export function installAutoHideScrollbars(doc: Document = document) {
  const view = doc.defaultView
  if (!view) return () => {}
  const timers = new Map<HTMLElement, number>()
  let edges = new Set<HTMLElement>()
  let dragging = new Set<HTMLElement>()
  let frame = 0
  let pointer: { x: number; y: number; path: EventTarget[] } | null = null
  const hideDelay = 900
  const edgeDistance = 18

  function axes(element: HTMLElement) {
    const x = element.scrollWidth > element.clientWidth + 1
    const y = element.scrollHeight > element.clientHeight + 1
    if (!x && !y) return { x: false, y: false, rtl: false }
    const style = view!.getComputedStyle(element)
    return {
      x: x && /^(auto|scroll|overlay)$/.test(style.overflowX),
      y: y && /^(auto|scroll|overlay)$/.test(style.overflowY),
      rtl: style.direction === 'rtl',
    }
  }
  function reveal(element: HTMLElement) {
    const timer = timers.get(element)
    if (timer !== undefined) view!.clearTimeout(timer)
    element.classList.add('scrollbar-active')
    if (edges.has(element) || dragging.has(element)) { timers.set(element, 0); return }
    timers.set(element, view!.setTimeout(() => {
      element.classList.remove('scrollbar-active')
      timers.delete(element)
    }, hideDelay))
  }
  function updateEdges() {
    frame = 0
    const next = new Set<HTMLElement>()
    if (pointer) {
      const { x, y, path } = pointer
      for (const target of path) {
        if (!(target instanceof view!.HTMLElement) || !target.isConnected) continue
        const scroll = axes(target)
        if (!scroll.x && !scroll.y) continue
        const rect = target.getBoundingClientRect()
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue
        const vertical = scroll.y && (scroll.rtl ? x <= rect.left + edgeDistance : x >= rect.right - edgeDistance)
        const horizontal = scroll.x && y >= rect.bottom - edgeDistance
        if (vertical || horizontal) next.add(target)
      }
    }
    const previous = edges
    edges = next
    for (const element of previous) if (!next.has(element)) reveal(element)
    for (const element of next) reveal(element)
  }
  function onPointerMove(event: PointerEvent) {
    if (event.pointerType === 'touch') return
    pointer = { x: event.clientX, y: event.clientY, path: event.composedPath() }
    if (!frame) frame = view!.requestAnimationFrame(updateEdges)
  }
  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'touch') return
    pointer = { x: event.clientX, y: event.clientY, path: event.composedPath() }
    if (frame) view!.cancelAnimationFrame(frame)
    updateEdges()
    dragging = new Set(edges)
  }
  function onPointerUp() {
    const previous = dragging
    dragging = new Set()
    for (const element of previous) reveal(element)
  }
  function clearPointer() {
    const previous = dragging
    pointer = null
    if (frame) view!.cancelAnimationFrame(frame)
    dragging = new Set()
    updateEdges()
    for (const element of previous) reveal(element)
  }
  function onPointerOut(event: PointerEvent) {
    if (!event.relatedTarget) clearPointer()
  }
  function onScroll(event: Event) {
    const element = event.target === doc ? doc.scrollingElement : event.target
    if (!(element instanceof view!.HTMLElement)) return
    const scroll = axes(element)
    if (scroll.x || scroll.y) reveal(element)
  }
  function onWheel(event: WheelEvent) {
    if (event.ctrlKey) return
    for (const target of event.composedPath()) {
      if (!(target instanceof view!.HTMLElement)) continue
      const scroll = axes(target)
      if ((scroll.y && event.deltaY) || (scroll.x && (event.deltaX || (event.shiftKey && event.deltaY)))) {
        reveal(target)
        break
      }
    }
  }
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true })
  doc.addEventListener('wheel', onWheel, { capture: true, passive: true })
  doc.addEventListener('pointermove', onPointerMove, { capture: true, passive: true })
  doc.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
  doc.addEventListener('pointerup', onPointerUp, { capture: true, passive: true })
  doc.addEventListener('pointercancel', clearPointer, true)
  doc.addEventListener('pointerout', onPointerOut, true)
  view.addEventListener('blur', clearPointer)
  return () => {
    if (frame) view.cancelAnimationFrame(frame)
    for (const [element, timer] of timers) {
      view.clearTimeout(timer)
      element.classList.remove('scrollbar-active')
    }
    timers.clear(); edges.clear(); dragging.clear()
    doc.removeEventListener('scroll', onScroll, true)
    doc.removeEventListener('wheel', onWheel, true)
    doc.removeEventListener('pointermove', onPointerMove, true)
    doc.removeEventListener('pointerdown', onPointerDown, true)
    doc.removeEventListener('pointerup', onPointerUp, true)
    doc.removeEventListener('pointercancel', clearPointer, true)
    doc.removeEventListener('pointerout', onPointerOut, true)
    view.removeEventListener('blur', clearPointer)
  }
}
