<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, FileMusic, FolderOpen, Grid3X3, ListTree, Play, Radio, SearchX, Shuffle } from '@lucide/vue'
import type { AlbumCard, ArtistCard, DisplayTrack, LibraryFilterRule, ViewId } from '../types/music'
import type { PlaylistInfo } from 'foo-webview-sdk'
import AlbumGrid from './AlbumGrid.vue'
import ArtworkImage from './ArtworkImage.vue'
import TrackList from './TrackList.vue'
import LibraryFilterBar from './LibraryFilterBar.vue'
import AlphabetIndexRail from './AlphabetIndexRail.vue'
import type { PlayerUiState } from '../types/music'
import { useAlphabetGroups, useAlphabetNavigation } from '../utils/alphabetIndex'
import { animateLayoutReorder } from '../utils/layoutTransition'

const props = defineProps<{
  view: ViewId
  albums: AlbumCard[]
  tracks: DisplayTrack[]
  currentTrack: DisplayTrack | null
  activePlaylist: PlaylistInfo | null
  selectedAlbum: AlbumCard | null
  isPlaying: boolean
  loading: boolean
  search: string
  searchLoading: boolean
  searchBusy?: boolean
  importing: boolean
  libraryFilters: PlayerUiState['libraryFilters']
  filterOptions: { artists: string[]; albumArtists: string[]; genres: string[]; folders: string[] }
  customColumn: PlayerUiState['customColumn']
  albumSelectionMode: boolean
  selectedAlbumIds: string[]
  searchArtists: ArtistCard[]
  alphabetIndexView: boolean
  dragActive?: boolean
}>()

const albumGroups = useAlphabetGroups(() => props.albums, (album) => album.name, (album) => album.sortName ?? '')
const orderedAlbums = computed(() => albumGroups.value.flatMap((group) => group.items))
const albumLetters = computed(() => albumGroups.value.map((group) => group.letter))
const { activeLetter: activeAlbumLetter, registerGroup: registerAlbumGroup, jumpToLetter: jumpToAlbumLetter } = useAlphabetNavigation()
const searchArtistArtwork = computed(() => Object.fromEntries(props.albums.filter((album) => album.artworkUrl).map((album) => [album.artist, album.artworkUrl])))
const viewRoot = ref<HTMLElement | null>(null)
const layoutAnimating = ref(false)
let resultsActive = false
let resultsRequest = 0
let resultsAnimations: Animation[] = []
function stopResultsAnimation() {
  resultsRequest += 1
  resultsAnimations.forEach((animation) => animation.cancel())
  resultsAnimations = []
}
onMounted(() => { resultsActive = true })
onActivated(() => { resultsActive = true })
onDeactivated(() => { resultsActive = false; stopResultsAnimation() })
onBeforeUnmount(stopResultsAnimation)
watch(() => props.searchBusy, (busy) => { if (busy) stopResultsAnimation() })
watch(() => props.search, async (query, previous) => {
  if (!resultsActive || props.view !== 'search' || query === previous) return
  stopResultsAnimation()
  const request = resultsRequest
  await nextTick()
  if (request !== resultsRequest || !viewRoot.value?.isConnected || globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const parts = [...viewRoot.value.querySelectorAll<HTMLElement>('.search-albums, .search-artists, .track-list, .collection-empty')].filter((element) => element.getClientRects().length)
  const animations = parts.map((element) => element.animate([{ opacity: .82 }, { opacity: 1 }], { duration: 180, easing: 'ease-out', fill: 'both' }))
  resultsAnimations = animations
  await Promise.allSettled(animations.map((animation) => animation.finished))
  if (request === resultsRequest) { animations.forEach((animation) => animation.cancel()); resultsAnimations = [] }
})
let layoutRequest = 0

async function toggleAlphabetIndexView() {
  const request = ++layoutRequest
  layoutAnimating.value = true
  try {
    await animateLayoutReorder(viewRoot.value, () => emit('alphabetIndexView', !props.alphabetIndexView))
  } finally {
    if (request === layoutRequest) layoutAnimating.value = false
  }
}

const emit = defineEmits<{
  navigate: [view: ViewId]
  playAlbum: [album: AlbumCard]
  playTrack: [track: DisplayTrack, index: number]
  openAlbum: [album: AlbumCard]
  shuffle: []
  back: []
  trackMenu: [track: DisplayTrack, index: number, event: MouseEvent]
  openFiles: []
  openFolder: []
  clearSearch: []
  albumMenu: [album: AlbumCard, event: MouseEvent]
  artist: [name: string]
  artistMenu: [artist: ArtistCard, event: MouseEvent]
  selection: [tracks: DisplayTrack[]]
  filterFacetChange: [key: 'artist' | 'albumArtist' | 'folder' | 'rating' | 'favourite', value: string]
  filterRuleAdd: []
  filterRuleUpdate: [id: string, patch: Partial<Pick<LibraryFilterRule, 'field' | 'operator' | 'value'>>]
  filterRuleRemove: [id: string]
  clearFilters: []
  reorder: [from: number, to: number, after: boolean, selectedIndexes?: number[]]
  addToPlaylist: [tracks: DisplayTrack[], playlistIndex: number]
  moveToPlaylist: [tracks: DisplayTrack[], sourcePlaylistIndex: number, destinationPlaylistIndex: number]
  removeFromPlaylist: [tracks: DisplayTrack[], playlistIndex: number]
  insertIntoPlaylist: [tracks: DisplayTrack[], sourcePlaylistIndex: number | null, destinationPlaylistIndex: number, targetIndex: number, after: boolean, move: boolean]
  playlistHover: [playlistIndex: number | null]
  dragState: [active: boolean]
  addToIpod: [tracks: DisplayTrack[]]
  albumSelection: [album: AlbumCard, selected: boolean]
  cancelAlbumSelection: []
  alphabetIndexView: [enabled: boolean]
}>()
</script>

<template>
  <main ref="viewRoot" class="library-view" :aria-busy="view === 'search' && searchBusy" :data-detail-album="view === 'album' ? selectedAlbum?.id : undefined">
    <div v-if="loading || (searchLoading && view !== 'search')" class="library-loading">
      <span /><span /><span />
      <small>{{ searchLoading ? '正在搜索音乐库…' : '正在加载音乐…' }}</small>
    </div>

    <template v-else-if="view === 'home'">
      <section class="hero">
        <p class="eyebrow">畅听你的音乐</p>
        <h1>晚上好。</h1>
        <p class="hero__copy">从上次离开的地方继续，或重新发现音乐库中的精彩内容。</p>
        <div class="hero__actions">
          <button v-if="tracks.length" class="primary-button" @click="emit('playTrack', tracks[0], 0)"><Play :size="17" fill="currentColor" /> 播放</button>
          <button v-if="tracks.length" class="secondary-button" @click="emit('shuffle')"><Shuffle :size="17" /> 随机播放全部</button>
          <button v-else class="primary-button" :disabled="importing" @click="emit('openFiles')"><FileMusic :size="17" /> 打开音乐</button>
        </div>
      </section>

      <section class="content-section">
        <div class="section-heading">
          <div><p class="eyebrow">音乐收藏</p><h2>最近添加</h2></div>
          <button @click="emit('navigate', 'albums')">查看全部 <ArrowRight :size="16" /></button>
        </div>
        <AlbumGrid v-if="albums.length" :albums="albums" :limit="6" @open="emit('openAlbum', $event)" @menu="(album, event) => emit('albumMenu', album, event)" />
        <div v-else class="collection-empty"><FileMusic :size="28" /><strong>音乐库中还没有专辑</strong><span>立即打开音乐，或在 foobar2000 首选项中添加需要长期索引的文件夹。</span><div><button class="primary-button" @click="emit('openFiles')">打开文件</button><button class="secondary-button" @click="emit('openFolder')">打开文件夹</button></div></div>
      </section>

      <section class="content-section content-section--tracks">
        <div class="section-heading">
           <div><p class="eyebrow">最近添加</p><h2>最近添加曲目</h2></div>
          <button @click="emit('navigate', 'songs')">查看全部 <ArrowRight :size="16" /></button>
        </div>
        <TrackList
          v-if="tracks.length"
          :tracks="tracks.slice(0, 8)"
          :current-track="currentTrack"
          :is-playing="isPlaying"
          @play="(track, index) => emit('playTrack', track, index)"
          @menu="(track, index, event) => emit('trackMenu', track, index, event)"
         @selection="emit('selection', $event)"
         @add-to-playlist="(selected, playlistIndex) => emit('addToPlaylist', selected, playlistIndex)"
         @insert-into-playlist="(selected, sourcePlaylistIndex, destinationPlaylistIndex, targetIndex, after, move) => emit('insertIntoPlaylist', selected, sourcePlaylistIndex, destinationPlaylistIndex, targetIndex, after, move)"
         @playlist-hover="emit('playlistHover', $event)"
         @drag-state="emit('dragState', $event)"
         @add-to-ipod="emit('addToIpod', $event)"
        />
      </section>
    </template>

    <template v-else-if="view === 'albums'">
      <section class="page-heading page-heading--row"><div><p class="eyebrow">音乐库</p><h1>{{ albumSelectionMode ? `已选择 ${selectedAlbumIds.length} 张专辑` : '专辑' }}</h1><p>收藏中共有 {{ albums.length }} 张专辑</p></div><div class="page-heading__actions"><button class="secondary-button view-mode-toggle" :class="{ active: alphabetIndexView, 'is-animating': layoutAnimating }" @click="toggleAlphabetIndexView"><span class="view-mode-toggle__icon"><ListTree :class="{ visible: alphabetIndexView }" :size="16" /><Grid3X3 :class="{ visible: !alphabetIndexView }" :size="16" /></span>{{ alphabetIndexView ? '索引视图' : '网格视图' }}</button><button v-if="albumSelectionMode" class="secondary-button" @click="emit('cancelAlbumSelection')">退出选择</button></div></section>
      <div v-if="albums.length && alphabetIndexView" class="alphabet-browser">
        <div class="alphabet-browser__groups">
          <section v-for="group in albumGroups" :key="group.letter" :ref="(element) => registerAlbumGroup(group.letter, element)" class="alphabet-group">
            <header class="alphabet-group__heading" data-layout-chrome="heading"><strong>{{ group.letter }}</strong><span /></header>
            <AlbumGrid :albums="group.items" :selection-mode="albumSelectionMode" :selected-ids="selectedAlbumIds" @open="emit('openAlbum', $event)" @menu="(album, event) => emit('albumMenu', album, event)" @selection="(album, selected) => emit('albumSelection', album, selected)" />
          </section>
        </div>
        <AlphabetIndexRail data-layout-chrome="rail" :available="albumLetters" :active="activeAlbumLetter" @select="jumpToAlbumLetter" />
      </div>
      <AlbumGrid v-else-if="albums.length" :albums="orderedAlbums" :selection-mode="albumSelectionMode" :selected-ids="selectedAlbumIds" @open="emit('openAlbum', $event)" @menu="(album, event) => emit('albumMenu', album, event)" @selection="(album, selected) => emit('albumSelection', album, selected)" />
      <div v-else class="collection-empty"><FileMusic :size="30" /><strong>没有找到专辑</strong><span>打开本地音乐，或在 foobar2000 首选项中更新监视文件夹。</span><div><button class="primary-button" @click="emit('openFiles')">打开文件</button><button class="secondary-button" @click="emit('openFolder')">打开文件夹</button></div></div>
    </template>

    <template v-else-if="view === 'album'">
      <section class="album-detail-heading">
        <button class="album-detail-heading__back" @click="emit('back')"><ArrowLeft :size="17" /> 返回</button>
        <div class="album-detail-heading__art"><ArtworkImage :src="selectedAlbum?.artworkUrl" :alt="`${selectedAlbum?.name ?? '专辑'} 封面`" /></div>
        <div class="album-detail-heading__copy">
          <p class="eyebrow">专辑</p>
          <h1>{{ selectedAlbum?.name }}</h1>
          <p>{{ selectedAlbum?.artist }}<template v-if="selectedAlbum?.year"> · {{ selectedAlbum.year }}</template> · {{ tracks.length }} 首曲目</p>
          <div class="hero__actions">
            <button class="primary-button" @click="selectedAlbum && emit('playAlbum', selectedAlbum)"><Play :size="17" fill="currentColor" /> 播放专辑</button>
            <button class="secondary-button" @click="emit('shuffle')"><Shuffle :size="17" /> 随机播放</button>
          </div>
        </div>
      </section>
    </template>

    <template v-else>
      <section class="page-heading page-heading--row">
        <div>
          <p class="eyebrow">{{ view === 'playlist' ? '播放列表' : view === 'radio' ? '发现' : view === 'search' ? '搜索' : '音乐库' }}</p>
          <h1>{{ view === 'playlist' ? activePlaylist?.name ?? '播放列表' : view === 'favourites' ? '收藏' : view === 'radio' ? '音乐库电台' : view === 'search' ? `“${search}”的搜索结果` : '歌曲' }}</h1>
          <p>{{ tracks.length }} 首曲目</p>
        </div>
        <div class="page-heading__actions">
          <button v-if="view === 'radio'" class="secondary-button" @click="emit('navigate', 'radio')"><Radio :size="17" /> 换一批</button>
          <button v-else-if="tracks.length && view !== 'search'" class="secondary-button" @click="emit('shuffle')"><Shuffle :size="17" /> 随机播放</button>
          <button v-if="tracks.length" class="round-play" aria-label="播放全部" @click="emit('playTrack', tracks[0], 0)"><Play :size="22" fill="currentColor" /></button>
        </div>
      </section>
      <LibraryFilterBar v-if="view === 'songs'" :filters="libraryFilters" :options="filterOptions" :result-count="tracks.length" @facet-change="(key, value) => emit('filterFacetChange', key, value)" @rule-add="emit('filterRuleAdd')" @rule-update="(id, patch) => emit('filterRuleUpdate', id, patch)" @rule-remove="emit('filterRuleRemove', $event)" @clear="emit('clearFilters')" />
      <section v-if="view === 'search' && albums.length" class="content-section search-albums">
        <div class="section-heading"><div><p class="eyebrow">专辑</p><h2>匹配的专辑</h2></div><span>{{ albums.length }}</span></div>
        <AlbumGrid :albums="albums" :limit="6" @open="emit('openAlbum', $event)" @menu="(album, event) => emit('albumMenu', album, event)" />
      </section>
      <section v-if="view === 'search' && searchArtists.length" class="content-section search-artists">
        <div class="section-heading"><div><p class="eyebrow">艺术家</p><h2>匹配的艺术家</h2></div><span>{{ searchArtists.length }}</span></div>
        <div class="library-card-grid search-artists__grid">
          <button v-for="artist in searchArtists" :key="artist.name" class="artist-browser-card" @click="emit('artist', artist.name)" @contextmenu.prevent.stop="emit('artistMenu', artist, $event)">
            <span class="artist-browser-card__art" :style="searchArtistArtwork[artist.name] ? { backgroundImage: `url(${searchArtistArtwork[artist.name]})` } : {}"><i v-if="!searchArtistArtwork[artist.name]">{{ artist.name.slice(0, 1).toLocaleUpperCase() }}</i></span>
            <strong>{{ artist.name }}</strong><small>{{ artist.trackCount }} 首曲目 · {{ artist.albumCount }} 张专辑</small>
          </button>
        </div>
      </section>
      <div v-if="!tracks.length && !dragActive && (view !== 'search' || (!albums.length && !searchArtists.length))" class="collection-empty">
        <SearchX v-if="view === 'search'" :size="30" /><FileMusic v-else :size="30" />
        <strong>{{ view === 'search' ? '没有匹配的音乐' : view === 'favourites' ? '还没有收藏曲目' : view === 'playlist' ? '这个播放列表是空的' : '没有可显示的音乐' }}</strong>
        <span>{{ view === 'search' ? '请减少关键词，或按标题、艺人、专辑和流派搜索。' : view === 'favourites' ? '在任意曲目的操作菜单中点按收藏，即可保存在这里。' : '打开文件或文件夹后，曲目会显示在“已打开的音乐”播放列表中。' }}</span>
        <div><button v-if="view === 'search'" class="secondary-button" @click="emit('clearSearch')">清除搜索</button><template v-else><button class="primary-button" @click="emit('openFiles')"><FileMusic :size="16" /> 打开文件</button><button class="secondary-button" @click="emit('openFolder')"><FolderOpen :size="16" /> 打开文件夹</button></template></div>
      </div>
    </template>
    <TrackList
      v-show="(view === 'album' || (view !== 'home' && view !== 'albums' && view !== 'artists' && view !== 'folders')) && (tracks.length || dragActive)"
      :tracks="tracks"
      :current-track="currentTrack"
      :is-playing="isPlaying"
      :reorderable="view === 'playlist' && !activePlaylist?.isLocked && !activePlaylist?.isAutoplaylist"
      :playlist-index="view === 'playlist' ? activePlaylist?.index : undefined"
      :custom-column-label="customColumn.label"
      @play="(track, index) => emit('playTrack', track, index)"
      @menu="(track, index, event) => emit('trackMenu', track, index, event)"
      @selection="emit('selection', $event)"
      @reorder="(from, to, after, selectedIndexes) => emit('reorder', from, to, after, selectedIndexes)"
      @add-to-playlist="(selected, playlistIndex) => emit('addToPlaylist', selected, playlistIndex)"
      @move-to-playlist="(selected, sourcePlaylistIndex, destinationPlaylistIndex) => emit('moveToPlaylist', selected, sourcePlaylistIndex, destinationPlaylistIndex)"
      @remove-from-playlist="(selected, playlistIndex) => emit('removeFromPlaylist', selected, playlistIndex)"
      @insert-into-playlist="(selected, sourcePlaylistIndex, destinationPlaylistIndex, targetIndex, after, move) => emit('insertIntoPlaylist', selected, sourcePlaylistIndex, destinationPlaylistIndex, targetIndex, after, move)"
      @playlist-hover="emit('playlistHover', $event)"
      @drag-state="emit('dragState', $event)"
      @add-to-ipod="emit('addToIpod', $event)"
    />
  </main>
</template>
