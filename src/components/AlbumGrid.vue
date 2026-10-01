<script setup lang="ts">
import type { AlbumCard } from '../types/music'
import ArtworkImage from './ArtworkImage.vue'

const props = defineProps<{
  albums: AlbumCard[]
  limit?: number
  selectionMode?: boolean
  selectedIds?: string[]
}>()

const emit = defineEmits<{
  open: [album: AlbumCard]
  menu: [album: AlbumCard, event: MouseEvent]
  selection: [album: AlbumCard, selected: boolean]
}>()

function activateAlbum(album: AlbumCard) {
  if (props.selectionMode) emit('selection', album, !props.selectedIds?.includes(album.id))
  else emit('open', album)
}
</script>

<template>
  <div class="album-grid" :class="{ 'selection-mode': selectionMode }">
    <article v-for="album in albums.slice(0, limit ?? albums.length)" :key="album.id" class="album-card" :class="{ selected: selectionMode && selectedIds?.includes(album.id) }" :data-layout-key="`album:${album.id}`" @click="selectionMode && activateAlbum(album)" @contextmenu.prevent.stop="emit('menu', album, $event)">
      <div class="album-card__art" role="button" tabindex="0" :aria-label="`${selectionMode ? '选择' : '打开'}专辑 ${album.name}`" :aria-pressed="selectionMode ? Boolean(selectedIds?.includes(album.id)) : undefined" @click.stop="activateAlbum(album)" @keydown.enter.stop.prevent="activateAlbum(album)" @keydown.space.stop.prevent="activateAlbum(album)">
        <ArtworkImage :src="album.artworkUrl" :alt="`${album.name} 封面`" />
        <label v-if="selectionMode" class="album-card__select" @click.stop @keydown.stop><input type="checkbox" :aria-label="`选择专辑 ${album.name}`" :checked="selectedIds?.includes(album.id)" @change="emit('selection', album, ($event.currentTarget as HTMLInputElement).checked)" /></label>
      </div>
      <button class="album-card__title" @click.stop="activateAlbum(album)">{{ album.name }}</button>
      <p>{{ album.artist }}<template v-if="album.year"> · {{ album.year }}</template></p>
    </article>
  </div>
</template>
