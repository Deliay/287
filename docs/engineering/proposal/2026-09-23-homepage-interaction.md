# 287 粉丝站 · 首页交互优化 技术方案

- 版本：v1.0
- 创建日期：2026-09-23
- 状态：待评审

## 1. 对应上游文档

- 需求：[docs/product/requirement/2026-09-23-homepage-interaction.md](../../product/requirement/2026-09-23-homepage-interaction.md)
- 设计：`docs/product/design/2026-09-23-homepage-interaction.md`（UI/UX 阶段产出后补充链接；本方案依据需求文档先行评审，徽章视觉与降级样式以设计文档为准）

## 2. 技术选型

本期**不引入新的运行时依赖**，全部基于第一期已落地的技术栈（Next.js 16 静态导出 + React 19 + Mantine 9 + lenis）实现：

| 能力 | 方案 | 理由 |
|------|------|------|
| 直播状态拉取 | 浏览器原生 `fetch`（Client Component） | 站点为纯静态导出（`next.config.ts` 中 `output: "export"`），无服务端运行时，状态必须在客户端请求；原生 fetch 足够，无需 SWR/React Query（需求默认仅加载时拉取一次，见需求 §7-T3） |
| 状态共享（首屏与介绍区一致） | 模块级状态缓存 + 自定义 Hook（`useLiveStatus`） | 同一成员的接口在页面生命周期内只请求一次，HeroWall 与 MemberSection 复用同一份 Promise/结果（AC-5）；React Context 对纯读取场景过重，模块缓存最简单 |
| 站内锚点跳转 | `id` 锚点 + `lenis.scrollTo` | 一期已存在 `src/lib/lenis.ts` 的实例注册机制，直接扩展复用；保留无 JS/降级时的原生锚点行为 |
| 逐屏吸附滚动 | lenis `snap` 能力（lenis ≥ 1.1 内置）或 CSS `scroll-snap` 兜底 | 与既有阻尼滚动同源实现，避免两套滚动逻辑打架；详见 §5-1 的权衡 |
| 开发环境跨域 | `next dev` 本地代理（`next.config.ts` 中仅开发态生效的 `rewrites`） | 线上域名 287.live 已加入 `api.sumire.live` 的 CORS 白名单，线上直连无问题；仅本地开发（`localhost`）存在跨域，用 dev server 代理将 `/api/live/*` 转发到接口域名即可，无需引入代理工具或改接口方 |

**新依赖必要性说明**：无新增依赖。若现有 lenis 版本不支持 snap（需核实 `pnpm-lock.yaml`），首选升级 lenis 补丁/次版本，其次降级为 CSS scroll-snap 方案。

## 3. 架构设计

### 3.1 模块划分（在现有结构上的增量）

```
next.config.ts                  # 增加仅开发态生效的 rewrites：/api/live/* 代理到 api.sumire.live
src/
├── app/
│   └── page.tsx                # 不变：HeroWall + 4×MemberSection 的组装结构保留
├── data/
│   └── members.ts              # Member 增加 liveStatusUrl（接口路径）、liveUrl（待 T1 确认）字段
├── lib/
│   ├── lenis.ts                # 扩展 ScrollToTop 接口：scrollTo 支持 string target（锚点）
│   └── live-status.ts          # 新增：状态拉取与模块级缓存（每成员一次请求；按环境拼接接口 base）
├── components/
│   ├── hero-wall.tsx           # 保持 Server Component：面板改为 div + 覆盖式站内锚点 <a>（stretched link），
│   │                           # 徽章渲染在锚点子树之外，避免 <a> 嵌套 <a>（2026-09-23 Review 返工修订）
│   ├── member-section.tsx      # 增加 <LiveBadge>；section 增加 id 锚点
│   ├── live-badge.tsx          # 新增：直播状态徽章（Client Component）
│   ├── live-badge.module.css   # 新增
│   ├── smooth-scroll.tsx       # lenis 增加 snap 配置（介绍区逐屏吸附）
│   └── ...
tests/
├── live-status.test.ts         # 新增：拉取/缓存/降级/环境 base 拼接逻辑
├── live-badge.test.tsx         # 新增：开播/未开播/失败三态渲染
└── （hero-wall / member-section / smooth-scroll 既有用例同步更新）
```

### 3.2 数据流

```
page.tsx (Server)
 ├── HeroWall (Client) ─────────────┐
 │    └── LiveBadge(memberId) ──────┤
 └── MemberSection ×4 (Client*) ────┤  * 因嵌入 LiveBadge 需转为 Client，或保持
        └── LiveBadge(memberId) ────┘    Server 而仅 LiveBadge 为 Client（首选后者）
                     │
        useLiveStatus(memberId)
                     │
        lib/live-status.ts ── fetch(members[i].liveStatusUrl)
                     │
        模块级 Map<memberId, Promise<LiveStatus>>：同成员只请求一次，
        首屏与介绍区共享结果，天然满足 AC-5 一致性
```

- `Member` 数据增加 `liveStatusUrl`（需求 §7 四个接口地址，注意 Sumire 的地址无成员名后缀）。
- 锚点：每个 `MemberSection` 的 `<section>` 增加 `id={`member-${member.id}`}`；HeroWall 每格改为「`div.panel` 容器 + 覆盖式 `a.panelLink[href='#member-{id}']`（absolute inset:0 铺满面板，含立绘）+ meta 区（徽章 + 名字，`pointer-events: none`，徽章槽 `pointer-events: auto`）」——**面板不再整体是 `<a>`，徽章与锚点是兄弟节点**，从结构上杜绝 `<a>` 嵌套 `<a>`（HTML 内容模型禁止，SSR/静态导出下解析器会拆链、React 报 validateDOMNesting）。点击时若 lenis 存在则 `lenis.scrollTo(hash)` 平滑滚动，否则走原生锚点跳转。

### 3.3 关键实现思路

**直播状态拉取（`src/lib/live-status.ts`）**：

```ts
export interface LiveStatus {
  living: boolean;
  /** 开播时的直播标题；未开播或解析失败时为 null */
  title: string | null;
}

// 模块级缓存：同一成员只发一次请求，失败结果也缓存（避免重复打挂）
const cache = new Map<string, Promise<LiveStatus>>();

export function fetchLiveStatus(memberId: Member["id"]): Promise<LiveStatus>;
```

- **防御性解析**（应对需求 §7-T2 响应结构未确认）：响应 JSON 的字段名按约定推断（如 `living`/`live_status`、`title`），任何字段缺失、类型不符或**取值无效（`title` 为空/纯空白字符串）**都降级为 `{ living: false, title: null }`，绝不抛异常到组件层——避免渲染出内容为空、无点击目标的开播链接（2026-09-23 Review 返工 P2-1）。
- 请求失败（网络错误、非 2xx、超时 ~5s `AbortSignal.timeout`）同样降级为未开播态。
- **请求地址分环境**：`members.ts` 中 `liveStatusUrl` 记录接口的**路径部分**（如 `/api/live/viridis/status`）；`live-status.ts` 拼接 base——生产环境直连 `https://api.sumire.live`（287.live 已在 CORS 白名单），开发环境走相对路径，由 `next dev` 的本地代理转发（`next.config.ts` 中开发态 `rewrites`：`/api/live/:path*` → `https://api.sumire.live/api/live/:path*`），本地开发无跨域问题。

**LiveBadge 组件**：三态渲染——加载中（骨架/占位，避免布局跳动）、开播（直播标题，截断溢出）、未开播（「未开播」）。点击行为：开播时跳转直播入口（T1 未确认前默认 `member.bilibili` 主页，新标签页）；未开播时不可点击（渲染为非链接元素）。

**逐屏吸附滚动**：`smooth-scroll.tsx` 中 lenis 初始化时配置 snap 点（各介绍区中心偏移量，mount 后由 DOM `getBoundingClientRect` 计算并在 resize 时重算）。移动端（< 48em）一期本就不启用 lenis，吸附改用 CSS `scroll-snap-type: y proximity`（proximity 而非 mandatory，避免触屏滚动被强制劫持，对应 AC-7）。**仅当 lenis snap 不可用时**，PC 端也降级为 CSS scroll-snap。

## 4. 接口设计

### 4.1 成员数据扩展（`src/data/members.ts`）

```ts
export interface Member {
  // ...既有字段不变
  /** 直播状态接口路径（需求 §7），如 /api/live/viridis/status；base 由 live-status.ts 按环境拼接（生产直连 api.sumire.live，开发走本地代理） */
  liveStatusUrl: string;
  /** 直播入口链接（开播时点击徽章跳转目标，待需求 T1 确认；默认同 bilibili） */
  liveUrl?: string;
}
```

### 4.2 直播状态（`src/lib/live-status.ts`）

见 §3.3。对外仅暴露 `fetchLiveStatus(memberId): Promise<LiveStatus>` 与 `useLiveStatus(memberId): { status: LiveStatus | null }`（`null` 表示加载中）。

### 4.3 组件契约变更

- `<HeroWall members={members} />`：每格改为 `div.panel` + 覆盖式 `a.panelLink[href="#member-{id}"]`（**移除** `target="_blank"`/`rel`）；meta 区（徽章 + 名字）位于锚点之外并以 `pointer-events` 分层保证「点面板任意处进介绍区、点徽章走直播入口」；徽章为 Client 孤岛，开播态外链与面板锚点是兄弟节点，不产生嵌套链接。
- `<MemberSection member index />`：`<section>` 增加 `id={`member-${member.id}`}`；内容区（cta 上方）新增 `<LiveBadge>`。
- `<LiveBadge member={member} />`（新增）：渲染直播状态徽章，交互见 §3.3；开播态为 `<a>`，因此**禁止嵌入任何已是链接的子树**（使用方须保证，见风险 #7）。
- `<SmoothScroll />`：增加 snap 点计算逻辑，对外契约不变。

### 4.4 lenis 实例接口扩展（`src/lib/lenis.ts`）

`ScrollToTop.scrollTo(target: number)` 扩展为 `scrollTo(target: number | string)`，与 lenis 原生签名对齐（lenis 支持 CSS 选择器/`#hash` 目标），HeroWall 点击与导航回顶共用同一实例。

## 5. 风险与权衡

| # | 风险 | 影响 | 缓解 / 取舍 |
|---|------|------|-------------|
| 1 | lenis 拦截滚动与 snap 吸附叠加，可能出现吸附抖动或锚点跳转被劫持 | FR-4 体验受损 | snap 点计算收敛在 SmoothScroll 一处；锚点跳转统一走 lenis 实例；若联调不达标，回退 CSS `scroll-snap`（proximity），lenis 仅保留阻尼 |
| 2 | ~~`api.sumire.live` 未开 CORS~~ **已消除**（评审确认）：线上域名 287.live 已加入接口 CORS 白名单；仅本地开发（`localhost`）跨域 | 开发环境联调受阻 | 开发环境经 `next dev` 本地代理转发 `/api/live/*`（见 §2/§3.3）；线上直连；防御性降级兜底保留（AC-4） |
| 3 | 接口响应结构未确认（T2） | 解析错误导致状态恒为未开播 | 防御性解析 + 单测覆盖多种假设结构；联调阶段以真实响应校准，偏差时仅需改解析层一处 |
| 4 | HeroWall 从 Server 转 Client（因 LiveBadge 交互） | 首屏 JS 体积微增 | 优先方案：HeroWall 保持 Server，仅 LiveBadge 为 Client 孤岛嵌入；点击锚点跳转用原生 `href="#..."` + lenis 全局监听 hash 点击，无需 HeroWall 客户端化 |
| 5 | 滚动吸附与移动端触屏惯性冲突 | AC-7 不达标 | 移动端仅用 CSS `proximity` 吸附，不启用 lenis；真机验收 |
| 6 | 既有测试断言 B 站直链跳转 | 改动后既有用例失败 | 属预期变更：按 TDD 先改测试（红）再改实现（绿），AC-1 新断言替代旧断言 |
| 7 | ~~LiveBadge 嵌入面板 `<a>` 产生 `<a>` 内嵌 `<a>`~~ **已在实现期返工消除**（2026-09-23 Review P1-1） | 非法 HTML、React validateDOMNesting 报错、SSR 解析器拆链破坏首屏结构、AC-3 行为未定义 | 面板改 div + 覆盖式锚点，徽章移到锚点子树之外（兄弟节点）；hero-wall 用例**不 mock LiveBadge**，直接断言 `container.querySelector("a a")` 为空，堵住桩组件造成的测试盲区 |

## 6. 测试策略

遵循根目录 `AGENTS.md` 红-绿-重构 TDD 流程，沿用 Vitest + RTL + jest-dom 基建与 `renderWithTheme()` 封装。

| 验收标准 | 测试方式 |
|----------|----------|
| AC-1（站内锚点跳转） | hero-wall 单测：四项 `href` 为 `#member-{id}` 且无 `target="_blank"`；**不 mock LiveBadge**，断言面板内无嵌套链接（`querySelector("a a")` 为空，防 P1-1 回归）；member-section 单测：section 带对应 `id` |
| AC-2（首屏状态徽章） | live-badge 单测：mock `fetchLiveStatus` 返回开播（断言显示标题）/未开播（断言「未开播」）/加载中三态 |
| AC-3（徽章点击） | live-badge 单测：开播态渲染为链接且 `href` 符合 T1 结论（确认前断言默认 B 站主页）；未开播态非链接 |
| AC-4（失败降级） | live-status 单测：fetch reject / 非 2xx / 畸形 JSON 均 resolve 为未开播态且不抛出 |
| AC-5（一致性与单次请求） | live-status 单测：同 memberId 两次调用 fetch 只触发一次（mock fetch 计数）；**集成用例**：HeroWall + 4×MemberSection 同页渲染时 8 枚徽章只产生 4 次请求且状态一致 |
| AC-6/AC-7（吸附滚动） | smooth-scroll 单测：lenis 初始化参数包含 snap 配置（mock lenis 构造函数断言）；吸附手感与各断点实际效果**人工验收** |
| AC-8（回归） | `pnpm test` / `pnpm lint` / `pnpm build` 全绿；既有导航、调色盘、介绍区内容用例不受影响 |

**人工验收项**：吸附滚动手感（PC 滚轮 / 移动端触屏）、徽章视觉与截断溢出、真实接口联调（开播/未开播实际切换）、开发环境本地代理可用性验证。

## 7. 评审记录

| 评审人 | 日期 | 结论 | 备注 |
|--------|------|------|------|
| （待评审） | | | |
