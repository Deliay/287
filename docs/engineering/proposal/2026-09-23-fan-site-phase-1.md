# 287 粉丝站 · 第一期（首页与成员展示）技术方案

- 版本：v1.0
- 创建日期：2026-09-23
- 状态：已通过评审

## 1. 对应上游文档

- 需求：[docs/product/requirement/2026-09-23-fan-site-phase-1.md](../../product/requirement/2026-09-23-fan-site-phase-1.md)
- 设计：[docs/product/design/2026-09-23-fan-site-phase-1.md](../../product/design/2026-09-23-fan-site-phase-1.md)

## 2. 技术选型

| 技术 | 版本 | 用途 | 选型理由 |
|------|------|------|----------|
| Next.js（App Router）+ React + TypeScript | 16 / 19 / 5 | 应用框架 | 已在脚手架落地（PR #1），SSR/SSG、`next/image` 图片优化开箱即用 |
| Mantine | 9 | 组件库 / 主题 token | 需求评审选定；`theme.colors` 自定义色阶直接承载 5 套调色盘；Burger/Drawer 等导航组件现成 |
| lenis | ^1 | 阻尼滚动（FR-4） | 原生 `scroll-behavior: smooth` 只有线性平滑、没有惯性阻尼；lenis 体积小（~5KB）、`autoRaf` 接入简单、可在客户端按需初始化，SSR 无侵入。备选：GSAP ScrollSmoother（付费插件，排除）、framer-motion（为单一滚动需求引入过重，排除）、自实现 lerp 滚动（重复造轮子，排除） |
| Vitest + React Testing Library + jsdom | 最新稳定 | 单元测试（TDD） | 根目录 `AGENTS.md` 要求 TDD，项目尚无测试基建。Vitest 启动快、与 Vite 生态一致的 ESM 支持，配置成本低于 Jest；RTL 负责组件渲染断言；`vite-tsconfig-paths` 解析 `@/*` 别名 |
| @testing-library/user-event + jest-dom | 最新稳定 | 交互测试 / 断言扩展 | 导航栏 Drawer 开合等交互断言需要 |

**新依赖必要性说明**：`lenis` 是阻尼滚动的唯一新增运行时依赖；其余均为测试开发依赖。无其他新增。

## 3. 架构设计

### 3.1 模块划分

```
src/
├── app/
│   ├── layout.tsx              # 已有；改为注入自定义 theme 的 MantineProvider，html 加 id="top"
│   ├── page.tsx                # 首页组装（Server Component）：HeroWall + 4×MemberSection
│   └── globals.css             # 已有；补充全局背景色等少量样式
├── theme.ts                    # Mantine 主题：night287 / viridis / komichi / chu2u / sumire 五套 10 级色阶
├── data/
│   └── members.ts              # 成员单一数据源（顺序、文案、代表色键、立绘路径、B 站链接）
├── components/
│   ├── site-header.tsx         # 导航栏（Client Component：Burger + Drawer）
│   ├── site-header.module.css
│   ├── hero-wall.tsx           # 首屏立绘墙（Server Component，hover 灰化纯 CSS）
│   ├── hero-wall.module.css
│   ├── member-section.tsx      # 单个成员介绍区（Server Component）
│   ├── member-section.module.css
│   └── smooth-scroll.tsx       # lenis 初始化封装（Client Component，"use client"）
├── lib/
│   └── lenis.ts                # lenis 实例持有（getLenis/setLenis），SmoothScroll 注册、SiteHeader 回顶复用（风险 §5-1）
public/
└── images/members/             # 从 resources/ 复制的 4 张 avif 立绘（viridis/komichi/chu2u/sumire）
tests/（或 src 内就近 *.test.tsx） # Vitest 单测
```

### 3.2 数据流

- `src/data/members.ts` 导出 `members: Member[]`，**数组顺序即展示顺序**（绿黑白紫：viridis → komichi → chu2u → sumire），首屏立绘墙与介绍区都从该数组渲染，天然保证两处顺序一致（AC-3/4/5）。
- 无全局状态、无服务端数据；导航 Drawer 开合用 Mantine `useDisclosure` 局部状态。
- 主题通过 `src/theme.ts` 的 `createTheme` 注入 `MantineProvider`，全部颜色引用 token（`var(--mantine-color-*)`），CSS Module 中不出现硬编码 hex（AC-1）。

### 3.3 关键实现思路

**响应式**：PC/移动端布局差异全部用 CSS Module + `postcss-preset-mantine` 的断点变量（`@media (min-width: $mantine-breakpoint-sm)`）实现，**不用** JS 媒体查询切换渲染结构——保证 SSR 输出一致，无 hydration 闪烁。首屏立绘墙：PC 为 `flex-direction: row`（每列 25% 宽、100dvh），移动端为 `column`（每行 25dvh），同一 DOM 两种排版。

**Hover 灰化（纯 CSS，无 JS）**：

```css
/* hero-wall.module.css 思路 */
.wall:hover .panel { filter: grayscale(1) brightness(0.6); }
.wall .panel:hover { filter: none; transform: scale(1.03); }
.panel { transition: filter 300ms ease-out, transform 300ms ease-out; }
```

**阻尼滚动**：`smooth-scroll.tsx` 为 Client Component，`useEffect` 内 `new Lenis({ autoRaf: true })`，卸载时 `destroy()`。**仅在 PC 启用**（`window.matchMedia('(min-width: 48em)')` 判断，移动端保留原生触屏惯性滚动，避免滚动劫持问题；需求中阻尼感针对 PC 滚轮场景）。降级：lenis 初始化失败或被移除时，页面滚动行为退化为原生，不影响任何内容可达性。

**立绘展示**：`next/image` + `fill` + `object-fit: cover`（fill 不会自动设 cover，需显式声明）+ `object-position` 裁切上半身；首屏 4 张设 `priority`；`Member` 数据预留 `imagePosition` 字段用于按成员微调构图（见风险 §5-2）。全身图在 cover 基础上以顶部锚点缩放（CSS transform）收紧到「上半身（首屏）/半身（介绍区）」，缩放系数按断点区分。介绍区半身像同理，移动端经同一 CSS 变量调整。

**图片资源**：`resources/*.avif` 是资料源文件，不入 `public` 无法被 Next 直接服务；复制（非移动）到 `public/images/members/`，`resources/` 保持资料归档语义不变。

## 4. 接口设计

### 4.1 成员数据（`src/data/members.ts`）

```ts
export interface Member {
  id: "viridis" | "komichi" | "chu2u" | "sumire";
  /** 中文名，如「小松绿」 */
  name: string;
  /** 罗马音名，如「Viridis」 */
  romanName: string;
  /** 身份/称号，如「想成为大家互联网盆栽的园艺师」 */
  title: string;
  /** 介绍区简介摘要（设计文档 §2.5 文案） */
  description: string;
  /** 成员调色盘在 theme.colors 中的键 */
  colorKey: "viridis" | "komichi" | "chu2u" | "sumire";
  /** 立绘路径，如 /images/members/viridis.avif */
  image: string;
  /** next/image object-position，默认 "top"，可按成员微调 */
  imagePosition?: string;
  /** B 站主页 UID 直链 */
  bilibili: string;
}

export const members: Member[]; // 顺序固定：viridis, komichi, chu2u, sumire（绿黑白紫）
```

### 4.2 主题（`src/theme.ts`）

`createTheme({ colors: { night287, viridis, komichi, chu2u, sumire } })`，每套为 Mantine 10 级色阶 tuple，色值与设计文档 §1 完全一致；`primaryColor` 不使用成员色，全局组件默认中性。

### 4.3 组件契约

- `<SiteHeader />`：无 props；渲染站点名与「首页」链接（`href="/"` 或锚点 `#top`），移动端 Burger 控制 Drawer。
- `<HeroWall members={members} />`：渲染四列/四行立绘，每项为 `<a target="_blank" rel="noopener noreferrer">`。
- `<MemberSection member={member} index={i} />`：`index` 用于奇偶背景交替（设计文档 §2.5）。
- `<SmoothScroll />`：无 props，仅副作用。

## 5. 风险与权衡

| # | 风险 | 影响 | 缓解 / 取舍 |
|---|------|------|-------------|
| 1 | lenis 拦截原生滚动可能与未来锚点跳转、浏览器手势冲突 | 导航「首页」回顶失效等 | 回顶用 `lenis.scrollTo(0)` 而非原生锚点（SmoothScroll 暴露实例或事件）；提供随时移除 lenis 的降级路径（纯 CSS `scroll-behavior: smooth` 兜底）；移动端不启用 |
| 2 | 立绘全身图 CSS 裁切上半身，不同视口比例下可能裁切到面部 | 首屏视觉受损 | `imagePosition` 逐成员微调 + 按设计文档人工验收 PC/移动端各尺寸；若仍不达标，再考虑用 sharp 预生成上半身裁切版本（本期不预做） |
| 3 | Mantine 组件在 Vitest/jsdom 中渲染需要 Provider 包裹 | 测试基建复杂度 | 测试工具统一封装 `renderWithTheme()`（`@/tests/utils`），所有用例复用 |
| 4 | `matchMedia` 在 jsdom 中缺失，Mantine 部分组件依赖 | 测试报错 | 测试 setup 中 mock `matchMedia`（Mantine 官方文档标准做法） |
| 5 | 纯 CSS hover 灰化依赖 `:hover` 于父容器的级联 | 触摸设备无 hover | 需求明确移动端无 hover 态，不构成问题 |

## 6. 测试策略

遵循根目录 `AGENTS.md` 的红-绿-重构 TDD 流程。工具：Vitest + RTL + user-event + jest-dom，setup 中 mock `matchMedia`、统一 `renderWithTheme`。

单元测试覆盖范围与验收标准对照：

| 验收标准 | 测试方式 |
|----------|----------|
| AC-1（5 套调色盘 token） | `theme.ts` 单测：五套色阶存在、各 10 色、index 6 等于代表色 / 设计值 |
| AC-2（导航栏） | SiteHeader 单测：渲染「首页」且仅一项；视口无关的 DOM 中包含 Burger；user-event 点击 Burger 后 Drawer 出现「首页」，再点击后关闭 |
| AC-3（PC 首屏：顺序/hover/跳转） | HeroWall 单测：四列按绿黑白紫顺序渲染（DOM 顺序断言）、每项 `href` 为对应 UID 直链且 `target="_blank"`、图片 `alt` 含成员名；hover 灰化为纯 CSS，断言组件挂载了对应 class（视觉效果人工验收） |
| AC-4（移动端首屏） | 同一 DOM 的响应式排版为 CSS 职责，单测断言结构，断点下实际效果人工验收 |
| AC-5/AC-6（介绍区内容与布局） | MemberSection 单测：名称、称号、简介、B 站链接渲染；`page.tsx` 渲染四个介绍区且顺序与 members 一致 |
| AC-7（工程验证） | `pnpm test` / `pnpm lint` / `pnpm build` 全绿 |

**人工验收项**（无法单测覆盖）：阻尼滚动手感、hover 灰化过渡、移动端布局、立绘裁切构图——按设计文档逐项对照（PC Chrome + 移动端模拟器/真机）。

## 7. 评审记录

| 评审人 | 日期 | 结论 | 备注 |
|--------|------|------|------|
| Deliay | 2026-09-23 | 通过 | PR #1；口头评审通过，记录于开发启动前回填 |
