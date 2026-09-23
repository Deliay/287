# 287 粉丝站 · 录播模块技术实现计划

- 版本：v1.0
- 创建日期：2026-09-23
- 对应技术方案：[docs/engineering/proposal/2026-09-23-recordings-module.md](../proposal/2026-09-23-recordings-module.md)
- 对应需求：[docs/product/requirement/2026-09-23-recordings-module.md](../../product/requirement/2026-09-23-recordings-module.md)
- 对应设计：[docs/product/design/2026-09-23-recordings-module.md](../../product/design/2026-09-23-recordings-module.md)
- 状态：待评审

> 前置状态：需求、设计、技术方案均已提交至需求总分支 `feat/recordings-module`（PR #6）；本计划以技术方案评审通过为执行前提。
> 每个任务遵循红-绿-重构循环：先写失败测试 → 最小实现使其通过 → 重构保持全绿。
> 每个任务完成后在本文档 §1 对应标题后标记 ✅。

## 1. 任务拆解

### T0 依赖与 mpegts.js 补丁（前置任务，非功能代码）

- 安装运行时依赖 `mpegts.js`（`^1.8`，锁定精确版本）。
- 用 `gh api repos/Deliay/sumire/contents/patches` 获取参考站 `patches/mpegts.js@1.8.2.patch`，移植为 `patches/mpegts.js@<锁定版本>.patch`（暴露 `seekToByteOffset` / `setBufferLimits`，见技术方案 §3.3）。
- 在 `pnpm-workspace.yaml` 配置 `patchedDependencies`（pnpm 11 已将该配置从 `package.json` 迁至 workspace 文件），执行 `pnpm install` 确认补丁应用成功（`pnpm patch-commit` 流程或直接落补丁文件）。
- 验证：写一个临时测试 import mpegts.js 并断言补丁方法存在于原型上，跑通后删除临时测试。
- 预计：1h。

### T1 类型与 API 封装 `src/features/recordings/types.ts` + `api.ts`

- 产出：`RecordingStatusResponse` / `RoomRecordingsResponse` / `LiveEvent` 等类型（字段与技术方案 §4.1 已实测结构一致）；`fetchRecordingStatus()` / `fetchRoomRecordings(roomId)` / `fetchLiveEvents({roomId, start, end, page, pageSize})` 封装，含轻量类型守卫（不引入 zod）与错误归一化（网络错误 / 非 2xx / 结构不符 → 统一 `ApiError`）；基址读 `NEXT_PUBLIC_RECORDINGS_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL`，缺失回退生产默认值。
- **测试用例（红）**：
  1. `fetch` mock 返回实测样例 JSON 时，三个函数解析出对应类型对象（字段逐项断言）。
  2. 结构不符（缺 `items` / `files` / `items`）时抛出 `ApiError` 而非静默通过。
  3. 非 2xx 响应与 `fetch` reject 均归一化为 `ApiError`。
  4. 弹幕请求 URL 正确拼接 `roomId/start/end/page/pageSize` query。
- 对应验收：AC-2 / AC-4 / AC-7 的数据来源基础。
- 预计：1.5h。

### T2 成员数据扩展 `src/data/members.ts`

- 产出：`Member` 增加 `roomId?: number`（接口未返回该成员时录播分组兜底用）；补充 `mid` 关联说明注释。房间号以 `recording-status` 返回为准，本字段仅兜底（技术方案 §4.3）。
- **测试用例（红）**：
  1. 四位成员均可携带 `roomId`（类型层面 + 若填入则为正整数）。
  2. 既有 members 测试（顺序、bilibili、colorKey）保持全绿，不回归。
- 对应验收：AC-2 / AC-4 的数据关联基础。
- 预计：0.5h。

### T3 多路音频注册表 `src/features/recordings/live-audio/audio-player-registry.ts`

- 产出：模块级 `Map<roomId, AudioLane>` 注册表，契约按技术方案 §4.2：`play / stop / stopAll / setVolume / retry / subscribeLanes / getLanesSnapshot`；每 lane 持有隐藏 `<video>` 元素 + 独立 `mpegts.createPlayer({ isLive: true })` 实例（mpegts 以工厂注入便于 mock）；上限 4 路，同 roomId 重复 `play` 幂等；单路错误仅标记该 lane 为 `error`。
- **测试用例（红）**：
  1. 依次 `play` 四个 roomId，快照含 4 路且互不影响（核心改进点，对照 AC-3）。
  2. `play` 同 roomId 两次幂等（不重复创建 player）。
  3. 第 5 路 `play` 被拒绝。
  4. `stop` 单路后其余路仍在；`stopAll` 清空。
  5. 某路 player 触发 error → 仅该 lane 为 `error`，`retry` 后回到 `loading`。
  6. `subscribeLanes` 回调在状态变更时触发，`getLanesSnapshot` 返回只读快照。
- 对应验收：AC-3、AC-8（注册表存活部分）。
- 预计：2.5h。

### T4 悬浮播放组件 `src/features/recordings/live-audio/floating-audio-player.tsx` + `src/app/layout.tsx`

- 产出：`FloatingAudioPlayer`（Client Component），`useSyncExternalStore` 订阅注册表；隐藏媒体元素宿主（所有 lane 的 `<video>` 挂载于此，root layout 内不随路由卸载——跨页面不断流的关键，技术方案 §3.1）；展开态（每路成员色块+名/状态/音量/停止 + 全部停止）与迷你条互切；0 路时不渲染；移动端底部全宽 + 安全区适配（CSS Module + postcss-preset-mantine 断点）。`layout.tsx` 在 `MantineProvider` 内挂载。
- **测试用例（红）**：
  1. 注册表 0 路时组件不渲染；`play` 一路后出现（设计文档 §2.6）。
  2. 展开态渲染每路成员名、状态与停止按钮；点击单路停止调用 `stop`，点击「全部停止」调用 `stopAll`。
  3. 收起/展开切换不改变注册表状态（播放不受影响）。
  4. layout 渲染测试：组件在 root layout 挂载；模拟路由子树卸载后注册表快照不变（不断流断言）。
- 对应验收：AC-8。
- 预计：2h。

### T5 导航入口 `src/components/site-header.tsx`

- 产出：`navItems` 增加 `{ label: "录播", href: "/recordings" }`（首页 → 录播顺序）；现有「首页」锚点逻辑（lenis 回顶）仅对 `#top` 生效，`/recordings` 走普通站内跳转；当前页加亮（设计文档 §2.1，`usePathname` 判断）。
- **测试用例（红）**：
  1. PC 导航渲染「首页」「录播」两个链接，「录播」`href="/recordings"`。
  2. 移动端 Drawer 内同样两项；点击「录播」Drawer 关闭且不触发 lenis 回顶。
  3. `usePathname()` mock 为 `/recordings` 时「录播」项带加亮 class。
- 对应验收：AC-1。
- 预计：1h。

### T6 直播状态卡片 `src/features/recordings/live-status-grid.tsx`

- 产出：`useRecordingStatus()`（首拉 + 30s 轮询，`visibilitychange` 暂停/恢复即刷）+ `LiveStatusGrid`：四张成员卡片按绿黑白紫渲染，成员色指示条/徽标/直播标题/更新时间按设计文档 §2.3；接口未返回的成员兜底「未开播」；「听直播」按钮接入 T3 注册表（`state === "recording"` 可用，收听中转「停止收听」，失败态显示重试）；卡片点击滚动定位对应录播分组。
- **测试用例（红）**：
  1. mock recording-status：四卡片按成员顺序渲染，recording/not_live 分别展示「直播中」/「未开播」徽标与标题。
  2. 假定时器：30s 触发一次轮询；`document.hidden = true` 时暂停，恢复可见立即刷新。
  3. 接口缺失某成员 → 该卡片「未开播」兜底。
  4. 未开播卡片按钮禁用；直播中点击调用 `play(roomId)`；收听中点击调用 `stop`。
  5. 接口失败显示错误文案 + 重试，不白屏。
- 对应验收：AC-2、AC-3（UI 部分）。
- 预计：2.5h。

### T7 历史录播列表 `src/features/recordings/recordings-section.tsx`

- 产出：按成员分组的 `RecordingsSection`：折叠态不请求；分组头进入视口（`IntersectionObserver`）或首次展开时触发 `fetchRoomRecordings`；骨架加载态 / 空态 / 错误重试态按设计文档 §2.4；按 `info.startedAt` 倒序；`PAGE_SIZE = 20` 分页；条目展示标题（缺失回退文件名）、录制时间、时长（`endedAt - startedAt`）、文件大小；点击条目 `next/link` 跳 `/recordings/replay?roomId=…&file=…`。
- **测试用例（红）**：
  1. 初始渲染不发出任何 recordings 请求（AC-4 核心）。
  2. IntersectionObserver mock 触发某分组进入视口 → 仅请求该房间；失败显示重试且不影响其他分组。
  3. 列表按 `startedAt` 倒序；`info` 缺失时回退文件名。
  4. 21 条数据 → 第 1 页 20 条 + 分页控件，翻页渲染第 21 条。
  5. 条目链接 href 含正确 `roomId` 与 `file`（URL 编码）。
- 对应验收：AC-4。
- 预计：2.5h。

### T8 录播页组装 `src/app/recordings/page.tsx`

- 产出：组装「当前直播」（T6）+「历史录播」（T7）两区块标题与布局；页面 metadata。
- **测试用例（红）**：
  1. 页面渲染「当前直播」「历史录播」两区块，且首拉仅请求 recording-status 一个接口（需求 §5 性能）。
- 全量验证：`pnpm test && pnpm lint && pnpm build`，确认 `out/recordings.html`（或对应静态产物）存在。
- 对应验收：AC-2 / AC-4 组装回归、AC-9（部分）。
- 预计：1h。

### T9 时间锚点与分段推导 `src/features/recordings/replay/replay-windows.ts`

- 产出：`segmentBoundsForFile(files, target)`（同 `recordingId` 兄弟文件按 `createdAt` 升序推导各分段起止，锚点用首段 `info.startedAt`，技术方案 §3.3）与 `windowIndexFor(offsetMs)`（`WINDOW_MS = 600_000`）。
- **测试用例（红）**：
  1. 单文件场次：bounds 起点 = `startedAt`。
  2. 多分段（同 `recordingId`、两个文件）：第二段起止由兄弟文件 `createdAt` 推导（**不用** 目标文件自身 `createdAt` 作锚点——风险表 #7 检查点）。
  3. `windowIndexFor` 边界值（0 / 599999 / 600000）。
- 对应验收：AC-7（对齐基准）。
- 预计：1.5h。

### T10 弹幕窗口加载 `src/features/recordings/replay/replay-events.ts`

- 产出：`useReplayEvents(roomId, bounds)`：10 分钟窗口增量拉取 `fetchLiveEvents`（遵守区间 ≤12h、pageSize ≤100，页内翻页拉全），`Map` 缓存窗口、`AbortController` 竞态控制、窗口过半预取下一窗；`eventsFor(offsetMs)` 返回当前及相邻窗口去重升序事件。
- **测试用例（红）**：
  1. 聚焦窗口 0 → 请求 [start, start+10min) 区间；同一窗口重复聚焦不重复请求（缓存）。
  2. 单窗口 total > 100 时自动翻页拉全。
  3. 播放 offset 过窗口中点 → 预取下一窗口。
  4. 快速 seek 连发 → 旧请求 abort，仅最新窗口生效。
  5. `eventsFor` 去重并按 `occurredAt` 升序。
- 对应验收：AC-7（数据加载部分）。
- 预计：2h。

### T11 回放播放器与 seek `flv-player.ts` + `seek.ts`

- 产出：`flv-player.ts` 封装 mpegts.js 回放 player（页面内生命周期，卸载销毁；`mpegts.isSupported()` 探测）；`seek.ts` 实现技术方案 §3.3 五步：缓冲内直接 `currentTime`；未缓冲按 `size/duration` 折算字节偏移 → `Range: bytes=<offset>-` 流式扫描 FLV tag 边界（校验 `PrevTagSize`、对齐视频关键帧 tag type=9 frameType=1）→ `seekToByteOffset`（T0 补丁方法）续播；非 206 放弃报错；15s 看门狗超时显性报错。缓冲预算 50MB（前瞻 60%/回退 40%）。
- **测试用例（红）**：
  1. 目标时间在已缓冲区间 → 直接设 `currentTime`，不发 Range 请求。
  2. 未缓冲 → 按码率折算偏移发出正确 `Range` 头。
  3. 构造 FLV 字节流用例：扫描跳过非关键帧 tag、落点在视频关键帧 tag 边界，`PrevTagSize` 校验失败的字节被跳过。
  4. 响应非 206 → 放弃并以错误回调上报。
  5. 假定时器：seek 后 15s 未恢复播放 → 触发超时错误。
  6. MSE 不支持（`isSupported()` false）→ 播放器不初始化并暴露降级状态。
- 对应验收：AC-5、AC-6。
- 预计：3.5h（本期最难任务，实现整体移植参考站 `seek.ts` 思路，不自研）。

### T12 弹幕浮层 `src/features/recordings/replay/danmaku-overlay.tsx`

- 产出：canvas 2D + rAF 浮层：匀速右→左横穿（约 8s）、轨道分配防重叠、字号随画布宽度缩放、表情弹幕（`emote.url`）预载 `Image` 绘制；正常播放发射 `(prev, current]` 区间事件，seek 跳变（回退或前跳 >2s）清空并补发最近 4s；弹幕开关。
- **测试用例（红）**：
  1. 播放推进时仅发射 `(prev, current]` 区间事件（canvas 2D context 用 stub 断言 fillText 调用）。
  2. seek 回退/前跳 >2s → 清空轨道并补发最近 4s 事件。
  3. 轨道分配：同轨道弹幕不重叠（纯函数单测）。
  4. 弹幕开关关闭时不发射。
- 对应验收：AC-7（浮层部分）。
- 预计：2.5h。

### T13 回放页舞台与路由 `replay-stage.tsx` + `src/app/recordings/replay/page.tsx`

- 产出：`page.tsx` 以 `Suspense` 包裹 `useSearchParams` 解析 `roomId`/`file`（静态导出要求）；`ReplayStage` 组装：页头（返回录播列表 + 标题 + 成员名 + 录制时间）、视频区（T11 player + T12 浮层）、控件栏（播放/暂停、进度条含缓冲显示、音量、倍速 0.5–2、全屏、弹幕开关；静止 3s 自动隐藏）、事件列表（时间升序、跟随播放高亮、手动滚动暂停跟随 +「回到底部跟随」按钮、点击条目 `onSeek`）；PC 4/5 + 1/5、移动端上下布局（设计文档 §2.5）；MSE 不支持显示降级文案；seek 中 spinner + 进度锁定、失败错误 + 重试。
- **测试用例（红）**：
  1. 缺少 `roomId`/`file` 参数 → 错误提示而非白屏。
  2. 页头渲染录播标题（`info.title` 回源 recordings 列表）与返回链接 `/recordings`。
  3. 控件栏含播放/暂停、进度条、音量、倍速、全屏、弹幕开关控件（role/label 断言）。
  4. 事件列表渲染事件并随播放 offset 高亮当前条目；点击条目调用 seek（offset 由 T9 锚点换算）。
  5. 手动滚动后停止自动跟随并出现「回到底部跟随」；点击恢复跟随。
  6. MSE 降级状态渲染设计文档 §2.5 降级文案。
  7. 页面卸载 → flv-player 销毁（不进悬浮组件，需求 FR-6 边界）。
- 对应验收：AC-5、AC-6、AC-7（组装）、AC-9（路由导出）。
- 预计：3h。

### T14 全量验收

- `pnpm test && pnpm lint && pnpm build` 全绿；确认静态导出产物包含 `recordings` 与 `recordings/replay` 路由。
- 按 §3 人工验收清单逐项对照（真实流播放、多路混音、seek 命中率、弹幕视觉、移动端、iOS 降级）。
- 回填本文档任务完成标记与人工验收记录。
- 对应验收：AC-9 及全部 AC 整体回归。
- 预计：1.5h。

## 2. 执行顺序与依赖

```
T0（依赖+补丁）→ T1（API）→ T2（成员数据）
  → T3（音频注册表）→ T4（悬浮组件+layout）
  → T5（导航）→ T6（状态卡片）→ T7（录播列表）→ T8（录播页组装）
  → T9（时间锚点）→ T10（弹幕加载）→ T11（播放器+seek）→ T12（弹幕浮层）→ T13（回放页组装）
  → T14（全量验收）
```

- T0 是一切 FLV 播放（T3/T11）的前提；T1/T2 是所有功能任务的数据前提。
- T3 → T4 → T6 是「听直播」链路（注册表 → 悬浮宿主 → 入口按钮）；T6/T7 → T8。
- T9 → T10/T12/T13（弹幕对齐依赖锚点）；T11 → T13；T10/T12 → T13。
- T5 独立，可在 T3 之后任意时间并行。
- T14 依赖全部前置任务。

## 3. 验收对照

| 验收标准 | 覆盖任务 | 验证方式 |
|----------|----------|----------|
| AC-1 导航入口 | T5 | 单测；人工验证 PC 右对齐与移动端抽屉 |
| AC-2 状态列表/轮询 | T1、T2、T6 | 单测（假定时器 + mock 接口）；人工验证 30s 静默刷新无闪烁 |
| AC-3 多路听直播 | T3、T6 | 注册表单测（4 路并存/独立启停/失败重试）；人工验证四路混音 |
| AC-4 录播后加载 | T7 | 单测（IntersectionObserver mock、倒序、分页）；人工验证骨架/空/错态 |
| AC-5 播放与控件 | T11、T13 | 单测（控件渲染、MSE 降级）；人工验证真实 FLV 播放 |
| AC-6 未缓冲 seek | T11 | 单测（码率折算/Range/关键帧对齐/非 206/看门狗）；人工验证实际命中率 |
| AC-7 弹幕对齐 | T9、T10、T12、T13 | 单测（锚点/分段/窗口/发射区间/seek 重建）；人工验证弹幕视觉与列表跟随 |
| AC-8 悬浮组件跨页 | T3、T4 | 单测（注册表存活/组件显隐/单路与全部停止）；人工验证切页不断流 |
| AC-9 工程验证 | T8、T13、T14 | `pnpm test && pnpm lint && pnpm build`；检查 `out/` 含新路由 |

**人工验收环境**：PC Chrome（≥1440px 与 1024px 宽度）、移动端模拟器（iPhone 15 / Android 360px 宽度）、真实开播房间（多路听直播与混音）、历史录播（seek 与弹幕），对照需求文档 §4 与设计文档 §2、§3 逐项检查。

## 4. 评审记录

| 评审人 | 日期 | 结论 | 备注 |
|--------|------|------|------|
| （待评审） | | | |
