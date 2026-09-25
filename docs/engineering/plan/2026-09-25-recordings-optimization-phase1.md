# 287 粉丝站 · 录播优化一期技术实现计划

- 版本：v1.0
- 创建日期：2026-09-25
- 对应技术方案：[docs/engineering/proposal/2026-09-25-recordings-optimization-phase1.md](../proposal/2026-09-25-recordings-optimization-phase1.md)
- 对应需求：[docs/product/requirement/2026-09-25-recordings-optimization-phase1.md](../../product/requirement/2026-09-25-recordings-optimization-phase1.md)
- 对应设计：[docs/product/design/2026-09-25-recordings-optimization-phase1.md](../../product/design/2026-09-25-recordings-optimization-phase1.md)（UI/UX 阶段产物，2026-09-25 已建立；内容取自需求 §3 与技术方案 §3.2 已评审口径，经逐条核对与技术方案无出入，无需勘误。布局/配色/交互细节以设计稿为准，对应关系：FR-1→设计 §2.1、FR-3→§2.2、FR-4/FR-5→§2.3、FR-6→§2.4、FR-2→§2.5）
- 状态：待评审

> 前置状态：产品需求与技术方案已提交至需求总分支 `feat/recordings-optimization-phase1`（PR #10，人工评审通过）；本计划以技术方案评审通过为执行前提。
> 每个任务遵循红-绿-重构循环：先写失败测试 → 最小实现使其通过 → 重构保持全绿。
> 每个任务完成后在本文档 §2 对应标题后标记 ✅；任务需要调整时，先更新本文档再继续编码。
> 全期**不引入任何新依赖**（技术方案 §2）。

## 1. 对应技术方案与关键前置事实（已核实）

- 对应技术方案：[../proposal/2026-09-25-recordings-optimization-phase1.md](../proposal/2026-09-25-recordings-optimization-phase1.md)（改动地图 §3.1、实现思路 §3.2、接口契约 §4、测试策略 §6）。
- 基线：[录播模块实现计划](./2026-09-23-recordings-module.md)（播放器 / seek / 弹幕窗口化加载已上线，本期**零改动**，仅条目渲染替换）。

代码锚点核实（2026-09-25，对应技术方案 §3.2）：

| 事实 | 位置 | 对本计划的影响 |
|------|------|----------------|
| `handleFullscreen` 无条件 `requestFullscreen()`，无退出分支 | `replay-stage.tsx:615-620` | FR-4 根因确认，T4 最小修复 |
| `.controls` 为 `.videoArea` 兄弟节点，`.videoColumn` flex column | `replay-stage.tsx:708-862` 一带 | FR-1 浮层化为纯结构调整 + CSS（T5） |
| `TimelineEntry` 拍平为 `{sender, content}` 纯文本，`entryLabel` 输出类型前缀文本 | `replay-stage.tsx:92-111` | FR-6 需重构为持有 `LiveEvent`；R8 的 entryLabel 徽标用例随之改写（T8） |
| `recordingFileUrl(roomId, fileName)` 为 FLV 直链 | `api.ts:266-271` | FR-2「下载」直接复用，无新接口 |
| `recordingReplayHref` 为站内回放地址 | `recordings-section.tsx`（条目 Link 已用） | FR-2「播放」与条目本体同址 |
| `formatOffset` 秒数格式化 | `format.ts:45` | FR-3 hover 预览复用 |
| 控件「静止 3s 隐藏 / 移动复现」已有实现与用例 | `replay-stage.tsx`（`controlsIdle`）+ `recordings-replay-stage.test.tsx`「次要7」 | T5 复用显隐逻辑，用例保持绿 |
| 图标口径：内联 SVG、无 emoji/Unicode 字形（R14-5） | `src/components/icons.tsx`（`ICON_SVG` 描边风格） | T2 新增图标沿用同一口径 |

## 2. 任务拆解

### T1 ✅ 数据层类型与解析扩展（FR-6 前置）

- 产出：`src/features/recordings/types.ts`——`LiveEvent` 增加 `scColors?: { backgroundStart; backgroundEnd; fontColor }`、`time?: number`；`LiveEventType` 白名单防御性加入 `"gift_v2"` 字面量。`src/features/recordings/api.ts`——`parseLiveEvent` 解析 `scColors`/`time`（可缺省、非法值置空），`type: "gift_v2"` 归一为 `gift`（结构同构，服务端已归一，见需求 §7）。
- **测试用例（红）**（`tests/recordings-api.test.ts` 补充）：
  1. 含 `scColors` 与 `time` 的 super_chat 实测样例解析出对应字段（逐字段断言）。
  2. `type: "gift_v2"` 事件被接受并归一为 `gift` 类型、`gift` 结构可用（不被白名单丢弃）。
  3. `scColors` 缺失/非法时置空不抛错；既有解析用例（宽容校验、pageSize 钳制、坏 item 跳过）全部不回归。
- 对应验收：AC-6 数据基础、AC-7。
- 预计：1h。

### T2 ✅ 新增 SVG 图标（FR-2 / FR-5 前置）

- 产出：`src/components/icons.tsx` 新增 `IconDownload`、`IconTheater`（网页全屏），沿用 `ICON_SVG` 描边口径，与 `IconPlay`/`IconArrowLeft` 视觉一致；无 emoji/Unicode 字形（R14-5）。
- **测试用例（红）**（新增 `tests/icons.test.tsx`——图标为纯组件、无页面归属，独立成文件比并入 T3/T7 用例更贴合「渲染测试与既有图标断言同法」的口径）：
  1. 两个图标渲染为内联 `<svg>`（`aria-hidden`、`viewBox="0 0 24 24"`），渲染测试与既有图标断言同法。
  2. 所在按钮（T3 下载项、T7 网页全屏按钮）图标为 SVG 的断言在 T3/T7 用例中覆盖。
- 对应验收：AC-2、AC-5（图标部分）。
- 预计：0.5h。

### T3 ✅ 历史录播「播放/下载」按钮组（FR-2）

- 产出：`src/features/recordings/recordings-section.tsx` + `recordings-section.module.css`——`li` 内拆为「标题 `<Link>` 区（点击进回放页，行为不变）+ 右侧按钮组」；主按钮「播放」跳 `recordingReplayHref(linkRoomId, file.name)`，箭头按钮切换下拉菜单（含「下载」项）；「下载」为 `<a href={recordingFileUrl(linkRoomId, file.name)} download={file.name}>`（直链 FLV，前端触发，不经本站中转）；下拉本地 state 开合，点击外部 / Esc 关闭（简单焦点管理，不引库）；`linkRoomId` 漂移口径（审核次要6）沿用。
- **测试用例（红）**（`tests/recordings-section.test.tsx` 补充）：
  1. 条目右侧渲染按钮组：主按钮「播放」`href` 与条目本体一致。
  2. 点击下拉箭头展开菜单出现「下载」，`href` 指向 `recordingFileUrl` 且带 `download` 属性（文件名一致）。
  3. 点击外部 / Esc 收起菜单；条目本体点击仍进回放页（不回归）。
  4. 按钮图标为内联 SVG、无 emoji/Unicode 字形（R14-5 口径）。
  5. 既有用例全绿：点击前零请求、倒序/分页、`href` 含正确 roomId 与编码文件名、展开/收起复用数据。
- 对应验收：AC-2。
- 预计：2h。

### T4 ✅ 全屏退出修复（FR-4）

- 产出：`src/features/recordings/replay/replay-stage.tsx`——`handleFullscreen` 补退出分支（`document.fullscreenElement` 存在时 `exitFullscreen()`，否则 `requestFullscreen()`）；新增 `isFullscreen` state + `fullscreenchange` 监听（挂载注册、卸载移除），同步按钮图标 / `aria-label` / `aria-pressed`，覆盖 Esc 原生退出后状态回正。`replay-stage.module.css`：`:fullscreen` 基础样式骨架（细化并入 T5）。
- **测试用例（红）**（`tests/recordings-replay-stage.test.tsx` 补充，mock Fullscreen API）：
  1. 未全屏点击全屏按钮 → 调 `requestFullscreen`；已全屏（`document.fullscreenElement` 非空）点击 → 调 `exitFullscreen`。
  2. 派发 `fullscreenchange`（含 Esc 路径：`fullscreenElement` 变 `null`）→ 按钮图标 / `aria-pressed` 同步恢复「进入全屏」态。
  3. 既有控件用例（控件栏渲染、R14-5 SVG 断言）不回归。
- 对应验收：AC-4。
- 预计：1h。

### T5 ✅ 控件浮层化（FR-1）

- 产出：`replay-stage.tsx`——`.controls` 移入 `.videoArea`（`position: relative` 容器）内部，`position: absolute; inset-inline: 0; bottom: 0` 覆盖于视频底部；进度条贴浮层顶缘、其余控件一行。`replay-stage.module.css`——浮层渐变背景 `linear-gradient(transparent, rgba(0,0,0,.7))`；显隐复用现有「静止 3s 隐藏」opacity 切换（`controlsIdle`），补暂停时常显；`:fullscreen` 全屏时 videoArea 撑满、浮层贴底；移动端浮层内控件可触达、不超出画面。**纯结构调整 + CSS，播放器 / seek / 弹幕浮层逻辑零改动**。
- **测试用例（红）**：
  1. `.controls` 渲染在 `.videoArea` 容器内部（DOM 父子断言），不再占画面下方独立布局空间。
  2. 暂停时控件常显（`controlsIdle` 不生效于 paused）；「次要7 控件栏静止 3s 真正隐藏，移动鼠标/触摸重现」用例保持绿。
  3. 浮层形态下全部控件功能不回归：播放/暂停、进度拖动 seek、音量、倍速、弹幕开关、全屏（既有用例全绿）。
- 对应验收：AC-1。
- 预计：2h。

### T6 ✅ 进度条 hover 时间预览（FR-3）

- 产出：`replay-stage.tsx`——`.progressWrap` 监听 `pointermove`（`pointerType === "mouse"` 才启用），按 `offsetX / 宽度 × duration` 计算预览时间，渲染跟随指针 tooltip（复用 `formatOffset`）；`pointerleave` 隐藏；拖动中（`draftTime` 非空）优先显示 draft 值、hover 预览让位。`replay-stage.module.css`：tooltip 绝对定位。不动 seek 提交链路。
- **测试用例（红）**：
  1. mouse `pointermove` → tooltip 显示且时间与位置换算正确（如半程 ≈ `formatOffset(duration/2)`），随位置实时更新。
  2. `pointerleave` 隐藏；`pointerType=touch` 不显示预览（不影响现有拖动预览）。
  3. 拖动中显示 draft 值且与 hover 预览互斥；「P3(a) 拖动中仅预览，松开后才触发 seek」用例不回归。
- 对应验收：AC-3。
- 预计：1.5h。

### T7 ✅ 网页全屏 theater 模式（FR-5）

- 产出：`replay-stage.tsx`——新增 `isTheaterMode` state 与控件按钮（`IconTheater`、`aria-pressed`）；开启时舞台切换 `position: fixed; inset: 0` 覆盖层（z-index 高于页头），flex-row：左侧 `.videoColumn`（flex 1，`.videoArea` flex 居中 + `aspect-ratio: 16/9` + `max-width/max-height` 约束实现「画面居中、尽可能大」，非顶对齐），右侧 `.timeline`（固定宽 320–360px、全高滚动）；控件浮层形态不变（FR-1）。互斥：`fullscreenchange` 进入浏览器全屏即退出 theater 并记住、退出后恢复（单一事实源 `document.fullscreenElement`）；theater 开启时全屏按钮仍可用（进入即暂退 theater）。移动端（`< 48em`）不渲染 theater 按钮（与移动端隐藏音量滑杆同法）。`replay-stage.module.css`：theater 布局与断点。
- **测试用例（红）**：
  1. 点击按钮切换 theater 布局 class、`aria-pressed` 同步；再次点击恢复原布局。
  2. `.videoArea` 居中约束存在（flex 居中 + `aspect-ratio`，非顶对齐）。
  3. 互斥：派发 `fullscreenchange` 进入浏览器全屏 → theater 关闭并记住；退出 → 恢复进入前状态（含「theater → 全屏 → Esc」序列）。
  4. 移动端断点下不渲染网页全屏入口。
  5. T4 全屏切换用例、FR-1 浮层用例不回归。
- 对应验收：AC-5。
- 预计：2.5h。

### T8 ✅ 事件列表信息流化（FR-6）

- 产出：
  1. 新增 `src/features/recordings/replay/event-feed.tsx`（导出 `EventFeedItem`，props 契约见技术方案 §4.2）+ `event-feed.module.css`。按 `event.type` 分派：
     - `danmaku`：inline 流式、可换行——粉丝牌 badge（牌名+等级，`medal.color` 着色）+ 浅色用户名（弱化强调色，深色背景下可读）+ 冒号 + 发言；`emote` 渲染 `<img>`（`loading="lazy"`，图文混排）。
     - `gift`：inline 可换行——发送者（同 6.1 样式）+ 礼物图标 + `gift.name ×count` + 金额（`price > 0` 时）；`gift_v2` 归一事件同结构（T1）。
     - `guard_buy`：**独占一行**醒目卡片（底色/左边框区分）——「用户名 开通了 guard.name ×count」+ 金额；`face`/`medal` 恒空不崩（需求 §7 上游事实）。
     - `super_chat`：**独占一行**卡片——用户名、留言内容、金额；背景 `scColors.backgroundStart → backgroundEnd` 渐变、文字 `fontColor`，缺失/非法回退默认醒目配色。
  2. `replay-stage.tsx`——`TimelineEntry` 重构为 `{ event: LiveEvent; offsetSeconds }`（不再拍平，删除 `entryLabel`）；条目渲染换 `EventFeedItem`，保留时间戳（`formatOffset`）、点击 seek、当前高亮、自动跟随/「回到底部」滚动行为（窗口化数据链路零改动）。
  3. 改写 R8 用例「FR-5 事件列表展示 SC / 礼物 / 舰长类型徽标（entryLabel）」为信息流断言（该用例依赖将被删除的 `entryLabel`）。
- **测试用例（红）**（新增 `tests/recordings-event-feed.test.tsx` + `tests/recordings-replay-stage.test.tsx` 集成补充）：
  1. danmaku：badge（牌名+等级、着色样式）+ 浅色用户名 + 冒号 + 发言 inline 混排；`emote` 渲染 `img`（懒加载属性）。
  2. gift：图标 / `名称 ×count` / 金额（`price > 0` 才显示）；gift_v2 归一事件渲染一致。
  3. guard_buy：整行卡片文案「用户名 开通了 guard.name ×count」+ 金额；无 medal/face 不崩；与普通弹幕视觉区分（独立 class）。
  4. super_chat：`scColors` 内联渐变 + `fontColor`；缺失时回退默认配色；金额与留言展示。
  5. 点击条目触发 `onSeek(offsetSeconds)`；replay-stage 集成：时间戳/高亮/跟随滚动/点击 seek 不回归（含「事件列表随播放高亮」「回到底部跟随」既有用例）。
- 对应验收：AC-6。
- 预计：3h。

### T9 ✅ 全量回归与验收（AC-7）

- 产出：无功能代码；执行 `pnpm test`、`pnpm lint`、`pnpm build` 全绿；对照需求 §4 执行人工验收清单（见 §4）；如发现回归，按红-绿流程补回归用例后修复。
- **测试**：全量既有用例（23 文件）+ T1–T8 新增用例全绿；重点回归面：seek/看门狗系列、R15 跨窗 seek、窗口化渲染、悬浮听直播（本期不动但同仓）。
- 对应验收：AC-7 + 全部 AC 人工项。
- 预计：1h（自动化）+ 人工验收。

## 3. 执行顺序与依赖

```
T1（类型/解析）────────────────→ T8（信息流）
T2（图标）→ T3（按钮组）
T4（全屏修复）→ T5（控件浮层）→ T6（hover 预览）→ T7（theater）
T9（全量验收）← 全部前置任务
```

- T1 是 T8 的数据前提（scColors/time/gift_v2 归一）；T2 是 T3/T7 的图标前提。
- T4 先于 T7：`document.fullscreenElement` + `fullscreenchange` 为全屏/theater 互斥的单一事实源。
- T5 先于 T6/T7：hover 预览与 theater 布局依赖浮层形态下进度条/控件位置稳定；T6 依赖 T5 定型的 `.progressWrap`。
- T3 独立页面（recordings-section），可与 T4–T7 并行推进。
- T8 仅依赖 T1（渲染组件独立），可与 T5–T7 并行；其 replay-stage 集成用例在 T5 结构定型后合跑。
- T9 依赖全部前置任务，收尾执行。

## 4. 验收对照

| 验收标准 | 覆盖任务 | 验证方式 |
|----------|----------|----------|
| AC-1 控件浮层 | T5 | 单测（DOM 父子断言、静止隐藏/复现、暂停常显、控件不回归）；人工验证亮/暗画面下浮层渐变背景可辨性、移动端触达 |
| AC-2 播放/下载按钮组 | T2、T3 | 单测（href 一致、download 直链、下拉开合、SVG 图标）；人工验证浏览器真实下载 FLV（跨源行为对照技术方案 §5 风险 #2） |
| AC-3 hover 时间预览 | T6 | 单测（换算/实时更新/隐藏/touch 不显示/draft 互斥）；人工验证预览手感与拖动 seek 不回归 |
| AC-4 全屏切换 | T4 | 单测（mock Fullscreen API 双向切换、fullscreenchange 状态回正）；人工验证 Esc 退出后按钮态 |
| AC-5 网页全屏 | T2、T7 | 单测（布局 class、居中约束、全屏互斥序列、移动端无入口）；人工验证 theater 手感（画面居中、右侧弹幕列表全高滚动） |
| AC-6 信息流 | T1、T8 | event-feed 组件级单测 + api 解析用例（scColors/time/gift_v2）；人工验证真实数据观感（SC/礼物/舰长卡片、表情混排） |
| AC-7 工程 | T9 | `pnpm test && pnpm lint && pnpm build` 全绿 |

**人工验收环境**：PC Chrome（≥1440px 与 1024px 宽度）、移动端模拟器（iPhone 15 / Android 360px）、含 SC/礼物样本的真实录播与跨源下载，对照需求 §4 逐项检查；人工项含浮层控件可辨性、theater 手感、SC/舰长卡片真实数据观感（技术方案 §6）。

## 5. 评审记录

| 评审人 | 日期 | 结论 | 备注 |
|--------|------|------|------|
| （待评审） | | | |

## 6. 返工留痕

- **第一轮下游打回（2026-09-25 · 「未见design文档」）**：下游节点反馈缺 UI/UX 设计文档。处理：补建 [docs/product/design/2026-09-25-recordings-optimization-phase1.md](../../product/design/2026-09-25-recordings-optimization-phase1.md)（FR-1~FR-6 布局/配色/交互稿、状态清单、可访问性、覆盖性自查 S1–S6 / AC-1~7），内容严格取自需求 §3 与技术方案 §3.2 已评审口径、无新增冲突决策（与技术方案逐条核对无出入，无需勘误）；本计划与技术方案 §1 的「对应设计」引用同步更新为已建立并给出 FR→设计章节映射。任务拆解（T1–T9）与测试计划不受影响。

## 7. 实现进度与偏差记录（2026-09-25 · 代码实现节点）

- **进度**：T1–T8 全部完成并勾选；T9 自动化部分完成——`pnpm test`（28 文件 / 273 通过 / 1 跳过）、`pnpm lint`（0 problems）、`pnpm build`（含 TypeScript 检查）全绿。
- **待人工项**：需求 §4 人工验收环境项（亮/暗画面下浮层可辨性、跨源 FLV 真实下载、theater 手感、SC/舰长卡片真实数据观感、移动端模拟器触达）仍需人工执行。
- **偏差与留痕**（均为实现口径细化，不改动已评审的需求/技术方案结论）：
  1. **新增 `tests/icons.test.tsx`**（T2 图标渲染口径独立成文件），已回写技术方案 §3.1 测试清单。
  2. **T7 移动端入口**：按设计 §2.3「按钮 CSS 隐藏，同移动端隐藏音量滑杆做法」实现，用例改为**媒体查询 CSS 源断言**（原计划文字「不渲染」的口径细化为「移动端断点不出现」，与设计稿一致，设计稿优先）。
  3. **T8 跟随滚动定位源**：`TimelineEntry` 改为持有 `LiveEvent` 并由 `EventFeedItem` 渲染整条（button 含时间戳/高亮/seek）后，自动跟随由 `[data-index="{i}"]` 改为 `[data-current="true"]` 定位——两者在 `currentIndex >= 0` 时等价，行为不变；`entryLabel` 与 `.entry*` 样式按计划删除，样式迁移至 `event-feed.module.css`。
  4. **T8 R8 用例**：已按计划由 entryLabel 拍平文本断言改写为信息流断言（SC 内联配色 / 礼物 / 舰长卡片 / 时间戳保留 / 拍平前缀不再出现）。
  5. **T5 结构迁移**：控件移入 `.videoArea` 后，原 `supported !== false` 包裹在该分支内恒为真（TS 已收窄为 `true | null`）→ 移除冗余包裹；暂停常显除派生 `controlsHidden` 外，暂停路径同步重置 `controlsIdle`，保证恢复播放不残留隐藏态。
  6. **T4 图标**：切换态图标按计划要求「同步按钮图标」新增 `IconFullscreenExit`（与 T2 的 `IconDownload`/`IconTheater` 同描边口径，SVG 断言在 T4 用例覆盖）。
