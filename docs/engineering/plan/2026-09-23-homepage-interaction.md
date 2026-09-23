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
  - `fetchLiveStatus(memberId): Promise<LiveStatus>`：按环境拼接 base（`process.env.NODE_ENV === "development"` 走相对路径 `/api/live/...`，否则直连 `https://api.sumire.live`）；模块级 `Map<memberId, Promise<LiveStatus>>` 缓存，**失败结果也缓存**（避免重复打挂接口）；5s `AbortSignal.timeout`；防御性解析——按实测结构 `{"ok":true,"status":{"live":boolean,"title":string}}` 取 `status.live`/`status.title`，字段缺失/类型不符/网络错误/非 2xx 一律 resolve `{ living: false, title: null }`，绝不抛异常。
  - `useLiveStatus(memberId): { status: LiveStatus | null }`（`null` = 加载中）：Client Hook，mount 时调用 `fetchLiveStatus` 并 setState。
- TDD（mock 全局 `fetch`）：
  - 红/绿用例清单：
    1. 开播响应（`live:true` + title）→ resolve `{ living: true, title }`；
    2. 未开播响应（`live:false`）→ resolve `{ living: false, title: null }`；
    3. fetch reject / 非 2xx / 畸形 JSON / 字段缺失 → 均 resolve 未开播态且不抛出（AC-4）；
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
  - 开播：显示直播标题（CSS `text-overflow: ellipsis` 截断），整体渲染为 `<a href={member.liveUrl ?? member.bilibili} target="_blank" rel="noopener noreferrer">`（T1 未确认前默认 B 站主页）；
  - 未开播：纯文本「未开播」，**非链接**、不可点击。
  - 可访问性：徽章带可读文本与 `aria-label`（如「Viridis 正在直播：{title}」/「Viridis 未开播」），不依赖颜色传达状态。
- TDD（`vi.mock` `@/lib/live-status` 的 `useLiveStatus` 返回三种状态）：
  1. 加载中渲染占位、无链接；
  2. 开播渲染标题文本且为链接、`href` 为成员 B 站主页、新标签页（AC-2/AC-3）；
  3. 未开播渲染「未开播」且非链接（`queryByRole("link")` 为 null）；
  4. 标题过长时挂载截断 class（结构断言）。
- 依赖：T3。

### T5 HeroWall 锚点跳转改造 + 首屏徽章（src/components/hero-wall.tsx）

- 文件：`src/components/hero-wall.tsx`、`hero-wall.module.css`（徽章位置样式）、`tests/hero-wall.test.tsx`（改）
- 内容：
  - `<a>` 的 `href` 改为 `#member-{id}`，**移除** `target="_blank"` 与 `rel`；保留 Server Component（不引交互逻辑，锚点平滑滚动由 T6 全局监听处理）。
  - meta 区成员名字**上方**嵌入 `<LiveBadge member={member} />`。
- TDD（先改既有测试为红）：
  1. 四项 `href` 依次为 `#member-viridis/#member-komichi/#member-chu2u/#member-sumire`，且无 `target="_blank"`（替换原 B 站直链断言，AC-1）；
  2. 每个面板内渲染 LiveBadge（mock LiveBadge 为桩组件，断言每面板一个且位于名字之前——`compareDocumentPosition` 或 DOM 顺序断言，AC-2）；
  3. 既有立绘 alt、hover class、名称可读用例保持绿色。
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
  - PC（lenis 初始化处）：mount 后由 `document.querySelectorAll("[id^='member-']")` 计算各介绍区中心偏移量作为 snap 点（`lenis/snap`，`lockfile` 版本 1.3.26 已含）；`resize` 时重算；卸载时清理。
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
| AC-2 首屏徽章三态 | T4、T5 | live-badge 用例（mock 开播/未开播）+ hero-wall 桩断言 |
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
| T1 开发环境接口代理 | ☐ | |
| T2 成员数据扩展 | ☐ | |
| T3 直播状态拉取与缓存 | ☐ | |
| T4 LiveBadge 组件 | ☐ | |
| T5 HeroWall 锚点 + 徽章 | ☐ | |
| T6 lenis 锚点平滑滚动 | ☐ | |
| T7 MemberSection 锚点 + 徽章 | ☐ | |
| T8 逐屏吸附滚动 | ☐ | |
| T9 回归与整体验收 | ☐ | |
