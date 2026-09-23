# 287 粉丝站 · 首页交互优化 技术实现方案

- 版本：v1.0
- 创建日期：2026-09-23
- 状态：待开发
- 需求总分支：`feat/homepage-interaction`（本计划随该分支提交）

## 1. 对应上游文档

- 需求：[docs/product/requirement/2026-09-23-homepage-interaction.md](../../product/requirement/2026-09-23-homepage-interaction.md)
- 技术方案：[docs/engineering/proposal/2026-09-23-homepage-interaction.md](../proposal/2026-09-23-homepage-interaction.md)
- 设计文档：尚未产出（UI/UX 阶段未排入本期工作流）；徽章视觉与降级样式沿用一期 Mantine 主题 token 惯例，不新增视觉规范。

本文档只做任务拆解（怎么做、先做什么），技术选型与理由见技术方案。

## 2. 关键前置事实（已核实）

- lenis 锁版本 `1.3.26`（`pnpm-lock.yaml`），≥ 1.1，内置 `lenis/snap`；如开发时验证 API 不符预期，按技术方案 §5-1 回退 CSS scroll-snap。
- `next.config.ts` 当前仅 `output: "export"` + `images.unoptimized`；静态导出构建忽略 `rewrites`，代理仅对 `next dev` 生效，无线上风险。
- 现状代码：`hero-wall.tsx` 的 `<a>` 直链 B 站（`target="_blank"`）；`member-section.tsx` 的 `<section>` 无 `id`；`lib/lenis.ts` 的 `ScrollToTop.scrollTo` 仅接受 `number`；`smooth-scroll.tsx` 仅 PC 断点初始化 lenis。
- 既有测试 `tests/hero-wall.test.tsx` 断言 B 站直链与 `target="_blank"`——按技术方案风险 #6，属预期变更，先改测试（红）再改实现（绿）。

## 3. 任务拆解

### T1 开发环境接口代理（next.config.ts）

- 文件：`next.config.ts`
- 内容：增加开发态 `rewrites`，将 `/api/live/:path*` 转发到 `https://api.sumire.live/api/live/:path*`；确保 `output: "export"` 构建不受影响（rewrites 仅在 dev server 生效，构建期忽略）。
- 说明：静态导出项目无法用运行时验证 rewrites，此项为配置任务，验收走「人工启动 `next dev` 后浏览器请求 `/api/live/viridis/status` 返回 200」。
- 依赖：无。**最先做**，T3 的联调与人工验收依赖它。

### T2 成员数据扩展（src/data/members.ts）

- 文件：`src/data/members.ts`、`tests/members.test.ts`（既有，扩展）
- 内容：`Member` 接口增加 `liveStatusUrl: string`（仅路径部分：`/api/live/viridis/status`、`/api/live/komichi/status`、`/api/live/chu2u/status`、`/api/live/status`——注意 Sumire 无成员名后缀）；增加可选 `liveUrl?: string`（本期不填，T1 确认后用）。
- TDD：
  - 红：members 测试新增断言——四位成员均带正确 `liveStatusUrl` 路径（逐值断言，防手误）。
  - 绿：补字段。
  - 重构：无。
- 依赖：无，可与 T1 并行。

### T3 直播状态拉取与缓存（src/lib/live-status.ts）

- 文件：`src/lib/live-status.ts`（新增）、`tests/live-status.test.ts`（新增）
- 内容：
  - `export interface LiveStatus { living: boolean; title: string | null }`
  - `fetchLiveStatus(memberId): Promise<LiveStatus>`：按环境拼接 base（`process.env.NODE_ENV === "development"` 走相对路径 `/api/live/...`，否则直连 `https://api.sumire.live`）；模块级 `Map<memberId, Promise<LiveStatus>>` 缓存，**失败结果也缓存**（避免重复打挂接口）；5s `AbortSignal.timeout`；防御性解析——按实测结构 `{"ok":true,"status":{"live":boolean,"title":string}}` 取 `status.live`/`status.title`，字段缺失/类型不符/**取值无效（`title` 为空或纯空白）**/网络错误/非 2xx 一律 resolve `{ living: false, title: null }`，绝不抛异常。
  - `useLiveStatus(memberId): { status: LiveStatus | null }`（`null` = 加载中）：Client Hook，mount 时调用 `fetchLiveStatus` 并 setState。
- TDD（mock 全局 `fetch`）：
  - 红/绿用例清单：
    1. 开播响应（`live:true` + title）→ resolve `{ living: true, title }`；
    2. 未开播响应（`live:false`）→ resolve `{ living: false, title: null }`；
    3. fetch reject / 非 2xx / 畸形 JSON / 字段缺失 → 均 resolve 未开播态且不抛出（AC-4）；**`live:true` 但 `title` 为空/纯空白字符串同样降级未开播**（Review 返工 P2-1，避免渲染内容为空的开播链接）；
    4. 同 memberId 连续两次调用，`fetch` 只被调用一次，两个 Promise 同一结果（AC-5 单次请求）；
    5. 不同 memberId 各自独立请求；
    6. base 拼接：mock `NODE_ENV` 为 development 时请求相对路径，production 时请求 `https://api.sumire.live` 绝对地址；
    7. `useLiveStatus`：初始 `status` 为 `null`，resolve 后更新（`renderHook` + `waitFor`）。
  - 重构：抽取解析函数与 base 拼接函数，保持测试全绿。
- 依赖：T2（读取 `liveStatusUrl`）。

### T4 LiveBadge 组件（src/components/live-badge.tsx）

- 文件：`src/components/live-badge.tsx` + `live-badge.module.css`（新增）、`tests/live-badge.test.tsx`（新增）
- 内容：Client Component，props `{ member: Member }`，内部 `useLiveStatus`。三态渲染：
  - 加载中：占位骨架（固定高度，避免布局跳动）；
  - 开播：可见文本以「正在直播」开头、后接直播标题（CSS `text-overflow: ellipsis` 截断，「正在直播」前缀不被截掉），整体渲染为 `<a href={member.liveUrl ?? member.bilibili} target="_blank" rel="noopener noreferrer">`（T1 未确认前默认 B 站主页）；配色跟随成员代表色——开播态主色取容器内联的 `var(--member-accent)`，不得硬编码全站统一色（2026-09-23 下游验收返工）；
  - 未开播：纯文本「未开播」，**非链接**、不可点击。
  - 可访问性：徽章带可读文本与 `aria-label`（如「Viridis 正在直播：{title}」/「Viridis 未开播」），不依赖颜色传达状态。
- TDD（`vi.mock` `@/lib/live-status` 的 `useLiveStatus` 返回三种状态）：
  1. 加载中渲染占位、无链接；
  2. 开播渲染标题文本且为链接、`href` 为成员 B 站主页、新标签页（AC-2/AC-3）；
  3. 未开播渲染「未开播」且非链接（`queryByRole("link")` 为 null）；
  4. 标题过长时挂载截断 class（结构断言）；
  5.（2026-09-23 下游验收返工）开播态可见文本以「正在直播」开头且包含直播标题（前缀完整可见）；
  6.（2026-09-23 下游验收返工）开播态样式使用 `var(--member-accent)` 成员代表色（结构断言：`.living` 规则引用 `--member-accent`，不硬编码固定色板值）。
- 依赖：T3。

### T5 HeroWall 锚点跳转改造 + 首屏徽章（src/components/hero-wall.tsx）

- 文件：`src/components/hero-wall.tsx`、`hero-wall.module.css`（面板结构与徽章槽样式）、`tests/hero-wall.test.tsx`（改）
- 内容：
  - 每格改为 **`div.panel` 容器 + 覆盖式 `a.panelLink[href="#member-{id}"]`（absolute inset:0 铺满面板，内含立绘）**，**移除** `target="_blank"` 与 `rel`；meta 区（徽章 + 名字）为锚点的兄弟节点：`pointer-events: none` 让点击穿透到下方锚点，徽章槽 `pointer-events: auto` 保持徽章可点。保留 Server Component（不引交互逻辑，锚点平滑滚动由 T6 全局监听处理）。
  - **禁止 `<a>` 嵌套 `<a>`**：开播态 LiveBadge 自身是 `<a>`，不得放入面板锚点子树（HTML 内容模型 + React validateDOMNesting + SSR 解析器拆链，Review P1-1）。
  - meta 区成员名字**上方**嵌入 `<LiveBadge member={member} />`。
- TDD（先改既有测试为红）：
  1. 四项面板锚点 `href` 依次为 `#member-viridis/#member-komichi/#member-chu2u/#member-sumire`，且无 `target="_blank"`（AC-1）；
  2. **不 mock LiveBadge**（改 mock `@/lib/live-status` 返回开播态，用真实组件）：断言 `container.querySelector("a a")` 为 `null`（P1-1 回归用例），且每面板一个徽章、位于名字之前（DOM 顺序断言，AC-2）；
  3. 既有立绘 alt、hover class、名称可读用例改挂到 `div.panel` 后保持绿色。
- 依赖：T4。

### T6 lenis 锚点平滑滚动（src/lib/lenis.ts）

- 文件：`src/lib/lenis.ts`、`src/components/site-header.tsx`（如复用 scrollTo，检查兼容）、`tests/theme.test.ts` 不涉及；断言放 `tests/hero-wall.test.tsx` 或新增小段于 `tests/smooth-scroll.test.tsx`
- 内容：
  - `ScrollToTop.scrollTo` 签名扩展为 `(target: number | string) => void`（lenis 原生支持 `#hash` 目标；`site-header` 既有 `scrollTo(0)` 调用不受影响）；
  - 全局锚点拦截：在 `smooth-scroll.tsx`（或新增小组件）中监听 `document` 上 `a[href^="#"]` 的 click——lenis 存在时 `preventDefault()` 并 `lenis.scrollTo(hash)`，否则放行原生锚点跳转（无 JS/移动端降级）。
- TDD：
  1. 点击 `a[href="#member-viridis"]`，lenis 实例存在时调用 `scrollTo("#member-viridis")` 且阻止默认跳转；
  2. lenis 不存在（未初始化/移动端）时不拦截。
- 依赖：T5（锚点存在后才能联调）；与 T5 可并行开发。

### T7 MemberSection 锚点 id + 介绍区徽章（src/components/member-section.tsx）

- 文件：`src/components/member-section.tsx`、`member-section.module.css`、`tests/member-section.test.tsx`（扩展）
- 内容：`<section>` 增加 `id={`member-${member.id}`}`；内容区（`cta` 链接上方）嵌入 `<LiveBadge member={member} />`；「前往 B 站主页」入口保持不变。
- TDD：
  1. section 带 `id="member-{id}"`（AC-1 锚点目标存在）；
  2. 渲染 LiveBadge（桩组件断言，AC-5 同数据源——与 T5 共用同一 `useLiveStatus` 即天然一致，无需额外断言缓存共享）；
  3. 既有用例（B 站链接、奇偶背景、alt）保持绿色。
- 依赖：T4。

### T8 逐屏吸附滚动（src/components/smooth-scroll.tsx + CSS）

- 文件：`src/components/smooth-scroll.tsx`、`src/app/globals.css`（或对应样式文件，移动端 scroll-snap）、`tests/smooth-scroll.test.tsx`（扩展）
- 内容：
  - PC（lenis 初始化处）：mount 后由 `document.querySelectorAll("section[id^='member-']")` 计算各介绍区中心偏移量作为 snap 点（`lenis/snap`，`lockfile` 版本 1.3.26 已含）；选择器限定 `section` 元素，避免误命中介绍区标题 `id="member-{id}-heading"`（实现期细化，2026-09-23）；偏移量按技术方案 §3.3 用 **`getBoundingClientRect().top + window.scrollY`** 计算（**不用 `offsetTop`**：它相对 `offsetParent`，一旦出现定位祖先即算错，Review 返工 P2-2）；吸附类型取 `proximity`：仅在接近介绍区中心（默认阈值 50% 视口）时吸附，首屏小幅度滚动不会被强行拽走，同时满足 AC-6 越过半屏即落位；`resize` 时重算；卸载时清理。
  - 移动端（< 48em，不启用 lenis）：介绍区容器 CSS `scroll-snap-type: y proximity` + 各 section `scroll-snap-align: center`（proximity 保跟手性，对应 AC-7）。
  - 若开发时发现 lenis 1.3.26 snap API 与预期不符或联调抖动：回退为 PC 也用 CSS scroll-snap，lenis 仅保留阻尼（技术方案 §5-1 既定取舍），此变更需回本文件标记。
- TDD：
  1. PC 断点下 lenis 初始化参数/后续 snap 注册被调用（mock `lenis/snap` 模块，断言 `add` 次数 = 4 个介绍区）；
  2. 移动端断点不初始化 lenis、不注册 snap（既有用例保持）；
  3. 卸载时 snap 清理被调用。
  - 吸附手感（AC-6/AC-7）为**人工验收项**，单测只保证装配正确。
- 依赖：T7（介绍区 `id` 是 snap 点选择器依据）。

### T9 回归与整体验收

- 内容：`pnpm test`、`pnpm lint`、`pnpm build` 全绿（AC-8）；人工验收：真实接口开播/未开播切换、开发代理可用性（T1）、吸附手感、徽章视觉截断。
- 返工补充（2026-09-23 Review）：新增集成用例 `tests/live-status-integration.test.tsx`——HeroWall + 4×MemberSection 同页渲染 8 枚徽章只产生 4 次请求且同成员状态一致（AC-5 缓存共享回归，Review P2-3）。
- 依赖：全部任务完成。

## 4. 执行顺序与依赖图

```
T1 代理配置 ──────────────────────────────┐（人工联调用）
T2 members 数据 ──► T3 live-status ──► T4 LiveBadge ──► T5 HeroWall ──► T6 lenis 锚点滚动
                                                └────► T7 MemberSection ──► T8 snap 吸附
                                                                                │
                                                       全部完成 ──► T9 回归验收 ◄┘
```

- 可并行：T1 与 T2；T5/T6/T7 在 T4 完成后可并行。
- 关键路径：T2 → T3 → T4 → T7 → T8 → T9。

## 5. 验收对照

| 需求验收 | 覆盖任务 | 验证方式 |
|----------|----------|----------|
| AC-1 站内锚点跳转 | T5、T6、T7 | hero-wall 用例断言 `#member-{id}` 无 `_blank`；member-section 用例断言 `id`；T6 用例断言 lenis.scrollTo 拦截；T9 人工点验 |
| AC-2 首屏徽章三态（开播文案「正在直播」前缀 + 成员代表色配色） | T4、T5 | live-badge 用例（mock 开播/未开播，断言前缀文案与 `.living` 引用 `--member-accent`）+ hero-wall 桩断言 |
| AC-3 徽章点击跳转 | T4 | live-badge 用例：开播为链接（默认 B 站主页，待 T1 确认后改 `liveUrl`）、未开播非链接 |
| AC-4 失败降级 | T3 | live-status 用例：reject/非 2xx/畸形 JSON 均 resolve 未开播且不抛 |
| AC-5 一致性与单次请求 | T3、T5、T7 | live-status 用例：同 memberId 只 fetch 一次；两处共用 `useLiveStatus` 天然同源 |
| AC-6 PC 逐屏吸附 | T8 | smooth-scroll 用例（装配断言）+ 人工滚轮验收 |
| AC-7 移动端吸附不劫持 | T8 | CSS `proximity`（结构）+ 真机触屏验收 |
| AC-8 全绿回归 | T9 | `pnpm test` / `pnpm lint` / `pnpm build` |

## 6. 待确认项对开发的影响

| 项 | 影响 | 兜底 |
|----|------|------|
| 需求 T1（徽章跳转目标） | 仅影响 T4 中开播态 `href` 取值 | 默认 `member.bilibili`，确认后改读 `liveUrl`，仅一行 |
| 需求 T2（响应结构） | 已实测确认 `{ok, status:{live,title}}`，解析按此实现并保留防御性兜底 | 偏差时只改 T3 解析层一处 |
| 需求 T3（是否轮询） | 本期按「加载时拉取一次」实现 | 确认需轮询时在 T3 的 Hook 内加 `setInterval`（≥60s），单点改动 |

## 7. 进度记录

| 任务 | 状态 | 备注 |
|------|------|------|
| T1 开发环境接口代理 | ☑ | `next.config.ts` 增加按 `NODE_ENV` 判定的 rewrites；`next dev` 实测 `/api/live/viridis/status` 返回 200；构建期返回空数组，`next build` 仅打印 export 不支持 rewrites 的提示，产物不受影响 |
| T2 成员数据扩展 | ☑ | 四成员逐值断言 `liveStatusUrl`；`liveUrl` 留待需求 T1 确认后再填 |
| T3 直播状态拉取与缓存 | ☑ | 7 条用例全绿；实测响应 `{ok,status:{live,title}}` 与解析一致 |
| T4 LiveBadge 组件 | ☑ | 三态渲染 + 标题截断阈值 16 字，5 条用例全绿 |
| T5 HeroWall 锚点 + 徽章 | ☑ | 既有 B 站直链断言按风险 #6 预期改写（红→绿） |
| T6 lenis 锚点平滑滚动 | ☑ | 拦截收敛在 SmoothScroll 的 document 点击监听；`event.defaultPrevented` 与「最近祖先链接非 #」两种情况均放行 |
| T7 MemberSection 锚点 + 徽章 | ☑ | `id="member-{id}"` + 徽章位于 cta 上方 |
| T8 逐屏吸附滚动 | ☑ | 选择器细化为 `section[id^='member-']`（见 T8 条目说明）；移动端 CSS proximity + section center 结构断言全绿 |
| T9 回归与整体验收 | ☑ | `pnpm test`（初版 54 用例，返工后 **56 用例**）、`pnpm lint`、`pnpm build` 全绿；开发代理与 SSR 结构（锚点/section id/徽章骨架/无嵌套链接）已点验。**人工验收待人类执行**：真实接口开播态视觉、PC 吸附手感、移动端真机触屏手感 |

### 返工记录（2026-09-23，Review 打回 P1-1 / P2 系列）

| 问题 | 处置 | 用例 |
|------|------|------|
| P1-1 面板 `<a>` 内嵌开播态徽章 `<a>`（无效嵌套） | 采用建议 b+c：面板改 `div.panel` + 覆盖式 `a.panelLink`，徽章槽移到锚点子树之外；点击分层用 `pointer-events` 实现 | T5 用例改为**不 mock LiveBadge**，断言 `querySelector("a a")` 为 `null` |
| P2-1 `parseStatus` 空标题判为开播 | 空/纯空白 `title` 降级未开播（与方案「取值无效即降级」一致） | live-status 新增空标题用例 |
| P2-2 `sectionCenter` 用 `offsetTop` 偏离方案 | 改为 `getBoundingClientRect().top + window.scrollY` | smooth-scroll 用例改 stub rect，吸附点断言回归 |
| P2-3 缺少缓存共享集成用例 | 新增 `tests/live-status-integration.test.tsx` | 8 徽章 / 4 请求 / 状态一致 |

### 返工记录（第二轮，2026-09-23，Review R1）

| 问题 | 处置 | 用例 |
|------|------|------|
| R1 面板结构改造后 `a.panelLink` 设 `z-index: 1`，`span.bar` 仍为 `z-index: auto` 被压到立绘图层之下（代表色指示条被遮挡，一期视觉回归） | 沿用一期「指示条恒在最上层」的视觉约定：`.bar` 提升 `z-index: 3`（高于 panelLink=1、meta=2；bar 位于面板底部 4px，与 meta 不重叠） | `hero-wall.test.tsx` 新增 CSS 结构断言：读取 `hero-wall.module.css`，`.bar` 规则须声明 `z-index` 且数值高于 `.panelLink`（先红后绿） |

### 返工记录（第三轮，2026-09-23，Review R2）

| 问题 | 处置 | 用例 |
|------|------|------|
| R2/R1 修复副作用：`.bar` 提升 `z-index: 3` 后位于覆盖式锚点之上且未设 `pointer-events`，成为命中测试拦截层——面板底部 4px 条带点击既不激活锚点也无任何处理（点击死区），违反技术方案 §4.3「点面板任意处进介绍区」 | 采用建议 a：`.bar` 为纯装饰元素，增加 `pointer-events: none`，点击穿透到 `a.panelLink`；hover 灰化经 `.panel`/`.wall` 的 `:hover` 链不受影响（命中目标下移仍在面板内） | 扩展 `hero-wall.test.tsx` 既有「层叠结构」用例：`.bar` 规则须含 `pointer-events: none`（先红后绿） |

### 返工记录（第四轮，2026-09-23，Review R3）

| 问题 | 处置 | 用例 |
|------|------|------|
| R3 徽章槽 `pointer-events: auto` 作用于槽内**全部状态**：未开播 `span.offline` 与加载骨架 `span.skeleton` 非链接，点击命中后被吞掉（`closest("a")` 为 null 放行、span 无默认行为），徽章盒成为面板内点击死区；未开播是常态，影响大于 R2 的 4px 条带。与 R2 同源（pointer-events 分层边界遗漏），违反技术方案 §4.3 | 采用建议 a 的语义化写法：`live-badge.module.css` 基础规则 `.badge` 设 `pointer-events: none`，仅交互态 `.living` 恢复 `pointer-events: auto`——「仅交互态接管点击」；开播徽章在 `.badgeSlot` 的 auto 之下依旧可点（AC-3 不变），非交互态穿透到下方 `a.panelLink`（首屏）/ section 背景（介绍区，无行为差异）。不与方案 b 叠加 | `live-badge.test.tsx` 新增 CSS 结构断言：`.badge` 须含 `pointer-events: none`、`.living` 须含 `pointer-events: auto`、`.skeleton`/`.offline` 不得回设 auto（先红后绿） |

### 返工记录（第五轮，2026-09-23，Review R4）

> **Review 更正**：第四轮「方案 a 与 b 效果等价」的判断**有误**——`pointer-events: none` 只让徽章**自身**退出命中测试，事件会落到该点位 paint 序更上层且可命中的盒子；本轮以无头 Chromium `document.elementFromPoint`（浏览器为点击事件选定目标的判定原语）实证：`.badgeSlot`（`pointer-events: auto`，位于 meta 的 z2 子树、整矩形覆盖徽章）恰好吞掉点击，故 a 单独使用无效。**只有让「徽章 → 锚点」整条命中链上除开播链接外全部 `none` 才成立。**

| 问题 | 处置 | 用例 |
|------|------|------|
| R4（R3 修复无效）：拦截者从徽章 span 转移到包装 span `.badgeSlot`——`.badge(none)` 后点击命中 paint 序更上层的 `.badgeSlot(auto)`，`closest("a")` 仍为 null，徽章盒 ≈56×25px 死区依旧存在（真实构建 + A/B 复现页双组实证） | 采用指定最小修复：`hero-wall.module.css` 的 `.badgeSlot` 改 `pointer-events: none`（保留 `align-self: flex-start`）。开播徽章可点性由 `live-badge.module.css` 的 `.living{auto}` 显式保证（**祖先 `none` 不阻止子树显式 `auto` 成为命中目标**，B 组已实证），AC-3 与 T5「可交互徽章可点」意图不受影响；改后命中链 `.badge(none)/.badgeSlot(none)/.meta(none)` → 穿透到 `a.panelLink`（或其立绘子元素）。**`.badge`/`.living` 声明保留不动**（语义正确且必要），未叠加其他文件改动 | 扩展 `hero-wall.test.tsx`「层叠结构」用例：`.badgeSlot` 规则须含 `pointer-events: none` 且不得含 `pointer-events: auto`（既有 `.bar` 与 live-badge 四条断言保留） |

**结构断言的诚实边界与一次性实证记录（已执行留档）**：`readFileSync` + 正则断言只约束声明、不验证命中路由（jsdom 不做命中测试）。真实路由以 `elementFromPoint` 人工验证，方法：无头 Chromium（Playwright 1.63 + chromium-1234）静态服务本仓库 `out/` 构建产物（viewport 1280×800，≥48em PC 断点），对徽章盒中心坐标取 `document.elementFromPoint(x, y)`，并配合真实 `page.mouse.click` 探针（document 冒泡监听，hydration 后注册以观察 smooth-scroll 的 `preventDefault`）。**2026-09-23 实测结果（13/13 通过）**：

| 场景 | 取样点 | 命中目标 | 结论 |
|------|--------|----------|------|
| 状态 A 未开播（route abort 降级） | 徽章盒中心（56×18px，badge/slot/meta 的 computed `pointer-events` 均为 `none`） | `IMG.hero-wall-module__art`，`closest("a")` = `#member-viridis` | ✅ 死区消除，命中面板锚点子树 |
| 状态 A + 真实鼠标点击同点位 | — | 探针：`anchor=#member-viridis`、`defaultPrevented=true`、点击后 `scrollY 0→794` 且 `location.hash=""` | ✅ 被 lenis 拦截并实际滚动到介绍区（非死区、非原生 hash 跳转） |
| 状态 A | `.bar` 条带中心 / 成员名字中心 | 均 `closest("a")` = `#member-viridis` | ✅ R1/R2 复验通过 |
| 状态 B 开播（route fulfill `live:true`） | 徽章盒中心（badge computed `pointer-events=auto`，slot=`none`） | `A.live-badge-module__…__living` 自身，`href=https://space.bilibili.com/1891335475` | ✅ AC-3 徽章链接仍为命中目标（祖先 `none` 不阻止子孙显式 `auto`） |

复跑方法：`python3 -m http.server 8123 --directory out` + `/tmp/opencode/verify-hit.cjs`（Playwright 脚本，含状态 A/B 双路由与点击探针）。
