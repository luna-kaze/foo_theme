# foobar2000 WebView Theme

This is a modern WebView2 interface for foobar2000, built with Vue 3, TypeScript, Vite, and `foo-webview-sdk`. It uses the foobar2000 name and the icon extracted from the local foobar2000 executable. Its information architecture takes cues from Cider 1, while the implementation and visual system are original.

## Features

- Responsive application shell with synchronized, debounced full-library search and explicit result/empty states
- Album grid, album detail, full-library song table, favourites, random library radio, and playlist views
- Persistent playback bar with seek, volume, repeat, and transport controls
- Expanded Now Playing view with synchronized lyric seeking, automatic centered scrolling, manual-scroll pause/resume, and queue editing
- Native file/folder pickers and drag-and-drop. External paths are expanded into a dedicated `Opened Music` playlist and played immediately
- Playlist creation, grouped context menus, rating-backed favourites, stable playlist actions after filtering, navigation history, keyboard shortcuts, and application menu
- Live synchronization through `foo-webview-sdk` playback, library, playlist, queue, artwork, and lyric APIs
- Browser preview mode with representative local data when the WebView2 bridge is unavailable

## Build

```bash
npm install
npm run build
```

The production theme is emitted to `dist/`. Copy the **contents** of that directory to:

```text
<foobar2000 profile>\webview-ui\default\
```

The resulting theme directory must contain `index.html` at its root. Restart foobar2000 or reload the active `foo_ui_webview2` template after copying the files.

## Development

```bash
npm run dev
```

Point the `foo_ui_webview2` development-server setting at the Vite URL (normally `http://localhost:5173`). Opening the same URL in a regular browser activates preview mode.

## Architecture

- `src/composables/useFoobar.ts`: the only application-facing SDK adapter and state synchronization layer
- `src/components/`: presentational shell, library, player, and Now Playing modules
- `src/data/mock.ts`: isolated browser-preview data, never used when the native bridge is available
- `src/types/music.ts`: UI domain types layered over SDK types
- `src/styles/main.css`: design tokens, responsive layout, and component styling

This separation leaves native backdrop/titlebar work in the shell, popup or Mini Player work around the SDK adapter, and full-screen lyric enhancements in `NowPlayingPanel.vue` without coupling them to the library views.

## Local Music

`Open music` accepts files, folders, CUE sheets, and playlist files through foobar2000's native path parser. Opened tracks are placed in the `Opened Music` playlist, so they remain visible and playable even when they are not part of the indexed media library.

The WebView SDK cannot add or remove foobar2000 monitored library folders. Use **Preferences** to manage those folders, then use **Rescan library folders** from the application menu. This distinction is intentional: opening a file must not pretend that it has been permanently indexed by the media library.

## SDK Mapping

| Feature | SDK surface |
| --- | --- |
| Playback and position | `fb.player.*`, `playback:*` events |
| Albums and recent tracks | `fb.library.getAlbums`, `fb.library.getRecentlyAdded` |
| Full-library search | `fb.library.search` |
| Local files and folders | `fb.dialog.openFile`, `fb.dialog.openFolder`, `fb.dnd.*`, `fb.playlist.add` |
| Playlists | `fb.playlist.*`, `playlist:*` events |
| Queue | `fb.queue.get`, `playback:queueChanged` |
| Artwork | `fb.artwork.getFb2kUrl*` |
| Lyrics | `fb.lyrics.get`, `fb.player.seek` |
| Volume and order | `fb.player.getVolume`, `setVolume`, `getOrder`, `setOrder` |
