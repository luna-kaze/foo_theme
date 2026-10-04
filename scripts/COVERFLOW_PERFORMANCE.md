# Coverflow 性能采样

采样默认关闭，不创建额外帧循环、DOM 采样计时器或 PerformanceObserver。

## 在实际 foobar2000 WebView 中测量

1. 打开 Coverflow，保持歌单和窗口尺寸不变。
2. 按 **Ctrl+Alt+P** 开始采样。
3. 普通速度滚动约 5 秒，再高速滚动约 5 秒，停下并等待封面恢复。
4. 再按 **Ctrl+Alt+P** 结束。结果输出到 foobar2000 控制台和 WebView 开发者控制台。

也可在 WebView 开发者控制台执行：

```js
window.fooThemeCoverflowPerformance.start()
window.fooThemeCoverflowPerformance.stop()
```

## 结果含义

- `near`：正常封面模式。
- `shrinking`：由封面缩远至点轨道的过渡。
- `high`：稳定高速点轨道。
- `restoring`：停止后放近并恢复封面。
- `inactive`：Coverflow 已关闭或处于 Standard，避免把这段时间误归类为高速。
- `averageFrameMs` / `p95FrameMs`：requestAnimationFrame 调度间隔，不是 GPU 实际呈现帧率。
- `coverWindowBuild`：窗口重建次数、同步计算耗时、处理的行数。稳定 `high` 阶段应为零。
- `coverModelBuild`：封面描述模型的构建次数。稳定 `high` 阶段应为零。
- `lightweightTarget`：高速目标和标题的更新次数。
- `imagePreload`：由封面预加载器启动的图片数量。稳定 `high` 阶段应为零。
- `maxDom`：每 250 毫秒采样到的封面、图片和点节点最大数量。稳定 `high` 应为零张图片、最多 31 个点。
- `longTask`：浏览器支持时记录的长任务。
- `imageResource`：浏览器支持时记录的图片资源耗时，按请求开始时的状态归类；不保存图片 URL。
- `heapDeltaBytes`：浏览器提供 `performance.memory` 时的 JS 堆变化，不包括 GPU 纹理内存。

关闭采样后会释放帧循环、DOM 计时器和观察器。采样自身有开销，建议仅在对比测试时开启。

## 本地回归与数据路径重放

```sh
node scripts/test-coverflow-performance.mjs
node scripts/test-player-transitions.mjs
node scripts/test-playback-workspace.mjs
```

最后一项包含 5 万首工作集的 1000 次高速目标更新，以及相同次数的普通窗口更新 CPU 重放。它用于验证跳过窗口重建的收益，不代表实际 WebView 帧率或 GPU 性能。
