<script setup lang="ts">
import type { DisplayTrack, PlayerUiState, RouteSceneData } from '../types/music'
import type { PlaylistInfo } from 'foo-webview-sdk'
import type { IpodDeviceStatus, IpodMainAction } from '../composables/useFoobar'
import LibraryView from './LibraryView.vue'
import MediaLibraryView from './MediaLibraryView.vue'
import IpodManagerView from './IpodManagerView.vue'

defineOptions({ inheritAttrs: false })
defineProps<{
  scene: RouteSceneData
  controls: {
    ipod: { connected: boolean; installed: boolean; version: string; status: IpodDeviceStatus; probing: boolean; availableActions: Record<IpodMainAction, boolean>; playlists: PlaylistInfo[] }
    media: { currentTrack: DisplayTrack | null; isPlaying: boolean; folderSelectionMode: boolean; selectedFolderIds: string[]; alphabetIndexView: boolean; dragActive: boolean }
    library: { currentTrack: DisplayTrack | null; isPlaying: boolean; importing: boolean; libraryFilters: PlayerUiState['libraryFilters']; filterOptions: { artists: string[]; albumArtists: string[]; genres: string[]; folders: string[] }; customColumn: PlayerUiState['customColumn']; albumSelectionMode: boolean; selectedAlbumIds: string[]; alphabetIndexView: boolean; dragActive: boolean }
  }
}>()
</script>

<template>
  <div class="route-scene" :data-route-key="scene.key">
    <IpodManagerView v-if="scene.route.view === 'ipod'" v-bind="{ ...controls.ipod, ...$attrs }" />
    <MediaLibraryView
      v-else-if="['overview', 'artists', 'artist', 'folders', 'folder'].includes(scene.route.view)"
      v-bind="{ ...controls.media, ...$attrs }"
      :route="scene.route"
      :stats="scene.stats"
      :artists="scene.artists"
      :folders="scene.folders"
      :albums="scene.albums"
      :tracks="scene.tracks"
      :loading="scene.loading || scene.searchLoading"
    />
    <LibraryView
      v-else
      v-bind="{ ...controls.library, ...$attrs }"
      :view="scene.route.view"
      :albums="scene.albums"
      :tracks="scene.tracks"
      :active-playlist="scene.activePlaylist"
      :selected-album="scene.selectedAlbum"
      :loading="scene.loading"
      :search="scene.search"
      :search-loading="scene.searchLoading"
      :search-artists="scene.searchArtists"
    />
  </div>
</template>
