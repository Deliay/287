# 287 粉丝站 · 录播模块技术方案

- 版本：v1.0
- 创建日期：2026-09-23
- 变更：2026-09-24（审核 R9-c：§3.3 多分段推导勘误、§4.2 契约按实现刷新；实现不变）
- 状态：待评审

## 1. 对应上游文档

- 需求：[docs/product/requirement/2026-09-23-recordings-module.md](../../product/requirement/2026-09-23-recordings-module.md)
- 设计：[docs/product/design/2026-09-23-recordings-module.md](../../product/design/2026-09-23-recordings-module.md)
- 参考实现：[Deliay/sumire](https://github.com/Deliay/sumire)（已调研，关键结论见 §5 与 §7）

## 2. 技术选型

| 技术 | 版本 | 用途 | 选型理由 |
|------|------|------|----------|
| Next.js（App Router）+ React + TypeScript + Mantine | 16 / 19 / 5 / 9 | 沿用现有栈 | 项目既有栈，导航/卡片/骨架/进度条等组件现成 |
| mpegts.js | ^1.8 | FLV 直播音频流与录播回放（MSE） | 录播服务只提供 FLV；mpegts.js 是 flv.js 的维护分支，参考站 sumire 生产环境同款并自维护补丁。备选：flv.js（停止维护，排除）、hls.js（上游无 HLS，排除）、原生 `<video>`（不支持 FLV，排除） |
| pnpm `patchedDependencies` | pnpm 11 内建 | 给 mpegts.js 打「字节偏移 seek」补丁 | 未缓冲区域 seek 需要按字节偏移重建 FLV 流（见 §3.3）；pnpm 原生支持补丁，无需引入 patch-package |
| Vitest + RTL（现有） | — | 单测（TDD） | 沿用现有测试基建 |

**新依赖必要性说明**：运行时仅新增 `mpegts.js` 一个依赖；弹幕浮层用 canvas 2D 自绘（逻辑与参考站一致，无成熟轻量库可替代且自绘可控），不引入弹幕库；事件列表用窗口化数据 + 普通列表渲染，暂不引入虚拟化库（见 §5-4）。

**静态导出约束**：站点 `output: "export"` 部署到 Cloudflare Workers 静态资产（`next.config.ts`、`wrangler.toml`），**无服务端**。**线上形态**：浏览器**直连**录播服务 `https://recordings.vtuber.fffdan.com` 与弹幕服务 `https://api.sumire.live`，不经过任何本站代理（R10-b）。

> **跨域勘误（2026-09-24 实测 / 审核 R10-d）**：原表述「CDN 已配置跨域、响应头含 `access-control-allow-methods`、已实测带 CORS 头」**仅对参考站源成立**——两服务均为 **origin 白名单** CORS，当前仅放行 `https://sumire.live`。实测命令：
> `curl -s -D- -o /dev/null -H "Origin: <源>" https://recordings.vtuber.fffdan.com/api/b/live/recording-status | grep -i access-control`（弹幕服务同理）：
> - `Origin: https://sumire.live` → `access-control-allow-origin: https://sumire.live`（弹幕服务另带 `access-control-allow-credentials: true`）；
> - `Origin: http://localhost:3000` → **无** `access-control-allow-origin`（仅有 `allow-methods`）；`OPTIONS` 预检 → `405`。
>
> 结论：**本地验收跨域必现** → 由本地反代通路解决（`pnpm dev` 自动拉起 `scripts/dev-with-proxy.mjs` + `scripts/lib/local-proxy.mjs`，透传 Range/流式，见计划 T15；前端仍为同一套 `NEXT_PUBLIC_*` 基址注入，线上形态代码不变）。**线上直连成立的前提**是两服务把本站生产域名加入白名单（上线前置条件，见 §5-1 风险 #1 与 R10-c）。静态导出不支持 Next `rewrites`/`proxy`（`node_modules/next/dist/docs/.../static-exports.md` Unsupported Features），故不得以 Next 层做代理。

## 3. 架构设计

### 3.1 模块划分

```
src/
├── app/
│   ├── layout.tsx                        # 改动：挂载 <FloatingAudioPlayer />（悬浮组件，root 级持久化）
│   └── recordings/
│       ├── page.tsx                      # 录播页：LiveStatusGrid + RecordingsSection
│       └── replay/
│           └── page.tsx                  # 回放页：解析 query（Suspense 包裹 useSearchParams）→ ReplayStage
├── data/
│   └── members.ts                        # 改动：Member 增加 roomId?: number（接口未返回时的兜底映射）
├── features/recordings/                  # 录播模块全部逻辑，与既有 components/ 平级
│   ├── api.ts                            # 录播服务与弹幕服务 fetch 封装 + zod 之外的轻量类型守卫
│   ├── types.ts                          # RecordingStatus / RecordingFile / LiveEvent 等类型
│   ├── live-status-grid.tsx              # FR-2 直播状态卡片（2×2 / 单列）
│   ├── recordings-section.tsx            # FR-4 历史录播列表（分组成员、懒加载、分页）
│   ├── replay/
│   │   ├── replay-stage.tsx              # 回放页舞台：播放器 + 弹幕浮层 + 事件列表
│   │   ├── flv-player.ts                 # mpegts.js 回放播放器封装（单例，页面内生命周期）
│   │   ├── seek.ts                       # 未缓冲区域 seek（Range 请求 + 关键帧对齐，见 §3.3）
│   │   ├── replay-events.ts              # 弹幕 10 分钟窗口增量加载
│   │   ├── replay-windows.ts             # 时间锚点与多分段边界推导
│   │   └── danmaku-overlay.tsx           # canvas 弹幕浮层
│   └── live-audio/
│       ├── audio-player-registry.ts      # FR-3 多路音频注册表（模块级，替代 sumire 单例）
│       └── floating-audio-player.tsx     # FR-6 悬浮播放组件（含隐藏媒体元素宿主）
tests/
│   └── recordings-*.test.ts(x)           # 各模块单测
patches/
│   └── mpegts.js@1.8.x.patch             # seekToByteOffset 补丁（pnpm patchedDependencies）
```

悬浮组件挂在 root layout 是「跨页面持续播放」的关键：App Router 下 layout 在同级路由切换间不重挂载，媒体元素与播放器实例得以存活；这正是参考站所缺的能力（其播放器挂在页面组件内，卸载即断流）。

### 3.2 数据流与状态管理

- **直播状态**：`useRecordingStatus()` —— 首拉 + 30s 轮询，`document.hidden` 暂停、恢复可见立即刷新（`visibilitychange`）。返回按 `mid` 与 `members` 关联后的四张卡片视图模型；接口缺失的成员兜底「未开播」。
- **历史录播**：每个成员分组持有独立加载状态（`idle/loading/ok/error`）；`IntersectionObserver` 触发首拉，失败可重试；前端按 `info.startedAt` 倒序，`PAGE_SIZE = 20` 分页。
- **多路音频注册表**（`audio-player-registry.ts`）：模块级 `Map<roomId, AudioLane>`，每 lane 持有一个隐藏 `<video>`（mpegts 需媒体元素）+ 独立 `mpegts.createPlayer({isLive: true})` 实例；`useSyncExternalStore` 对外发布只读快照（路数、各路状态、音量），状态卡片按钮与悬浮组件都订阅它。上限 4 路（= 成员数），同一 roomId 重复开播幂等。
- **回放播放器**：`flv-player.ts` 为回放页内单例（离开回放页即销毁，不进悬浮组件，需求 §FR-6），与音频注册表互不影响。
- **弹幕**：`replay-events.ts` 以 10 分钟窗口（`WINDOW_MS = 600_000`）增量拉取（弹幕接口区间上限 12h、单页上限 100，已实测），`Map` 缓存 + `AbortController` 竞态控制；窗口过半预取下一窗。

### 3.3 关键实现思路

**时间轴对齐（弹幕 ↔ 视频）**：锚点取文件 `info.startedAt`（毫秒），`offsetMs = occurredAt - startedAt`。**不用 `createdAt` 作锚点**——分段录播的 `createdAt` 是该分段**落盘（≈分段结束）**时刻（参考站实测结论）。多分段场次（同 `recordingId` 的兄弟文件）按 `createdAt` 升序推导各分段起止（**勘误 2026-09-24 / 审核 R9-c，以实现模型为准**）：**非末段终点 = 本段 `createdAt`**、末段终点 = `info.endedAt`（缺失回退本段 `createdAt`）；**其余段起点 = 该段前一段的 `createdAt`**、首段起点 = 首段 `info.startedAt`（回放页通过 recordings 列表回源该文件的兄弟分段）。〔原句「分段的结束偏移 = 下一段 `createdAt` 与首段 `startedAt` 之差」措辞有误：按 room 1727074031 实测两段样本（2.89GB / 2.29GB）字面推导，第二段仅剩约 1 秒却需承载 2.29GB，与数据矛盾；实现模型推导两段各约 63 / 92 分钟、码率合理。〕

**未缓冲区域 seek（`seek.ts`，本项目最难部分）**：

1. 目标时间落在已缓冲区间 → 直接 `video.currentTime`；
2. 未缓冲 → 按 `size / duration` 估算码率，线性折算字节偏移；
3. 发 `Range: bytes=<offset>-` 请求，流式扫描 FLV tag 边界（校验 `PrevTagSize`），**优先对齐视频关键帧 tag**（type=9, frameType=1），避免 mpegts lazyLoad 死锁；
4. 调用补丁方法 `seekToByteOffset(fileposition, milliseconds)` 从该字节续播；非 206 响应一律放弃并报错；
5. 看门狗：seek 后 15s 未恢复播放 → 显性错误提示。

缓冲预算沿用参考站经验值：50MB（前瞻 60% + 回退 40%），按码率折算秒数。mpegts.js 补丁（`patches/mpegts.js@1.8.x.patch`）暴露 `seekToByteOffset` / `setBufferLimits`，内容移植自参考站 `patches/mpegts.js@1.8.2.patch`，以 pnpm `patchedDependencies` 应用。

**弹幕渲染**：
- 浮层（`danmaku-overlay.tsx`）：canvas 2D + rAF，匀速右→左横穿（约 8s），轨道分配避免重叠，字号随画布宽度缩放，表情弹幕（`emote.url`）预载为 `Image` 绘制；正常播放发射 `(prev, current]` 区间事件，seek 跳变（回退或前跳 >2s）时清空并补发最近 4s。
- 事件列表：按 `occurredAt` 升序渲染当前已加载窗口内事件，随播放进度滚动跟随/高亮，用户手动滚动后暂停跟随，点击 `onSeek(offsetSeconds)`。

**多路音频互斥的解除**：参考站「同时只能听 1 路」源于模块级单例 player（新播放先 `destroyPlayer()`）。本期改为按 roomId 的多实例注册表，每路独立 player 与媒体元素；回放页 player 独立一路、页面卸载销毁。悬浮组件持有全部音频 lane 的媒体元素（root layout 内），因此路由切换不断流。

**响应式**：沿用 CSS Module + `postcss-preset-mantine` 断点变量，PC/移动同一 DOM 两种排版，无 JS 媒体查询切换结构（与一期一致，避免 hydration 闪烁）。

## 4. 接口设计

### 4.1 外部接口（前端直连，均已实测）

```ts
// GET {REC_BASE}/api/b/live/recording-status
interface RecordingStatusResponse {
  items: Array<{
    mid: number; roomId: number;
    state: "recording" | "not_live";
    sessionTitle: string | null;
    files: string[]; updatedAt: string;
    streamer: { name: string };
  }>;
}

// GET {REC_BASE}/api/b/live/{roomId}/recordings
interface RoomRecordingsResponse {
  files: Array<{
    name: string; size: number; createdAt: string;
    info?: {
      recordingId: string; title: string; mid: number;
      startedAt: string; endedAt: string;
    };
  }>;
}

// GET {API_BASE}/api/live-events/replay?roomId&start&end&page&pageSize
// （区间 ≤ 12h，pageSize ≤ 100，items 按 occurredAt 升序）
interface LiveEvent {
  eventId: string;
  type: "danmaku" | "super_chat" | "gift" | "guard_buy";
  occurredAt: string;
  sender: { uid: number; name: string; face: string;
    medal: { name: string; level: number; color: string } | null;
    guardLevel: number | null };
  content?: string;
  emote?: { url: string; name: string; width: number; height: number };
  price?: number; gift?: { name: string; count: number; iconUrl: string };
  guard?: { level: number; name: string; count: number };
}
```

基址：构建期 `NEXT_PUBLIC_RECORDINGS_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL`（静态导出无服务端，必须 `NEXT_PUBLIC_` 前缀），缺失时回退到生产默认值。

### 4.2 内部模块契约

> 2026-09-24 按实现刷新签名与返回面（审核 R9-c）。

```ts
// live-audio/audio-player-registry.ts
type LaneState = "loading" | "playing" | "error" | "unsupported"; // unsupported：MSE 不可用，不可重试降级（2026-09-24，审核 R12-b）
interface AudioLane { roomId: number; state: LaneState; volume: number; label?: string; colorKey?: string; }
play(roomId: number, meta?: { label: string; colorKey: string }): boolean; // 幂等；超过 4 路返回 false
stop(roomId: number): void;
stopAll(): void;
setVolume(roomId: number, volume: number): void;
retry(roomId: number): boolean;        // 失败重试：返回是否命中**可重试** lane（unsupported 恒 false，2026-09-24 R13-c）
subscribeLanes(cb): () => void;        // useSyncExternalStore 用
getLanesSnapshot(): readonly AudioLane[];

// replay/replay-windows.ts
segmentBoundsForFile(files: RecordingFile[], target: string): { startMs: number; endMs: number }; // endMs 未知为 NaN
windowIndexFor(offsetMs: number): number;

// replay/replay-events.ts
useReplayEvents(
  roomId: number | null,
  bounds: { startMs: number | null; endMs?: number | null },
  fetchEvents?: FetchEvents,           // 依赖注入（默认 fetchLiveEvents）
): {
  events: readonly LiveEvent[]; loading: boolean; error: boolean; focusedWindow: number;
  focusWindow(index: number): void;    // 切换关注窗口（last-wins + abort 在途）
  ensureWindow(index: number): Promise<boolean>;
  prefetchNext(offsetMs: number): void;// 窗口过半预取下一窗
  eventsFor(offsetMs: number): readonly LiveEvent[];  // 当前及相邻窗口的去重升序事件
  retry(): void;                       // 清当前关注窗缓存重拉
};
```

### 4.3 成员数据扩展（`src/data/members.ts`）

`Member` 增加 `roomId?: number`。房间归属以 `recording-status` 的 `mid` 关联为准，`roomId` 仅作接口未返回该成员时的兜底（此时录播列表分组展示为空态）。

## 5. 风险与权衡

| # | 风险 | 影响 | 缓解 / 取舍 |
|---|------|------|-------------|
| 1 | 静态站点无服务端，跨域完全依赖两个外部 API 的 CORS 配置（2026-09-24 实测：两服务均为 origin 白名单、仅放行 `https://sumire.live`；本站源与 `localhost` 均无 `allow-origin`，`OPTIONS` 预检 405） | **风险已发生**：本地验收跨域必现；生产域未加白名单时线上直连同样被浏览器拦截 | ① 本地验收：`pnpm dev` 自带本地反代（`scripts/dev-with-proxy.mjs` + `scripts/lib/local-proxy.mjs`，透传 Range/流式响应，见计划 T15），前端代码与线上同为「基址可注入的直连形态」；② **上线前置条件（人工协调）**：请服务侧将本站生产域名加入两服务 CORS 白名单，复验命令 `curl -s -D- -o /dev/null -H "Origin: <生产域>" https://recordings.vtuber.fffdan.com/api/b/live/recording-status \| grep -i access-control`（期望回显 `access-control-allow-origin: <生产域>`；弹幕服务对 `https://api.sumire.live/api/live-events/replay` 同法复验）；③ 若无法获得白名单：线上直连不成立，回到本表原退路（Cloudflare Worker 反代），与「线上直连」诉求冲突 → **提交人工决策，不得在代码里静默绕过或把线上改走代理** |
| 2 | 未缓冲 seek 复杂（tag 边界、关键帧对齐、补丁维护） | seek 失败或卡死 | 完整移植参考站 `seek.ts` + mpegts 补丁的成熟实现，不自研；看门狗 15s 超时显性报错；已缓冲区间 seek 不受影响作为兜底体验 |
| 3 | mpegts.js 补丁与版本升级耦合 | 升级依赖时补丁失效 | pnpm `patchedDependencies` 锁定精确版本；升级时人工核对补丁上下文 |
| 4 | 事件列表在超长录播下条目多（实测 5 分钟 372 条，3 小时可达上万） | 列表渲染卡顿 | 仅渲染当前及相邻窗口（10 分钟粒度）的事件 + 简单窗口化；暂不上虚拟化库，实测卡顿再引入 `@tanstack/react-virtual` |
| 5 | iOS Safari 无 MSE，FLV 无法播放 | 移动端苹果用户无法回放/听直播 | `mpegts.isSupported()` 探测，不可用时展示明确降级提示（本期不提供转码/HLS 退路，需求 §6） |
| 6 | 多路音频同时播放的混音体验 | 音量互相干扰 | 每路独立音量 + 默认从 100% 起，悬浮组件提供快速单路静音/停止；4 路上限即成员数，天然可控 |
| 7 | 弹幕时间锚点误用 `createdAt` | 弹幕整体偏移 | `replay-windows.ts` 强制以 `info.startedAt` 为锚点并配单测（含多分段用例）；代码评审检查点 |

## 6. 测试策略

遵循根目录 `AGENTS.md` 红-绿-重构 TDD。沿用 Vitest + RTL + `renderWithTheme`；`fetch` 用 `vi.stubGlobal` mock，mpegts.js 以工厂注入替身 mock。

| 验收标准 | 测试方式 |
|----------|----------|
| AC-1（导航入口） | SiteHeader 单测：渲染「录播」链接指向 `/recordings` |
| AC-2（状态列表/轮询） | mock recording-status：四卡片按绿黑白紫渲染、recording/not_live 徽标与标题正确；假定时器验证 30s 轮询与 hidden 暂停 |
| AC-3（多路听直播） | registry 单测：4 路并存、单路停止/失败/重试互不影响、幂等、上限拒绝；悬浮组件订阅快照断言 |
| AC-4（录播后加载） | IntersectionObserver mock：进入视口才发请求；排序按 `startedAt` 倒序；20 条分页切换 |
| AC-5/AC-6（播放与 seek） | seek.ts 单测：缓冲内直接 currentTime；未缓冲 → 码率估算、Range 请求、关键帧对齐（构造 FLV tag 字节流用例）、非 206 放弃、看门狗超时；player 控件渲染断言 |
| AC-7（弹幕对齐） | replay-windows 单测：锚点用 `startedAt`、多分段边界推导；replay-events 窗口加载/预取/去重；overlay 发射区间与 seek 重建逻辑（canvas 用 stub） |
| AC-8（悬浮组件） | layout 渲染测试：有 lane 时组件出现、路由切换组件与注册表存活（单测层面断言注册表模块级单例不随组件树卸载销毁）、全部停止后消失 |
| AC-9（工程） | `pnpm test` / `pnpm lint` / `pnpm build` 全绿，`out/recordings`、`out/recordings/replay` 存在于导出产物 |

**人工验收项**：真实流播放手感、多路混音、seek 实际命中率、弹幕视觉、移动端布局、iOS 降级提示（按需求文档逐项对照）。

## 7. 参考实现调研摘要（Deliay/sumire）

- 录播模块为纯前端功能，前端直连录播服务；其房间列表同样来自 `recording-status`，无独立全量录播接口——与本方案一致。
- 播放器：mpegts.js + 自维护补丁（`patches/mpegts.js@1.8.2.patch` 暴露 `seekToByteOffset`），本方案移植。
- 「只能听 1 个」根因：`player.ts` 模块级单例，新播放先销毁旧实例；UI 经 `useSyncExternalStore` 感知归属。本方案的注册表保留订阅模式、去掉单例假设。
- 无悬浮播放实现（刻意用新标签页回避断流）；其订阅/互斥机制可直接演化为本方案的注册表 + root layout 宿主。
- 弹幕：10 分钟窗口增量加载 + canvas 浮层 + 时间锚点 `info.startedAt`——本方案全部沿用。

## 8. 评审记录

| 评审人 | 日期 | 结论 | 备注 |
|--------|------|------|------|
| （待评审） | | | |
