# 页面优化一期 — 技术方案

- 版本：v1.2（2026-09-25 返工 R1：FR-4 口径修订——文案改右箭头「→」；录播入口改为**替换**详情区「未开播」文本，`LiveBadge` 增加 `offlineNode` 作为单一状态出口，`RecordingEntry` 降为纯展示节点；同步 §6 测试策略。此前 v1.1 为 roomId 静态硬编码方案）
- 日期：2026-09-25
- 状态：待评审

## 1. 对应上游文档

- 产品需求：[`../../product/requirement/page-optimization-phase1.md`](../../product/requirement/page-optimization-phase1.md)
- UI/UX 设计：待补充（`../../product/design/page-optimization-phase1.md`）。本期变更均为链接目标、动效参数与状态同步，无新增视觉元素布局（FR-4 仅新增一行文本链接，沿用现有排版），可在设计文档补齐前先行评审技术可行性。

## 2. 技术选型

- 沿用现有技术栈：Next.js（静态导出）+ React + TypeScript + CSS Modules；PC 端滚动继续使用已引入的 `lenis` + `lenis/snap`；移动端继续使用 CSS scroll-snap。
- **不新增任何依赖**。query param 读写使用 Next 内置 `useSearchParams` / `window.history.replaceState`。
- 测试沿用 Vitest 5 + jsdom + @testing-library/react（见 `vitest.config.ts`、`tests/utils.tsx` 的 `renderWithTheme`）。

## 3. 架构设计

### FR-1 直播徽章跳转直播间

涉及文件：

- `src/data/members.ts`：为四位成员补齐静态 `roomId` 字段（字段已存在于 `Member` 类型，`members.ts:16`）。roomId 已通过线上录播服务接口实际确认（见 §4 对照表），B 站直播间号长期不变，硬编码是可靠数据源。
- `src/components/live-badge.tsx`：开播分支的 `href` 改为 `member.roomId` 存在时渲染 `https://live.bilibili.com/{roomId}`，否则降级为 `member.bilibili`（个人主页）。
- `src/lib/live-status.ts`：**不改**。直播状态接口实测返回结构为 `{ ok, status: { live, title, startedAt } }`，不含 roomId；roomId 全部来自成员静态数据。

数据流：直播状态接口（`member.liveStatusUrl`）→ `fetchLiveStatus` 模块级缓存 → `useLiveStatus` → `LiveBadge`（仅取 `living`/`title`）；跳转目标由成员静态 `roomId` 决定，与状态请求完全解耦。`HeroWall` / `MemberSection` 内嵌的徽章共用同一组件，改动一处即同时覆盖两个位置。

### FR-2 滚动吸附动效

涉及文件：

- `src/components/smooth-scroll.tsx`：为 `Lenis` 与 `Snap` 显式配置动画参数（`duration` / `easing`），使吸附（含 proximity 触发后的归位）走 lenis 的动画插值而非瞬时跳变；保持 `type: "proximity"` 与现有吸附点计算（`sectionCenter`）不变。
- `src/app/globals.css`（:40-44）与 `src/components/member-section.module.css`（:8）：移动端 `scroll-snap-type: y proximity` + `scroll-snap-align: center` 维持现状（浏览器原生平滑吸附）。
- 已排查：全仓库不存在 `prefers-reduced-motion` 相关 CSS/逻辑；实现时不得引入，确保完整动效呈现。

### FR-3 录播页单展开 + Query Param 同步

涉及文件：

- `src/features/recordings/recordings-section.tsx`：将各 `MemberGroup` 内部的 `expanded` 本地 state（:56）**上移**为父组件 `RecordingsSection` 持有的单一状态 `expandedMemberId: string | null`，通过 props 下发 `expanded` 与 `onToggle`，天然保证手风琴（至多一个展开）。
- URL 同步（客户端 only）：
  - 初始化：`useSearchParams` 读取 `member` 参数 → 校验是否存在于 `members` 数据 → 有效则设为 `expandedMemberId` 并触发该分组的 `load`（复用现有懒加载 :68-106）与滚动定位（复用 `REVEAL_GROUP_EVENT` / `revealGroup` 的滚动逻辑，`live-status-grid.tsx:168-176`）。
  - 变更：展开/收起时以 `window.history.replaceState` 写/删 `member` 参数（静态导出下避免 `router.replace` 触发 RSC 导航）。
  - `REVEAL_GROUP_EVENT`（`src/features/recordings/reveal-group.ts`）触发的展开同样走统一入口，保证 URL 同步一致。
- `src/features/recordings/recordings-view.tsx`：静态导出下 `useSearchParams` 需包在 `Suspense` 边界内（Next 要求），在 view 层为 `RecordingsSection` 增加 `<Suspense>` 包裹或将参数读取集中到带 Suspense 的子组件。

接口约定：query param 键为 `member`，值为 `Member["id"]`（如 `viridis` / `komichi` / `chu2u` / `sumire`）。

### FR-4 未开播录播入口（替换详情区「未开播」文本）

涉及文件：

- `src/components/live-badge.tsx`：**成为详情区直播状态的单一状态出口**。新增可选 prop `offlineNode`（未开播态的替换渲染）：未开播分支渲染 `offlineNode ?? <span>未开播</span>`——缺省（`HeroWall`）保持 AC-3 原行为，传入时以替换而非并列的方式承接录播入口。加载中骨架、开播徽章两分支不变（AC-1/2/3 不回归）。
- 新增 `src/components/recording-entry.tsx`（纯展示节点，**不自行订阅直播状态**）：仅渲染 `<a href="/recordings?member={member.id}">未开播，看录播 →</a>`（右箭头 U+2192）。状态判定全部上移至 `LiveBadge`，避免同一位置出现双行与重复订阅。
- `src/components/member-section.tsx`：`<LiveBadge member={member} offlineNode={<RecordingEntry member={member} />} />`——详情区按状态三选一渲染（未开播→仅入口 / 开播→仅徽章 / 加载中→仅骨架）。
- 请求口径不变：详情区徽章仍经 `useLiveStatus(member.id)` 读 `live-status.ts:16-17` 的模块级缓存，同一成员页面生命周期内只请求一次；`RecordingEntry` 不新增任何请求。
- 站内跳转 `/recordings?...` 不以 `#` 开头，`smooth-scroll.tsx:38` 的锚点拦截自然放行，走 Next 客户端导航。

## 4. 接口设计

- roomId 对照表（2026-09-25 通过录播服务 `GET https://recordings.vtuber.fffdan.com/api/b/live/recording-status` 按 `mid` 关联实测确认）：

  | 成员 | mid | roomId | 直播间 |
  |------|-----|--------|--------|
  | viridis（小松绿） | 1891335475 | 1727071052 | https://live.bilibili.com/1727071052 |
  | komichi（四时小路） | 1512246445 | 1700301235 | https://live.bilibili.com/1700301235 |
  | chu2u（羽啾） | 2138961136 | 1727074031 | https://live.bilibili.com/1727074031 |
  | sumire（枝堇） | 1150976664 | 1727076670 | https://live.bilibili.com/1727076670 |

- `Member.roomId`（`src/data/members.ts:16`，已有可选字段）：按上表硬编码补齐；B 站直播间号与账号绑定、长期不变，静态数据即可作为权威来源。
- 直播间 URL 拼装：`https://live.bilibili.com/${roomId}`（集中为一个纯函数，便于测试）。
- 录播页 URL：`/recordings?member={memberId}`（FR-3 / FR-4 共用同一约定）。
- `MemberGroup` 受控化后的 props：`{ member, expanded, onToggle }`（其余数据加载逻辑保留在组件内部）。

## 5. 风险与权衡

- **roomId 数据源（已实测闭环）**：直播状态接口实测返回 `{ ok, status: { live, title, startedAt } }`，不含 roomId；roomId 已通过录播服务 recording-status 接口按 `mid` 关联确认（§4 对照表），直播间号长期不变，采用静态硬编码 + `member.bilibili` 个人主页降级两级链。若未来成员更换直播间，需同步更新 `members.ts`（可在数据文件中注明来源接口便于复核）。
- **手风琴与既有联动**：`REVEAL_GROUP_EVENT` 目前假设多分组可并存展开；上移状态后该事件改为「切换展开目标」，行为变化已由 PRD FR-3 覆盖（录播页状态卡片点击 → 展开对应分组并收起其他）。备选方案是保留多展开、仅把「最后展开的分组」写入 URL——被否，因 PRD 明确要求单展开。
- **`useSearchParams` 与静态导出**：静态导出下未包 Suspense 的 `useSearchParams` 会导致构建期报错，必须以 Suspense 边界隔离；或退化为 `useEffect` 内读取 `window.location.search`（失去声明式但规避构建约束）。首选 Suspense 方案，构建验证不通过时退化。
- **动效参数主观性**：lenis 的 `duration`/`easing` 取值属体验调优，以实现评审时的实际手感为准，测试只断言「吸附为动画过程」而非具体参数。
- **行为变更面**：`MemberGroup` 受控化涉及既有测试更新（`tests/recordings-section.test.tsx` 等），按 TDD 先改测试。

## 6. 测试策略

遵循 TDD 红-绿-重构，测试平铺于 `tests/`，复用 `renderWithTheme` 与 `vi.hoisted` + `vi.mock` 的数据层 mock 模式：

- `tests/members.test.ts`（改）：四位成员均已填写 `roomId` 且为有效数字（防止后续数据回退）。
- `tests/live-badge.test.tsx`（改）：开播且 `member.roomId` 存在 → `href=https://live.bilibili.com/{roomId}`（AC-1）；构造无 `roomId` 的成员 → 降级 `member.bilibili`（AC-2）；未开播/加载中不可点击（AC-3）。
- `tests/recording-entry.test.tsx`（改）：渲染「未开播，看录播 →」且 `href=/recordings?member={id}`，可读名与可见文案一致且不含 ASCII `->`；断言其不再自行订阅直播状态（状态出口在 `LiveBadge`）。
- `tests/live-badge.test.tsx`（改）：`offlineNode` 三态替换断言（未开播→渲染替换节点且不出现「未开播」文本；开播→仅徽章；加载中→仅骨架）；保留 HeroWall 侧未开播「未开播」纯文本的 AC-3 回归断言。
- `tests/member-section.test.tsx`（改）：详情区替换语义——未开播只见录播入口不见「未开播」文本、开播只见徽章不见入口、加载中只见骨架两者皆无；并断言详情区仅一次 `useLiveStatus` 订阅（单一状态出口）。
- `tests/recordings-section.test.tsx`（改 + 增）：手风琴单展开（AC-5）；展开/收起时 URL 参数写删（AC-6，jsdom 下断言 `window.location.search`）；带 `?member=` 初始渲染自动展开并触发加载、无效参数忽略（AC-7）；`REVEAL_GROUP_EVENT` 联动后 URL 同步。
- 动效（AC-4）：对 `smooth-scroll.tsx` 做结构断言（lenis/snap 初始化含显式动画配置）+ 全仓库 grep 断言无 `prefers-reduced-motion` 规则；连续动画的实际手感由人工验收。
- 回归：`pnpm test` 全绿、`pnpm lint` 通过、`pnpm build`（静态导出）通过。

## 7. 评审记录

| 评审人 | 日期 | 结论 | 备注 |
|--------|------|------|------|
| （待填写） | | | |
