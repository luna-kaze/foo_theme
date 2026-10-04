import fb from 'foo-webview-sdk'

export type ContextMenuItem = Parameters<typeof fb.menu.popup>[0][number]

const icon = (content: string): NonNullable<ContextMenuItem['iconSvg']> => ({
  viewBox: '0 0 24 24',
  content,
})

export const menuIcons = {
  play: icon('<polygon points="6 3 20 12 6 21 6 3"/>'),
  next: icon('<path d="M5 4l11 8-11 8z"/><path d="M19 5v14"/>'),
  queue: icon('<path d="M4 6h10M4 12h10M4 18h7"/><path d="M18 15v6M15 18h6"/>'),
  heart: icon('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8z"/>'),
  playlist: icon('<path d="M4 6h12M4 12h9M4 18h7"/><path d="M18 13v8M14 17h8"/>'),
  move: icon('<path d="M4 7h11M12 4l3 3-3 3M20 17H9M12 14l-3 3 3 3"/>'),
  album: icon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/>'),
  folder: icon('<path d="M3 6h7l2 2h9v11H3z"/>'),
  shuffle: icon('<path d="M3 6h3c5 0 7 12 12 12h3"/><path d="M18 15l3 3-3 3M3 18h3c2.5 0 4.2-3 5.8-6M15 6h6M18 3l3 3-3 3"/>'),
  copy: icon('<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  remove: icon('<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  refresh: icon('<path d="M20 6v5h-5M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"/>'),
  undo: icon('<path d="M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  sort: icon('<path d="M4 4v16m-3-3 3 3 3-3M11 9l3-6 3 6m-5-2h4M11 14h7l-7 6h7"/>'),
  sortAlbum: icon('<path d="M4 4v16m-3-3 3 3 3-3"/><rect x="10" y="3" width="10" height="7" rx="1"/><rect x="10" y="14" width="10" height="7" rx="1"/><circle cx="15" cy="6.5" r="1"/><circle cx="15" cy="17.5" r="1"/>'),
  deduplicate: icon('<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 15v4a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-4M6 9h6"/>'),
  invalid: icon('<path d="M14 2H5v20h14V7zM14 2v5h5M8 12l6 6M14 12l-6 6"/>'),
  settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>'),
  info: icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'),
  edit: icon('<path d="M4 20h4l11-11-4-4L4 16zM13.5 6.5l4 4"/>'),
  convert: icon('<path d="M4 7h13M14 4l3 3-3 3M20 17H7M10 14l-3 3 3 3"/>'),
  tag: icon('<path d="M4 5v6l9 9 7-7-9-9H5a1 1 0 0 0-1 1z"/><circle cx="8" cy="8" r="1"/>'),
  device: icon('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 5h4M11 19h2"/>'),
} as const

const contextMenuCss = `
  :root { color-scheme: dark; }
  html, body, #viewport, .fb-menu { scrollbar-width: none !important; }
  html::-webkit-scrollbar, body::-webkit-scrollbar, #viewport::-webkit-scrollbar, .fb-menu::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
  .fb-menu {
    min-width: 268px !important;
    padding: 7px !important;
    color: #efedef !important;
    font: 12px/1.25 "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif !important;
    background: rgba(29, 29, 32, .82) !important;
    border: 1px solid rgba(255, 255, 255, .12) !important;
    border-radius: 13px !important;
    box-shadow: 0 18px 52px rgba(0, 0, 0, .45) !important;
  }
  .fb-item {
    min-height: 35px !important;
    margin: 1px 0 !important;
    padding: 0 11px !important;
    gap: 10px !important;
    color: rgba(244, 242, 244, .82) !important;
    border-radius: 8px !important;
    transition: background 90ms ease, color 90ms ease !important;
  }
  .fb-item [part="item-label"] { min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
  .fb-item.active { color: #fff !important; background: rgba(255, 255, 255, .09) !important; }
  .fb-item.checked { color: #ffaaa7 !important; }
  .fb-item.disabled { opacity: .34 !important; }
  .fb-item-ico { width: 17px !important; height: 17px !important; color: currentColor !important; }
  .fb-item-ico svg { fill: none !important; stroke: currentColor !important; stroke-width: 1.8 !important; stroke-linecap: round !important; stroke-linejoin: round !important; }
  .fb-item-ico polygon { fill: currentColor !important; stroke: none !important; }
  .fb-sep { height: 1px !important; margin: 6px 9px !important; background: rgba(255, 255, 255, .09) !important; }
  .fb-arrow { opacity: .55 !important; }
  .fb-np { min-height: 58px !important; margin-bottom: 4px !important; padding: 7px !important; background: rgba(255, 255, 255, .045) !important; }
  .fb-np-cover { border-radius: 7px !important; }
  .fb-np-title { color: #fff !important; font-weight: 650 !important; }
  .fb-np-subtitle { color: rgba(255, 255, 255, .48) !important; }
  #menu.in .fb-menu { animation: menu-in 120ms cubic-bezier(.2,.8,.2,1); }
  #menu.out .fb-menu { opacity: 0; transform: translateY(-3px) scale(.985); transition: 90ms ease; }
  @keyframes menu-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } }
`

export async function showContextMenu(items: ContextMenuItem[], event: MouseEvent) {
  if (!fb.isAvailable()) return null
  return fb.menu.popup(
    items,
    { x: event.screenX, y: event.screenY },
    {
      windowModel: 'contentSized',
      backdrop: 'acrylic',
      backdropDarkMode: true,
      closeAnimationMs: 90,
      css: contextMenuCss,
    },
  )
}
