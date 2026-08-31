<script setup lang="ts">
import { computed, ref } from 'vue'
import { Activity, Cable, Database, FolderSearch, HardDrive, ListMusic, RefreshCw, Settings, ShieldAlert, Smartphone, Unplug, Wrench } from '@lucide/vue'
import type { PlaylistInfo } from 'foo-webview-sdk'
import type { IpodDeviceStatus, IpodMainAction } from '../composables/useFoobar'

const props = defineProps<{
  connected: boolean
  installed: boolean
  version: string
  status: IpodDeviceStatus
  probing: boolean
  availableActions: Record<IpodMainAction, boolean>
  playlists: PlaylistInfo[]
}>()

const emit = defineEmits<{
  action: [action: IpodMainAction]
  refresh: []
  preferences: []
  playlist: [index: number]
}>()

const pendingDanger = ref<IpodMainAction | null>(null)
const available = computed(() => props.connected && props.installed)
const statusCopy = computed(() => ({
  unavailable: ['组件不可用', 'off'],
  unknown: ['等待设备检测', 'idle'],
  connected: ['iPod 已连接', 'online'],
  disconnected: ['未检测到设备', 'off'],
}[props.status]))
const ipodPlaylists = computed(() => props.playlists.filter((playlist) => /ipod|iphone/i.test(playlist.name)))

function requestAction(action: IpodMainAction, dangerous = false) {
  if (!dangerous || pendingDanger.value === action) {
    pendingDanger.value = null
    emit('action', action)
    return
  }
  pendingDanger.value = action
}
</script>

<template>
  <main class="ipod-page">
    <header class="ipod-hero">
      <div>
        <p class="ipod-eyebrow">设备 · foo_dop {{ version || '' }}</p>
        <h1>iPod 管理</h1>
        <p>在主题内组织工作流，设备读写与同步仍由 foo_dop 原生执行。</p>
      </div>
      <div class="ipod-status" :class="`is-${statusCopy[1]}`">
        <span class="ipod-status__dot" />
        <div><strong>{{ statusCopy[0] }}</strong><small>{{ probing ? '正在检查可用命令…' : installed ? '通过上下文命令可用性判断' : '未安装 foo_dop' }}</small></div>
        <button :disabled="!available || probing" aria-label="重新检测 iPod" @click="emit('refresh')"><RefreshCw :size="16" :class="{ spin: probing }" /></button>
      </div>
    </header>

    <section v-if="!installed" class="ipod-notice">
      <ShieldAlert :size="20" />
      <div><strong>未检测到 foo_dop</strong><p>安装组件后可在这里访问设备管理、同步和维护命令。</p></div>
    </section>

    <section class="ipod-quick-actions" aria-label="iPod 快捷操作">
      <button :disabled="!available || !availableActions.devicePanel" @click="requestAction('devicePanel')"><Smartphone :size="22" /><span><strong>设备面板</strong><small>打开 foo_dop 原生管理器</small></span></button>
      <button :disabled="!available || !availableActions.loadLibrary" @click="requestAction('loadLibrary')"><Database :size="22" /><span><strong>载入设备曲库</strong><small>将 iPod 内容载入 foobar2000</small></span></button>
      <button :disabled="!available || !availableActions.synchronise" @click="requestAction('synchronise')"><Cable :size="22" /><span><strong>同步</strong><small>打开原生同步流程</small></span></button>
      <button :disabled="!available || !availableActions.eject" @click="requestAction('eject')"><Unplug :size="22" /><span><strong>安全弹出</strong><small>完成任务后断开设备</small></span></button>
    </section>

    <div class="ipod-dashboard">
      <section class="ipod-panel ipod-library-panel">
        <div class="ipod-panel__heading"><div><span>设备曲库</span><h2>已载入的播放列表</h2></div><ListMusic :size="20" /></div>
        <div v-if="ipodPlaylists.length" class="ipod-playlists">
          <button v-for="playlist in ipodPlaylists" :key="playlist.index" @click="emit('playlist', playlist.index)">
            <ListMusic :size="17" /><span><strong>{{ playlist.name }}</strong><small>{{ playlist.trackCount }} 首曲目</small></span><b>打开</b>
          </button>
        </div>
        <div v-else class="ipod-empty">
          <HardDrive :size="28" />
          <p>尚未发现 iPod 命名的播放列表。</p>
          <button :disabled="!available || !availableActions.loadLibrary" @click="requestAction('loadLibrary')">载入设备曲库</button>
        </div>
      </section>

      <section class="ipod-panel">
        <div class="ipod-panel__heading"><div><span>内容</span><h2>传输与管理</h2></div><FolderSearch :size="20" /></div>
        <div class="ipod-action-list">
          <button :disabled="!available || !availableActions.manageContents" @click="requestAction('manageContents')"><span><strong>管理设备内容</strong><small>选择同步规则与媒体内容</small></span><Wrench :size="17" /></button>
          <button :disabled="!available || !availableActions.sendPlaylists" @click="requestAction('sendPlaylists')"><span><strong>发送播放列表</strong><small>由 foo_dop 选择并传输播放列表</small></span><ListMusic :size="17" /></button>
          <button :disabled="!available || !availableActions.fileSystemExplorer" @click="requestAction('fileSystemExplorer')"><span><strong>文件系统浏览器</strong><small>查看设备上的原始文件结构</small></span><FolderSearch :size="17" /></button>
        </div>
      </section>

      <section class="ipod-panel">
        <div class="ipod-panel__heading"><div><span>诊断</span><h2>属性与日志</h2></div><Activity :size="20" /></div>
        <div class="ipod-action-list">
          <button :disabled="!available || !availableActions.properties" @click="requestAction('properties')"><span><strong>设备属性</strong><small>查看可读设备信息</small></span><Smartphone :size="17" /></button>
          <button :disabled="!available || !availableActions.rawProperties" @click="requestAction('rawProperties')"><span><strong>原始属性</strong><small>查看底层设备字段</small></span><Database :size="17" /></button>
          <button :disabled="!available || !availableActions.systemLog" @click="requestAction('systemLog')"><span><strong>系统日志</strong><small>检查传输与数据库问题</small></span><Activity :size="17" /></button>
          <button :disabled="!connected" @click="emit('preferences')"><span><strong>foobar2000 首选项</strong><small>配置 foo_dop 的转码与设备选项</small></span><Settings :size="17" /></button>
        </div>
      </section>

      <section class="ipod-panel ipod-danger-panel">
        <div class="ipod-panel__heading"><div><span>维护中心</span><h2>数据库修复</h2></div><ShieldAlert :size="20" /></div>
        <p class="ipod-panel__description">这些命令会修改设备数据库，请在传输任务结束后使用。</p>
        <div class="ipod-action-list">
          <button :class="{ confirming: pendingDanger === 'recoverOrphans' }" :disabled="!available || !availableActions.recoverOrphans" @click="requestAction('recoverOrphans', true)"><span><strong>{{ pendingDanger === 'recoverOrphans' ? '再次点击确认恢复' : '恢复孤立曲目' }}</strong><small>找回数据库未引用的媒体文件</small></span><Wrench :size="17" /></button>
          <button :class="{ confirming: pendingDanger === 'rewriteDatabase' }" :disabled="!available || !availableActions.rewriteDatabase" @click="requestAction('rewriteDatabase', true)"><span><strong>{{ pendingDanger === 'rewriteDatabase' ? '再次点击确认重写' : '重写设备数据库' }}</strong><small>重新生成 iPod 数据库结构</small></span><Database :size="17" /></button>
        </div>
      </section>
    </div>
  </main>
</template>
