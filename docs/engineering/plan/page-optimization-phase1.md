# 页面优化一期 — 技术实现计划

- 版本：v1.1（2026-09-25 实施回填：T0–T6 完成标记、T2/T4/T5 实施补充与 §6 验收记录）
- 创建日期：2026-09-25
- 对应技术方案：[docs/engineering/proposal/page-optimization-phase1.md](../proposal/page-optimization-phase1.md)（v1.1）
- 对应需求：[docs/product/requirement/page-optimization-phase1.md](../../product/requirement/page-optimization-phase1.md)（v1.0）
- 对应设计：待补充（`../../product/design/page-optimization-phase1.md`）。本期变更均为链接目标、动效参数与状态同步，无新增视觉布局；FR-4 仅新增一行文本链接，沿用现有排版（技术方案 §1），不阻塞本计划执行。
- 状态：已实施（T0–T6 完成，门禁全绿；待人工验收与评审）

> 前置状态：需求与技术方案均已提交至需求总分支 `feat/page-optimization-phase1`（PR #8，含返工提交 27a0c0c：roomId 经线上 recording-status 接口实测确认，改静态硬编码方案）。
> 每个任务遵循红-绿-重构循环：先写失败测试 → 最小实现使其通过 → 重构保持全绿。
> 每个任务完成后在本文档 §1 对应标题后标记 ✅。
> 行号引用以返工提交 27a0c0c 为准，实现漂移时以语义锚点为准。

## 1. 任务拆解

### T0 ✅ 成员数据补齐 roomId `src/data/members.ts`

- 产出：四位成员按技术方案 §4 实测对照表硬编码 `roomId`（字段已存在，`members.ts:16`）：viridis=1727071052、komichi=1700301235、chu2u=1727074031、sumire=1727076670；字段注释注明数据源（2026-09-25 录播服务 recording-status 接口按 mid 关联实测，直播间号长期不变）。
- 同步处理 `liveUrl` 字段（`members.ts:31-32`，注释写着「待需求 T1 确认」）：本期需求即确认直播入口为 `https://live.bilibili.com/{roomId}`，由 T1 的纯函数从 roomId 推导；`liveUrl` 字段保留但注释更新为「已由 roomId 推导取代，仅作逐成员特殊覆盖的逃生口」，四位成员均不填写。
- **测试用例（红）**：`tests/members.test.ts`（改）
  1. 四位成员均已填写 `roomId` 且为正整数；数值与对照表逐项一致（防数据回退）。
  2. 既有 members 断言（顺序、bilibili、colorKey）保持全绿，不回归。
- 对应验收：AC-1 / AC-2 的数据基础。
- 预计：0.5h。

### T1 ✅ 直播间 URL 纯函数 + LiveBadge 跳转直播间

- 产出：
  - `src/data/members.ts` 导出纯函数 `liveRoomUrl(roomId: number): string`（返回 `https://live.bilibili.com/${roomId}`，集中拼装便于测试，技术方案 §4）。
  - `src/components/live-badge.tsx:44`：开播分支 `href` 由 `member.liveUrl ?? member.bilibili` 改为 `member.liveUrl ?? (member.roomId !== undefined ? liveRoomUrl(member.roomId) : member.bilibili)`——roomId 优先跳直播间，缺失时降级个人主页（AC-2），`liveUrl` 作为逐成员逃生口语义不变；`target="_blank"` / `rel` / aria-label 不变。加载中骨架与未开播纯文本两态不改（AC-3）。`HeroWall` / `MemberSection` 共用同一组件，改动一处即覆盖两处。
  - `src/lib/live-status.ts`：**不改**（技术方案 FR-1：接口实测无 roomId，状态与跳转目标解耦）。
- **测试用例（红）**：`tests/live-badge.test.tsx`（改，沿用 `vi.hoisted` + `vi.mock("@/lib/live-status")` 模式）
  1. mock 开播状态且 `member.roomId` 存在 → `href === https://live.bilibili.com/{roomId}`，`target="_blank"`（AC-1）。
  2. 构造无 `roomId` 的成员 → `href` 降级为 `member.bilibili`（AC-2）。
  3. 未开播 / 加载中不渲染链接、不可点击（AC-3 回归）。
  4. `liveRoomUrl` 纯函数单测（可并入 `tests/members.test.ts`）。
- 对应验收：AC-1、AC-2、AC-3。
- 预计：1h。

### T2 ✅ 滚动吸附显式动画参数 `src/components/smooth-scroll.tsx`

- 产出：
  - `smooth-scroll.tsx:68` `new Lenis({ autoRaf: true })` 与 `:71` `new Snap(lenis, { type: "proximity" })` 显式补 `duration` / `easing` 动画参数（lenis ^1.3.26，构造参数与 Snap 选项均支持），使 proximity 吸附归位走动画插值而非瞬时跳变；`type: "proximity"` 与吸附点计算（`sectionCenter` :13-18）不变。具体取值属体验调优，以实现评审时的实际手感为准（技术方案 §5）。
  - 移动端维持现状：`globals.css:40-44`（`scroll-snap-type: y proximity`）与 `member-section.module.css:8`（`scroll-snap-align: center`）不动。
  - 全仓库复核：不引入任何 `prefers-reduced-motion` 降级规则（当前仓库无此规则，PRD FR-2 要求保持）。
  - **实施补充（2026-09-25）**：`new Lenis({ respectReducedMotion: false })` —— 排查发现 lenis ^1.3.26 默认 `respectReducedMotion: true`，命中系统「减少动效」时其 `scrollTo` 会走 `immediate = true` 分支，正是 PRD FR-2 要求「无视该降级、呈现完整动效」的情形，故显式关闭；取值 `SCROLL_DURATION = 1` / `SNAP_DURATION = 0.6` + `easeOutCubic`（体验调优值，手感以实现评审为准）。
- **测试用例（红）**：`tests/smooth-scroll.test.tsx`（改，沿用现有 `vi.mock("lenis")` / `vi.mock("lenis/snap")` 构造器捕获模式）
  1. PC 断点初始化时，Lenis 与 Snap 构造参数均含显式 `duration` 与 `easing`（结构断言，不断言具体取值——技术方案 §6 AC-4 只断言「吸附为动画过程」）。
  2. 既有吸附点注册 / resize 重注册 / 锚点拦截用例保持全绿。
  3. 新增全仓库源码断言（读 `src/` 下文件或 grep）：不存在 `prefers-reduced-motion` 规则（防止后续引入）。
- 人工验收（AC-4 的连续动画手感）留待 T6 清单。
- 对应验收：AC-4。
- 预计：1.5h。

### T3 ✅ 录播分组手风琴单展开（状态上移）`src/features/recordings/recordings-section.tsx`

- 产出：
  - `MemberGroup` 的 `expanded` 本地 state（:56）**上移**为 `RecordingsSection`（:273）持有的单一状态 `expandedMemberId: string | null`；`MemberGroup` 受控化，props 变为 `{ member, roomId, statusKind, expanded, onToggle }`（技术方案 §4；roomId / statusKind 仍由父级注入）。
  - 「触发加载即展开」语义改走父级回调：`load` 内 `setExpanded(true)`（:72）改为调用 `onToggle`/`onExpand` 通知父级置 `expandedMemberId`；`toggle`（:129-133）同样委托父级。父级切换展开目标时旧分组自动收起，天然保证至多一个展开（AC-5）。
  - `MemberGroup` 内部数据加载逻辑（懒加载 :68-106、状态就绪补跑 :109-116、失败重试、`loadedRef`/`inflightRef` 双守卫、R15-3 静默加载口径）全部保留；补跑仍传「不强制展开」语义（受控化后表现为不调用父级展开回调）。
  - reveal 监听（:119-127）本轮保留在 `MemberGroup` 内但改为调用父级统一入口（T4 再收口到父级并接 URL 同步，见 T4）；失败态再次定位即重试（idle/error 触发 load）语义不变。
- **测试用例（红）**：`tests/recordings-section.test.tsx`（改 + 增）
  1. 展开分组 A 后再展开分组 B → A 自动收起，全页同时只有一个 `aria-expanded="true"`（AC-5 核心，新增）。
  2. 收起分组后内容隐藏、数据保留，再展开不重新取数（R4 回归）。
  3. 状态就绪补跑不改变用户显式收起状态（R15-3 回归，受控化后断言父级回调未被调用）。
  4. 状态卡片 reveal 联动展开仍生效（次要6/9 回归，URL 断言在 T4 补）。
- 对应验收：AC-5。
- 预计：2h。

### T4 ✅ Query Param 同步 + 初始化直达（`/recordings?member={id}`）

- 产出：
  - `recordings-section.tsx`：父级 `RecordingsSection` 统一管理 URL 与展开状态：
    - **初始化**：`useSearchParams` 读取 `member` 参数 → 校验存在于 `members`（`Member["id"]`）→ 有效则置 `expandedMemberId` 并触发该分组加载与滚动定位（复用 reveal 路径的 `scrollIntoView` 能力判断，`live-status-grid.tsx:172-175` 同法）；无效参数忽略，按默认全收起渲染且不报错（AC-7）。
    - **变更**：展开时 `window.history.replaceState` 写入 `?member={id}`，收起时删除该参数（静态导出下不用 `router.replace`，避免 RSC 导航，技术方案 FR-3）；全程无页面刷新、无滚动位置丢失（AC-6）。
    - **统一入口**：`REVEAL_GROUP_EVENT`（`reveal-group.ts:9`）监听上移至父级，收到事件即置 `expandedMemberId` 并同步 URL——分组头点击、状态卡片定位、URL 直达三条路径共用同一状态出口。
  - **实施补充（2026-09-25）**：子级不再各自监听 `REVEAL_GROUP_EVENT`。父级监听时除统一出口外，另按成员递增 `revealSeq` 下发；子级据此认领事件并只负责「失败态再次定位即重试」（取数），避免把 `state.kind` 直接做进依赖导致「失败 → 重试 → 再失败」自循环。首取改为由 `expanded` 变化驱动（`expanded && state.kind === "idle"` → `load({expand:false})`），使分组头点击与 `?member=` 带参直达共用同一取数通道。
  - `src/features/recordings/recordings-view.tsx:27`：`RecordingsSection` 外包 `<Suspense>`（静态导出下 `useSearchParams` 必须位于 Suspense 边界内，否则构建期报错；fallback 取 `null`，分组点击前零请求不受 fallback 影响）。构建验证不通过时按技术方案 §5 退化为 `useEffect` 内读 `window.location.search` 并留痕。
- **测试用例（红）**：`tests/recordings-section.test.tsx`（增，沿用 replay 测试的 `vi.mock("next/navigation")` mock `useSearchParams` 模式）
  1. 展开分组 → `window.location.search` 含 `?member={id}`；收起 → 参数移除；多次切换只剩最后展开的成员（AC-6，jsdom 断言）。
  2. mock `useSearchParams` 返回有效 `?member=viridis` 初始渲染 → 该分组自动展开并恰好发出一次 recordings 请求、滚动定位被调用（AC-7）。
  3. 无效 `?member=nobody` → 全部收起、零新增请求、不报错（AC-7）。
  4. reveal 事件触发展开后 URL 同步写入（统一入口断言）。
  5. `tests/recordings-page.test.tsx` / `tests/recordings-view` 相关用例适配 Suspense 边界（渲染断言保持，必要时包 Suspense 或调整 mock）。
- 对应验收：AC-6、AC-7。
- 预计：2h。

### T5 ✅ 未开播录播入口 `src/components/recording-entry.tsx`（新增）+ `src/components/member-section.tsx`

- 产出：
  - 新增 `recording-entry.tsx`（Client 孤岛，与 `LiveBadge` 同构）：`useLiveStatus(member.id)` 复用模块级缓存（`live-status.ts:16-17`，同一成员页面生命周期只请求一次，不引入额外请求，PRD §5）。加载中渲染 `null`；开播渲染 `null`；未开播渲染站内链接「未开播，看录播 ->」，指向 `/recordings?member={member.id}`（用 `next/link`，站内跳转惯例同 `recordings-section.tsx:209`；`smooth-scroll.tsx:38` 的锚点拦截对非 `#` 链接自然放行）。
  - `member-section.tsx:39`：在 `LiveBadge` 下方挂载 `<RecordingEntry member={member} />`；样式沿用现有排版（复用 `styles.cta` 或新增最小 CSS Module 类，设计文档补齐前不新增视觉规格）。
  - 首页 HeroWall 不挂载该入口（PRD FR-4 仅覆盖详情区）。
  - **实施补充（2026-09-25）**：样式取「新增最小 CSS Module」方案（`recording-entry.module.css` 的 `.entry`：`align-self: flex-start` + `color: var(--member-accent)` + hover 下划线）——既有 `styles.cta` 为 `width:50%; margin-left:50%` 的大填充按钮，与 FR-4「一行文本链接」口径不符；未引入新的视觉规格，沿用成员代表色。零额外请求由 `tests/live-status-integration.test.tsx` 集成断言（8 徽章 + 4 入口仍为 4 次请求）。
- **测试用例（红）**：
  - 新增 `tests/recording-entry.test.tsx`（mock `useLiveStatus`）：
    1. mock 未开播 → 渲染「未开播，看录播 ->」且 `href === /recordings?member={id}`（AC-8）。
    2. mock 开播 / 加载中 → 不渲染任何内容（AC-8）。
    3. 不触发额外 `fetchLiveStatus` 请求之外的调用（与 LiveBadge 共用缓存，模块级 mock 下断言调用次数不增加）。
  - `tests/member-section.test.tsx`（改）：详情区挂载录播入口（mock 未开播时断言链接存在）。
- 对应验收：AC-8。
- 预计：1h。

### T6 ✅ 全量验收

- 门禁（沿用录播模块 R11-c② 口径，干净克隆先 build 再 test）：`pnpm build && pnpm test && pnpm lint && npx tsc --noEmit` 全绿。
- 确认静态导出产物包含 `/` 与 `/recordings` 路由；`pnpm build` 通过即同时验证 T4 的 Suspense 边界满足静态导出约束。
- 人工验收清单（依赖真实浏览器手感，留待人类执行）：
  1. AC-4：PC 端滚轮滑动触发吸附时为连续动画；移动端 CSS scroll-snap 平滑；对照 PRD 场景 B。
  2. AC-1 端到端：真实开播时段点击徽章直达直播间（可用 mock 时段验证降级链）。
  3. 场景 C 端到端：复制 `?member=` 链接新标签打开，自动展开对应分组。
  4. AC-8 端到端：首页详情区入口点击 → 录播页展开对应分组（FR-3 / FR-4 联动）。
- 回填本文档任务完成标记与验收记录。
- 对应验收：AC-9 及全部 AC 整体回归。
- 预计：1h。

## 2. 执行顺序与依赖

```
T0（roomId 数据）→ T1（徽章跳转）
T2（吸附动效）独立，可与 T0/T1 并行
T3（手风琴状态上移）→ T4（URL 同步 + Suspense）→ T5（录播入口，href 依赖 T4 的 query 约定）
全部 → T6（全量验收）
```

- T0 是 T1 的数据前提；T1 同时是 T5 的「同构孤岛 + 缓存复用」参考实现。
- T3 → T4 强依赖：URL 同步挂在受控的 `expandedMemberId` 单一状态上，必须先完成状态上移。
- T5 依赖 T4 的 `?member=` 约定（录播页侧消费逻辑就绪后入口才有意义），但组件本身可在 T4 进行中并行开发。
- T2 与录播链路完全独立。

## 3. 验收对照

| 验收标准 | 覆盖任务 | 验证方式 |
|----------|----------|----------|
| AC-1 徽章跳直播间 | T0、T1 | 单测（mock 开播断言 href / target）；人工验证真实开播跳转 |
| AC-2 roomId 缺失降级 | T1 | 单测（无 roomId 成员降级 `member.bilibili`） |
| AC-3 未开播/加载中不可点击 | T1 | 单测（回归既有行为） |
| AC-4 吸附连续动画 | T2、T6 | 单测（结构断言动画参数 + 无 reduced-motion 规则）；人工验证手感 |
| AC-5 单分组手风琴 | T3 | 单测（展开 B 收起 A、全页唯一 `aria-expanded="true"`） |
| AC-6 URL 参数写删 | T4 | 单测（jsdom 断言 `window.location.search`，无刷新） |
| AC-7 带参直达 / 无效忽略 | T4 | 单测（mock `useSearchParams`，自动展开 + 加载 / 无效忽略） |
| AC-8 未开播录播入口 | T5 | 单测（三态渲染与 href）；人工验证首页 → 录播页联动 |
| AC-9 全量回归 | 全部、T6 | `pnpm build && pnpm test && pnpm lint && npx tsc --noEmit`；新增/修改行为均有对应单测 |

## 4. 范围边界（沿用 PRD §6，实现期不得越界）

- 不修改直播状态接口与录播服务接口协议；`src/lib/live-status.ts` 不改。
- 不调整录播页分页、回放页、弹幕等既有功能。
- 不处理 sumire `liveStatusUrl` 疑似缺少成员段的数据问题（另立项跟进）。
- 不改动 Hero 立绘墙页内锚点跳转行为；不引入 `prefers-reduced-motion` 规则，也不做全局无障碍动效体系建设。
- 不新增任何运行时依赖。

## 5. 评审记录

| 评审人 | 日期 | 结论 | 备注 |
|--------|------|------|------|
| （待评审） | | | |

## 6. 实施与验收记录（2026-09-25）

- 实现分支：`feat/page-optimization-phase1-impl`（自需求总分支 `feat/page-optimization-phase1` 切出）。
- 任务进度：T0 ✅ / T1 ✅ / T2 ✅ / T3 ✅ / T4 ✅ / T5 ✅ / T6 ✅（T1~T5 均按红→绿循环执行，红测试先确认因预期原因失败）。
- 门禁结果（T6）：`pnpm build` ✅（静态导出含 `/`、`/recordings`、`/recordings/replay`）→ `pnpm test` ✅ 259 passed（27 files）→ `pnpm lint` ✅ → `npx tsc --noEmit` ✅。
- 验收对照：
  - AC-1 / AC-2 / AC-3 → T1 单测（`tests/live-badge.test.tsx`：直播间 href + target、无 roomId 降级、未开播/加载中无链接）。
  - AC-4 → T2 结构断言（Lenis/Snap 显式 `duration`+`easing`、`respectReducedMotion:false`）+ `src/` 无 `prefers-reduced-motion` 规则；**连续动画手感待人工验收**。
  - AC-5 → T3 单测（展开 B 收起 A、全页唯一 `aria-expanded="true"`）。
  - AC-6 / AC-7 → T4 单测（`window.location.search` 写删 + `pushState` 未调用、带参直达展开并恰好一次取数 + 滚动定位、无效参数忽略零请求）。
  - AC-8 → T5 单测（三态渲染与 href）+ 集成回归（4 入口共用 4 次请求）。
  - AC-9 → T6 门禁全绿。
- 已知留痕（供评审判断）：
  1. `useSearchParams` 按 Next 文档会使「最近 Suspense 边界内」的子树改为客户端渲染，故静态导出的 `out/recordings.html` 中不再包含「历史录播」标题与分组头，需水合后出现（`当前直播` 区块与页面头尾仍在静态 HTML 内）。此为计划 §T4 选定的 Suspense 方案的固有取舍；如评审要求保留该段静态 HTML，可按技术方案 §5 改用 `useEffect` 内读 `window.location.search`。
  2. T2 的 `respectReducedMotion: false` 为超出原产出清单的补充，依据 PRD FR-2「无视减少动效规定、呈现完整动效」，已补入 T2 产出说明。
- 待人工执行：T6 人工验收清单 4 项（AC-4 吸附手感、AC-1 真实开播跳转、场景 C `?member=` 分享直达、AC-8 首页→录播页联动）。
