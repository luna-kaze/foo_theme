<script setup lang="ts">
import type { AlbumCard } from '../types/music'
import ArtworkImage from './ArtworkImage.vue'

defineProps<{
  albums: AlbumCard[]
  limit?: number
}>()

const emit = defineEmits<{
  open: [album: AlbumCard]
  menu: [album: AlbumCard, event: MouseEvent]
}>()
</script>

<template>
  <div class="album-grid">
    <article v-for="album in albums.slice(0, limit ?? albums.length)" :key="album.id" class="album-card" @contextmenu.prevent.stop="emit('menu', album, $event)">
      <div class="album-card__art" role="button" tabindex="0" @click="emit('open', album)" @keydown.enter.stop="emit('open', album)" @keydown.space.stop.prevent="emit('open', album)">
        <ArtworkImage :src="album.artworkUrl" :alt="`${album.name} 封面`" />
      </div>
      <button class="album-card__title" @click="emit('open', album)">{{ album.name }}</button>
      <p>{{ album.artist }}<template v-if="album.year"> · {{ album.year }}</template></p>
    </article>
  </div>
</template>
