<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Activity, Disc3, Edit3, FileAudio, Gauge, Info, Star, X } from '@lucide/vue'
import type { AlbumCard, DisplayTrack, TrackDetails } from '../types/music'
import ArtworkImage from './ArtworkImage.vue'
import { formatTime } from '../utils/format'

const props = defineProps<{ mode: 'properties' | 'edit'; tracks: DisplayTrack[]; details: TrackDetails[]; album: AlbumCard | null; loading: boolean; busy: boolean }>()
const emit = defineEmits<{ close: []; save: [tags: Record<string, string>]; rating: [rating: number]; scanReplayGain: [mode: 'track' | 'album']; clearReplayGain: []; embedArtwork: [type: 'front' | 'back' | 'disc' | 'artist']; removeArtwork: [type: 'front' | 'back' | 'disc' | 'artist'] }>()
const tab = ref<'details' | 'technical' | 'replaygain' | 'artwork'>('details')
const fields = reactive<Record<string, string>>({})
const tagFields = [['TITLE', '标题'], ['ARTIST', '艺人'], ['ALBUM', '专辑'], ['ALBUM ARTIST', 'Album Artist'], ['GENRE', '流派'], ['DATE', '日期'], ['TRACKNUMBER', '音轨号'], ['DISCNUMBER', '碟片号']] as const
const first = computed(() => props.details[0])
const heading = computed(() => props.album?.name || props.tracks[0]?.title || '曲目属性')
const subtitle = computed(() => props.album?.artist || (props.tracks.length > 1 ? `${props.tracks.length} 首曲目` : `${props.tracks[0]?.artist || '未知艺人'} · ${props.tracks[0]?.album || '未知专辑'}`))
const artwork = computed(() => props.album?.artworkUrl || props.tracks[0]?.artworkUrl || '')
const rating = computed(() => Number(props.details[0]?.rating ?? 0))
const mixedRating = computed(() => props.details.some((item) => Number(item.rating ?? 0) !== rating.value))

function tagValue(tags: Record<string, string | string[]>, key: string) {
  const value = tags[key] ?? tags[key.replace(' ', '_')] ?? tags[key.replace(' ', '')]
  return Array.isArray(value) ? value.join('; ') : value ?? ''
}

watch(() => props.details, (details) => {
  for (const [key] of tagFields) {
    const values = details.map((item) => tagValue(item.tags, key))
    fields[key] = values.length && values.every((value) => value === values[0]) ? values[0] : ''
  }
}, { immediate: true, deep: true })

function save() {
  const tags = Object.fromEntries(tagFields.map(([key]) => [key, fields[key].trim()]).filter(([, value]) => props.tracks.length === 1 || value))
  emit('save', tags)
}

function setRating(value: number) {
  emit('rating', !mixedRating.value && rating.value === value ? 0 : value)
}
</script>

<template>
  <div class="inspector-scrim" @pointerdown.self="emit('close')">
    <section class="track-inspector" role="dialog" aria-modal="true" :aria-label="mode === 'edit' ? '编辑标签' : '属性'">
      <header class="track-inspector__header"><ArtworkImage :src="artwork" :alt="`${heading} 封面`" /><div><small>{{ album ? '专辑' : tracks.length > 1 ? '批量选择' : '曲目' }}</small><h2>{{ heading }}</h2><p>{{ subtitle }}</p></div><button aria-label="关闭" @click="emit('close')"><X :size="18" /></button></header>
      <div v-if="loading" class="inspector-loading"><span /><strong>正在读取元数据…</strong></div>
      <template v-else>
        <nav v-if="mode === 'properties' && tracks.length === 1" class="track-inspector__tabs"><button :class="{ active: tab === 'details' }" @click="tab = 'details'"><Info :size="15" />详细信息</button><button :class="{ active: tab === 'technical' }" @click="tab = 'technical'"><FileAudio :size="15" />技术信息</button><button :class="{ active: tab === 'replaygain' }" @click="tab = 'replaygain'"><Gauge :size="15" />ReplayGain</button><button :class="{ active: tab === 'artwork' }" @click="tab = 'artwork'"><Disc3 :size="15" />封面</button></nav>
        <div v-if="mode === 'edit'" class="metadata-editor"><p v-if="tracks.length > 1" class="inspector-note">批量编辑时，留空字段保持原值不变。</p><label v-for="([key, label]) in tagFields" :key="key"><span>{{ label }}</span><input v-model="fields[key]" :placeholder="tracks.length > 1 ? '多个值 / 保持不变' : ''" /></label><footer><button class="secondary-button" @click="emit('close')">取消</button><button class="primary-button" :disabled="busy" @click="save"><Edit3 :size="15" />{{ busy ? '正在保存…' : '保存标签' }}</button></footer></div>
        <div v-else-if="tracks.length > 1" class="inspector-content inspector-batch-details">
          <p>逐首属性</p>
          <div class="inspector-batch-details__table-wrap">
            <table>
              <thead><tr><th>标题</th><th>艺人</th><th>专辑</th><th>时长</th><th>格式</th><th>码率</th><th>采样率</th><th>声道</th><th>评分</th><th>路径</th></tr></thead>
              <tbody><tr v-for="detail in details" :key="detail.path || `${detail.track.path}:${detail.track.subsong ?? 0}`"><td>{{ detail.track.title || '未命名曲目' }}</td><td>{{ detail.track.artist || '未知艺人' }}</td><td>{{ detail.track.album || '未知专辑' }}</td><td>{{ formatTime(detail.info.duration ?? detail.track.duration ?? 0) }}</td><td>{{ detail.info.codec || '—' }}</td><td>{{ detail.info.bitrate ? `${detail.info.bitrate} kbps` : '—' }}</td><td>{{ detail.info.sampleRate ? `${detail.info.sampleRate} Hz` : '—' }}</td><td>{{ detail.info.channels ?? '—' }}</td><td>{{ detail.rating || '—' }}</td><td class="inspector-batch-details__path">{{ detail.path || detail.track.path || '—' }}</td></tr></tbody>
            </table>
          </div>
        </div>
        <div v-else-if="tab === 'details'" class="inspector-content"><div class="inspector-rating"><span>{{ tracks.length > 1 ? `批量评分（${tracks.length} 首${mixedRating ? '，多个值' : ''}）` : '评分' }}</span><div><button v-for="value in 5" :key="value" :aria-label="`${value} 星`" @click="setRating(value)"><Star :size="20" :fill="!mixedRating && rating >= value ? 'currentColor' : 'none'" /></button></div></div><dl><template v-for="([key, label]) in tagFields" :key="key"><dt>{{ label }}</dt><dd>{{ tagValue(first?.tags ?? {}, key) || '—' }}</dd></template><dt>播放次数</dt><dd>{{ first?.playCount ?? 0 }}</dd><dt>最后播放</dt><dd>{{ first?.lastPlayed || '从未播放' }}</dd><dt>添加时间</dt><dd>{{ first?.added || '—' }}</dd><dt>位置</dt><dd class="inspector-path">{{ first?.path || '—' }}</dd></dl></div>
        <div v-else-if="tab === 'technical'" class="inspector-content"><dl><dt>编码</dt><dd>{{ first?.info.codec || '—' }}</dd><dt>码率</dt><dd>{{ first?.info.bitrate ? `${first.info.bitrate} kbps` : '—' }}</dd><dt>采样率</dt><dd>{{ first?.info.sampleRate ? `${first.info.sampleRate} Hz` : '—' }}</dd><dt>声道</dt><dd>{{ first?.info.channels ?? '—' }}</dd><dt>时长</dt><dd>{{ first?.info.duration ?? tracks[0]?.duration ?? 0 }} 秒</dd><dt>Subsong</dt><dd>{{ tracks[0]?.subsong ?? 0 }}</dd></dl></div>
        <div v-else-if="tab === 'replaygain'" class="inspector-content inspector-replaygain"><Activity :size="28" /><dl><dt>Track Gain</dt><dd>{{ first?.replayGain.trackGain || '未扫描' }}</dd><dt>Track Peak</dt><dd>{{ first?.replayGain.trackPeak || '—' }}</dd><dt>Album Gain</dt><dd>{{ first?.replayGain.albumGain || '未扫描' }}</dd><dt>Album Peak</dt><dd>{{ first?.replayGain.albumPeak || '—' }}</dd></dl><footer><button class="secondary-button" :disabled="busy" @click="emit('scanReplayGain', 'track')"><Gauge :size="15" />扫描音轨</button><button class="secondary-button" :disabled="busy" @click="emit('scanReplayGain', 'album')"><Disc3 :size="15" />按专辑扫描</button><button class="danger-button" :disabled="busy || !first?.replayGain.hasReplayGain" @click="emit('clearReplayGain')">清除 ReplayGain</button></footer></div>
        <div v-else class="inspector-content inspector-artwork"><ArtworkImage :src="artwork" :alt="`${heading} 封面`" /><p>封面操作仅作用于普通本地音频文件的嵌入图片，不删除文件夹中的 sidecar 图片。</p><footer><button class="secondary-button" :disabled="busy || tracks.length !== 1" @click="emit('embedArtwork', 'front')">嵌入正面封面</button><button class="danger-button" :disabled="busy || tracks.length !== 1" @click="emit('removeArtwork', 'front')">移除嵌入封面</button></footer></div>
      </template>
    </section>
  </div>
</template>
