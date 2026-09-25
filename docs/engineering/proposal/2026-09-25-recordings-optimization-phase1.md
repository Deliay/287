# 287 粉丝站 · 录播优化一期技术方案

- 版本：v1.0
- 创建日期：2026-09-25
- 状态：待评审

## 1. 对应上游文档

- 需求：[docs/product/requirement/2026-09-25-recordings-optimization-phase1.md](../../product/requirement/2026-09-25-recordings-optimization-phase1.md)
- 设计：[docs/product/design/2026-09-25-recordings-optimization-phase1.md](../../product/design/2026-09-25-recordings-optimization-phase1.md)（同名主题，UI/UX 阶段产物，2026-09-25 已由下游节点补建；内容取自需求 §3 与本方案 §3.2 已评审口径，经逐条核对与本方案无出入。布局/配色细节以设计稿为准，如有出入以设计稿为准并回本方案勘误）
- 基线：[录播模块技术方案](./2026-09-23-recordings-module.md)（已实现的播放器、seek、弹幕窗口化加载均沿用，不改动）

## 2. 技术选型

| 技术 | 用途 | 选型理由 |
|------|------|----------|
| 现有栈（Next.js 16 / React 19 / TS / Mantine / CSS Module） | 全部 6 项改动 | 均为现有回放页与列表页的视图层/状态层改造，**不引入任何新依赖** |
| Fullscreen API（已有用法） | FR-4 修复、FR-5 互斥 | 现有 `requestFullscreen` 调用点补退出分支与 `fullscreenchange` 监听即可 |
| 浏览器原生下载（`<a href download>` / 程序化点击） | FR-2 下载 | 录播文件为直链 FLV 字节流；跨源时 `download` 属性可能被浏览器忽略（转为导航打开），属可接受行为，见 §5 风险 #2 |

**新依赖必要性说明**：无新增运行时/开发依赖。网页全屏用 CSS（`position: fixed` 全窗口覆盖层）实现，不引库；事件卡片样式用 CSS Module 自绘。

## 3. 架构设计

### 3.1 改动地图（均为现有文件改造 + 少量新增）

```
src/features/recordings/
├── recordings-section.tsx              # FR-2：条目拆分「标题 Link 区 + 右侧按钮组」
├── recordings-section.module.css       # FR-2：按钮组/下拉菜单样式
├── types.ts                            # FR-6：LiveEvent 增加 scColors/time；LiveEventType 防御性兼容 gift_v2
├── api.ts                              # FR-6：parseLiveEvent 解析 scColors/time、白名单兼容 gift_v2（按 gift 归一）
└── replay/
    ├── replay-stage.tsx                # FR-1/3/4/5/6 主战场：控件浮层化、hover 预览、全屏修复、
    │                                   #   网页全屏状态与布局分支、事件列表信息流化（TimelineEntry 重构）
    ├── replay-stage.module.css         # 浮层控件、:fullscreen、网页全屏覆盖层、事件卡片样式
    ├── event-feed.tsx                  # 新增：事件列表条目渲染组件（danmaku/gift inline、guard/SC 整行卡片）
    └── event-feed.module.css           # 新增：信息流条目样式
src/components/icons.tsx                # FR-2/5：新增 IconDownload、IconTheater（网页全屏）等 SVG 图标
tests/
├── recordings-section.test.tsx         # 补按钮组用例
├── recordings-api.test.ts              # 补 scColors/time/gift_v2 解析用例
├── recordings-replay-stage.test.tsx    # 补浮层/全屏切换/网页全屏/hover 预览用例
├── icons.test.tsx                      # 新增：IconDownload / IconTheater 渲染口径用例
└── recordings-event-feed.test.tsx      # 新增：信息流条目渲染用例
```

### 3.2 各项改动的实现思路

**FR-1 控件浮层化（replay-stage.tsx + CSS）**

现状：`.controls` 是 `.videoArea` 的兄弟节点（`replay-stage.tsx:711-862`），`.videoColumn` 为 flex column，控件占独立布局空间。改为：将 `.controls` 移入 `.videoArea`（`position: relative` 容器）内部，`position: absolute; inset-inline: 0; bottom: 0` 覆盖于视频底部，背景改为 `linear-gradient(transparent, rgba(0,0,0,.7))`。显隐逻辑复用现有「静止 3s 隐藏」的 opacity 切换（`:169-173`），补充暂停时常显。进度条贴浮层顶缘，其余控件排一行。纯结构调整 + CSS，播放器/seek 逻辑零改动。

**FR-2 播放/下载按钮组（recordings-section.tsx）**

现状：条目为整行单个 `<Link>`（`recordings-section.tsx:202-228`）。改为 `li` 内两部分：标题区保留 `<Link>`（点击进回放页），右侧新增按钮组——主按钮「播放」（跳转 `recordingReplayHref`）+ 箭头按钮切换下拉菜单（含「下载」项）。「下载」复用 `recordingFileUrl(roomId, file.name)`（`api.ts:266-271`），以 `<a href={url} download={file.name}>` 触发。下拉菜单用本地 state 控制开合，点击外部/Esc 关闭（简单焦点管理，不引库）。新增 `IconDownload`（`icons.tsx`，描边风格与现有 IconPlay 一致）。

**FR-3 进度条 hover 预览（replay-stage.tsx）**

现状：进度条为自绘轨道 + 透明 `input[type=range]` 叠加（`:723-795`），仅有按下后的 draft 预览。新增：`.progressWrap` 上监听 `pointermove`（`pointerType === "mouse"` 时才启用），按 `offsetX / 宽度 × duration` 计算预览时间，渲染跟随指针的 tooltip（绝对定位，复用 `formatOffset`）；`pointerleave` 隐藏。与 draft 拖动预览互斥显示（拖动中优先 draft 值）。纯增量，不动 seek 提交链路。

**FR-4 全屏退出修复（replay-stage.tsx:615-620）**

根因（已定位）：`handleFullscreen` 无条件 `requestFullscreen()`，无 `exitFullscreen` 分支、无 `fullscreenchange` 监听，重复请求被 `.catch(() => {})` 静默吞掉。修复：

```ts
const handleFullscreen = () => {
  if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); return; }
  containerRef.current?.requestFullscreen?.().catch(() => {});
};
```

同时新增 `isFullscreen` state + `fullscreenchange` 监听（同步按钮图标/aria-pressed，并处理 Esc 退出后的状态回正）；补 `:fullscreen` CSS（全屏时 videoArea 撑满、控件浮层贴底）。

**FR-5 网页全屏（replay-stage.tsx + CSS）**

新增 `isTheaterMode` state 与控件按钮（IconTheater）。实现为 CSS 覆盖层：开启时 `.stage`（或舞台容器）切换为 `position: fixed; inset: 0; z-index` 高于页头，flex-row 布局——左侧 `.videoColumn`（flex 1，其内 `.videoArea` 用 flex 居中 + `aspect-ratio: 16/9; max-width/max-height` 约束实现「画面在剩余空间居中、尽可能大」，而非顶部对齐），右侧 `.timeline`（固定宽 320–360px，全高滚动）。与浏览器全屏互斥：`fullscreenchange` 进入浏览器全屏时退出 theater 态并记住、退出后恢复；theater 开启时全屏按钮仍可用（进入即暂时退出 theater）。移动端（`< 48em`）不渲染 theater 按钮（CSS 隐藏，与移动端隐藏音量滑杆同法）。

**FR-6 事件列表信息流化（新增 event-feed.tsx + 类型扩展）**

现状：`TimelineEntry`（`replay-stage.tsx:92-111`）把 `LiveEvent` 拍平成 `{type, sender(=name), content}` 纯文本，丢弃 medal/gift/guard/price/scColors。改动：

1. **数据层**：`LiveEvent` 增加 `scColors?: { backgroundStart; backgroundEnd; fontColor }`、`time?: number`（实测已返回，见需求 §7）；`LiveEventType` 白名单加入 `"gift_v2"` 并在 `parseLiveEvent` 归一为 `gift`（防御，服务端已归一）；`TimelineEntry` 改为直接持有 `LiveEvent` 引用 + `offsetSeconds`，不再拍平。
2. **渲染层**：新增 `event-feed.tsx` 导出 `EventFeedItem`，按 `event.type` 分派：
   - `danmaku`：inline 流式布局——粉丝牌 badge（牌名+等级，`medal.color` 着色边框/底）、浅色用户名（`opacity`/`color-mix` 弱化的强调色）、冒号、发言文本；`emote` 渲染 `<img>`（固定行内高度，懒加载 `loading="lazy"`）。
   - `gift`：inline——发送者（同弹幕样式）+「赠送」+ 礼物图标 `<img>` + `gift.name ×count` + 金额（`price > 0` 时）。
   - `guard_buy`：整行卡片（占满一行，醒目底色/左边框），「用户名 开通了 guard.name ×count」+ 金额；无头像无粉丝牌（上游事实）。
   - `super_chat`：整行卡片，背景用 `scColors.backgroundStart → backgroundEnd` 渐变、文字 `fontColor`（缺失用默认金色系），显示金额与留言内容。
3. **容器**：条目保留时间戳与点击 seek、当前高亮、自动跟随逻辑（复用现有 `.timeline` 容器行为）；跟随/高亮的数据源从拍平文本切换为 `LiveEvent`。

### 3.3 数据流与状态管理

- 新增组件状态均为 `ReplayStage` 内局部 state（`isFullscreen` / `isTheaterMode` / hover 预览 / 下拉开合），不进全局 store，不影响音频注册表与悬浮组件。
- `fullscreenchange` 监听在 `ReplayStage` 挂载期注册、卸载移除。
- 事件列表数据链路（窗口化 store、`eventsFor`、跟随滚动）完全不变，仅条目渲染替换。

## 4. 接口设计

### 4.1 外部接口（无新增，契约按调研刷新）

回放事件接口 `GET {API_BASE}/api/live-events/replay` 输出契约（2026-09-25 调研确认，详见需求 §7）：

```ts
type LiveEventType = "danmaku" | "super_chat" | "gift" | "guard_buy";
// gift_v2 为上游信封类型，服务端归一化为 gift 输出（前端透明）；解析层防御性兼容

interface LiveEvent {
  eventId: string; type: LiveEventType; occurredAt: string;
  sender: { uid: number; name: string; face: string | null;
    medal: { name: string; level: number; color: string } | null;
    guardLevel: number | null };          // guard_buy 时 face/medal 恒 null（上游事实）
  content?: string;                       // danmaku / super_chat
  emote?: { url: string; name?: string; width?: number; height?: number };
  price?: number;                         // super_chat / gift / guard_buy（单位：元）
  scColors?: { backgroundStart: string; backgroundEnd: string; fontColor: string }; // super_chat，前端类型新增
  time?: number;                          // super_chat 悬停秒数，前端类型新增（卡片展示可不依赖）
  gift?: { name: string; count: number; iconUrl?: string };
  guard?: { level: number; name: string; count: number }; // level 3/2/1 = 舰长/提督/总督
}
```

下载直链：`recordingFileUrl(roomId, fileName)`（现有 `api.ts:266-271`），无新接口。

### 4.2 内部模块契约（新增/变更）

```tsx
// replay/event-feed.tsx（新增）
interface EventFeedItemProps {
  event: LiveEvent;
  offsetSeconds: number;
  current: boolean;                 // 当前播放位置高亮
  onSeek(offsetSeconds: number): void;
}
export function EventFeedItem(props: EventFeedItemProps): JSX.Element;

// replay-stage.tsx 内 TimelineEntry 重构（变更）
interface TimelineEntry { event: LiveEvent; offsetSeconds: number } // 不再拍平 sender/content
```

## 5. 风险与权衡

| # | 风险 | 影响 | 缓解 / 取舍 |
|---|------|------|-------------|
| 1 | 控件浮层化 + 网页全屏是 `.videoColumn`/`.videoArea` 结构调整，触及 replay-stage 的 seek/控件测试面 | 回归风险集中在回放页 | 结构调整不动播放器/seek/弹幕浮层逻辑；既有 `recordings-replay-stage.test.tsx` 用例先行跑通（红-绿），新增浮层/全屏/theater 用例；`:fullscreen` 与 theater 两种形态分别覆盖 |
| 2 | 录播文件跨源下载时浏览器可能忽略 `download` 属性（改为新标签打开/直接播放） | 下载体验降级 | 直链是唯一可用来源（静态站无服务端中转）；接受该浏览器行为差异并在文档注明；`Content-Disposition` 由录播服务决定，不在本站控制面 |
| 3 | scColors 为接口可选字段，异常配色可能不可读 | SC 卡片观感 | 缺失或非法（非 #RRGGBB）时回退默认配色；文字色与背景对比度不做运行时校验，信任上游 |
| 4 | 事件列表条目变高（卡片化）后单位视口条数减少 | 长列表滚动性能 | 沿用窗口化数据（当前 ± 相邻 10 分钟），渲染条数不变；图片 `loading="lazy"`；不引虚拟化（与一期 §5-4 同口径） |
| 5 | gift_v2 未来若服务端改为透传，前端需正确展示 | 兼容性 | `parseLiveEvent` 白名单接受 `gift_v2` 并归一为 `gift` 结构（字段同构），配单测 |
| 6 | theater 模式与浏览器全屏状态交织（先后进入/退出顺序） | 状态错乱 | 单一事实源：`document.fullscreenElement` + `fullscreenchange` 事件驱动；进入浏览器全屏即退出 theater（退出后恢复），互斥逻辑配单测 |

## 6. 测试策略

遵循根目录 `AGENTS.md` 红-绿-重构 TDD，沿用 Vitest + RTL + `renderWithTheme`。

| 验收标准 | 测试方式 |
|----------|----------|
| AC-1（控件浮层） | 断言 `.controls` 渲染在 `.videoArea` 容器内；假定时器验证静止隐藏/移动复现；控件按钮功能用例在浮层形态下不回归 |
| AC-2（按钮组） | recordings-section：条目右侧按钮组渲染、「播放」href 与条目一致、下拉展开出现「下载」且指向 `recordingFileUrl` 并带 `download` 属性、点击外部收起 |
| AC-3（hover 预览） | 模拟 `pointermove`（mouse）断言 tooltip 时间与位置换算；`pointerleave` 隐藏；touch pointerType 不显示；拖动中优先 draft 值 |
| AC-4（全屏切换） | mock Fullscreen API：已全屏点击调 `exitFullscreen`、未全屏调 `requestFullscreen`；派发 `fullscreenchange` 断言图标/aria-pressed 同步 |
| AC-5（网页全屏） | theater state 切换布局 class；videoArea 居中约束存在；与全屏互斥（fullscreenchange 进入时 theater 关闭）；移动端按钮不渲染 |
| AC-6（信息流） | event-feed 组件级：danmaku 渲染 medal badge + 浅色用户名 + 冒号 + 文本/表情 img；gift 渲染图标/名称/数量/金额；guard_buy/SC 整行卡片与 scColors 内联样式（缺失回退）；点击条目触发 onSeek；api 解析补 scColors/time/gift_v2 归一用例 |
| AC-7（工程） | `pnpm test` / `pnpm lint` / `pnpm build` 全绿 |

**人工验收项**：浮层控件在亮/暗画面下的可辨性、下载在跨源浏览器的实际行为、theater 模式手感、SC/舰长卡片真实数据观感（按需求文档逐项对照）。

## 7. 评审记录

| 评审人 | 日期 | 结论 | 备注 |
|--------|------|------|------|
| （待评审） | | | |
