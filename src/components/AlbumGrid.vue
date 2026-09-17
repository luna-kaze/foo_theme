<script setup lang="ts">
import type { AlbumCard } from '../types/music'
import ArtworkImage from './ArtworkImage.vue'

defineProps<{
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
</script>

<template>
  <div class="album-grid" :class="{ 'selection-mode': selectionMode }">
    <article v-for="album in albums.slice(0, limit ?? albums.length)" :key="album.id" class="album-card" :class="{ selected: selectedIds?.includes(album.id) }" :data-layout-key="`album:${album.id}`" @contextmenu.prevent.stop="emit('menu', album, $event)">
      <div class="album-card__art" role="button" tabindex="0" @click="emit('open', album)" @keydown.enter.stop="emit('open', album)" @keydown.space.stop.prevent="emit('open', album)">
        <ArtworkImage :src="album.artworkUrl" :alt="`${album.name} 封面`" />
        <label class="album-card__select" @click.stop><input type="checkbox" :aria-label="`选择专辑 ${album.name}`" :checked="selectedIds?.includes(album.id)" @change="emit('selection', album, ($event.currentTarget as HTMLInputElement).checked)" /></label>
      </div>
      <button class="album-card__title" @click="emit('open', album)">{{ album.name }}</button>
      <p>{{ album.artist }}<template v-if="album.year"> · {{ album.year }}</template></p>
    </article>
  </div>
</template>
