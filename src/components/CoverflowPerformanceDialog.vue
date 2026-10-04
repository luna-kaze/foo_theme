<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Clipboard, X } from '@lucide/vue'
import fb from 'foo-webview-sdk'
import type { CoverflowPerformanceReport } from '../utils/coverflowPerformance'

const props = defineProps<{ report: CoverflowPerformanceReport }>()
const emit = defineEmits<{ close: [] }>()
const copied = ref(false)
const tiers = computed(() => Object.entries(props.report.tiers).filter(([, value]) => value.samples || Object.keys(value.events).length || value.maxDom))
const formatMs = (value: number | null) => value == null ? '--' : `${value.toFixed(1)} ms`
const formatBytes = (value: number | null) => value == null ? '--' : `${value >= 0 ? '+' : ''}${(value / 1024).toFixed(1)} KiB`
const status = (tier: string, event: string) => tier === 'high' && ['coverWindowBuild', 'coverModelBuild', 'imagePreload'].includes(event) ? '应为 0' : ''
async function copy() {
  const response = await fb.clipboard.write(JSON.stringify(props.report, null, 2))
  if (response.success === false) return
  copied.value = true
  setTimeout(() => { copied.value = false }, 1400)
}
</script>

<template>
  <div class="modal-backdrop performance-backdrop" @pointerdown.self="emit('close')">
    <section class="performance-dialog" role="dialog" aria-modal="true" aria-labelledby="coverflow-performance-title">
      <header>
        <div><small>Coverflow 性能采样</small><h2 id="coverflow-performance-title">采样结果</h2></div>
        <button aria-label="关闭性能报告" @click="emit('close')"><X :size="18" /></button>
      </header>
      <p class="performance-dialog__note">{{ report.frameMetric }}。稳定高速阶段应不再出现封面窗口、封面模型和图片预加载事件。</p>
      <div class="performance-dialog__summary"><span>时长 <b>{{ formatMs(report.durationMs) }}</b></span><span>JS 堆变化 <b>{{ formatBytes(report.heapDeltaBytes) }}</b></span></div>
      <div class="performance-dialog__tiers">
        <article v-for="[name, tier] in tiers" :key="name" :class="{ high: name === 'high' }">
          <header><h3>{{ ({ near: '普通封面', shrinking: '缩远过渡', high: '高速点轨道', restoring: '封面恢复', inactive: '非 Coverflow' } as Record<string, string>)[name] || name }}</h3><small>{{ tier.samples }} 帧样本</small></header>
          <div class="performance-dialog__metrics"><span>平均 <b>{{ formatMs(tier.averageFrameMs) }}</b></span><span>P95 <b>{{ formatMs(tier.p95FrameMs) }}</b></span><span>超过 32ms <b>{{ tier.framesOver32Ms }}</b></span></div>
          <div v-if="tier.maxDom" class="performance-dialog__dom">节点峰值：封面 {{ tier.maxDom.covers }}，图片 {{ tier.maxDom.images }}，点 {{ tier.maxDom.dots }}</div>
          <ul v-if="Object.keys(tier.events).length">
            <li v-for="(event, eventName) in tier.events" :key="eventName"><code>{{ eventName }}</code><span>{{ event.count }} 次 · {{ event.items }} 项 · {{ formatMs(event.totalMs) }}</span><em>{{ status(name, eventName) }}</em></li>
          </ul>
        </article>
      </div>
      <footer><button class="secondary-button" @click="copy"><Check v-if="copied" :size="16" /><Clipboard v-else :size="16" />{{ copied ? '已复制' : '复制 JSON' }}</button><button class="primary-button" @click="emit('close')">关闭</button></footer>
    </section>
  </div>
</template>
