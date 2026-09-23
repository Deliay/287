# 287 粉丝站 · 第一期（首页与成员展示）技术实现计划

- 版本：v1.0
- 创建日期：2026-09-23
- 对应技术方案：[docs/engineering/proposal/2026-09-23-fan-site-phase-1.md](../proposal/2026-09-23-fan-site-phase-1.md)
- 状态：已通过评审（开发执行中）

> 前置状态：需求文档与设计文档已通过 Review（PR #1）；本计划以技术方案评审通过为执行前提。
> 每个任务遵循红-绿-重构循环：先写失败测试 → 最小实现使其通过 → 重构保持全绿。

## 1. 任务拆解

### T0 测试基建与静态资源（前置任务，非功能代码）✅

- 安装依赖：`vitest`、`jsdom`、`@testing-library/react`、`@testing-library/user-event`、`@testing-library/jest-dom`、`vite-tsconfig-paths`（均为 devDependencies）。
- 新增 `vitest.config.ts`（jsdom 环境、`@/*` 别名、`setupFiles`）。
- 新增 `tests/setup.ts`：注册 jest-dom、mock `window.matchMedia`。
- 新增 `tests/utils.tsx`：`renderWithTheme()`（MantineProvider 包裹的 render）。
- `package.json` 增加 `"test": "vitest run"`。
- 复制 `resources/{viridis,komichi,chu2u,sumire}.avif` → `public/images/members/`。
- 验证：写一个示例断言测试并跑通 `pnpm test`，随后删除示例测试。
- 预计：0.5h。

### T1 成员数据层 `src/data/members.ts` ✅

- 产出：`Member` 接口与 `members` 数组（顺序：viridis → komichi → chu2u → sumire），字段含名称、罗马音、称号、简介摘要（设计文档 §2.5 文案）、colorKey、image、imagePosition、bilibili UID 直链（需求文档 §7 链接表）。
- **测试用例（红）**：
  1. `members` 长度为 4，id 顺序严格为 `["viridis", "komichi", "chu2u", "sumire"]`（绿黑白紫）。
  2. 每位成员 `bilibili` 为 `https://space.bilibili.com/` + 对应 UID（1891335475 / 1512246445 / 2138961136 / 1150976664）。
  3. 每位成员 `name` / `romanName` / `title` / `description` / `image` 非空，`image` 以 `/images/members/` 开头且文件存在于 `public/`。
  4. `colorKey` 与调色盘键一一对应。
- 对应验收：AC-3、AC-4、AC-6（数据正确性部分）。
- 预计：0.5h。

### T2 主题 `src/theme.ts` 并接入 `src/app/layout.tsx`

- 产出：五套 10 级色阶（`night287` / `viridis` / `komichi` / `chu2u` / `sumire`，色值与设计文档 §1 逐项一致），`MantineProvider theme={theme}`。
- **测试用例（红）**：
  1. `theme.colors` 包含五个键，每套色阶长度为 10。
  2. 各成员色阶 index 6 等于代表色（`#8eb056` / `#ff2231` / `#d4da7b` / `#b4a6bf`），`night287[6] === "#5c5670"`（统一小写比较）。
  3. `night287[9]` / `night287[8]` 分别为页面底色与导航底色设计值（`#1c1a22` / `#2e2b38`）。
- 对应验收：AC-1。
- 预计：0.5h。

### T3 导航栏 `src/components/site-header.tsx` ✅

- 产出：固定顶栏（高 60px，night287-8 背景），左侧站点名，右侧导航；PC 右对齐「首页」链接，移动端 Burger + Drawer；「首页」点击回到页面顶部（有 lenis 时走 `lenis.scrollTo`，否则原生平滑滚动；lenis 实例经 `src/lib/lenis.ts` 共享，见技术方案 §3.1）。
- **测试用例（红）**：
  1. 渲染站点名「287 应援站」与唯一的导航项「首页」（`getAllByRole("link")` 中导航链接仅一个）。
  2. 存在 Burger 按钮（默认视觉隐藏由 CSS 控制，DOM 恒在）。
  3. user-event 点击 Burger → Drawer 中出现「首页」；点击抽屉内「首页」→ Drawer 关闭。
- 对应验收：AC-2。
- 预计：1.5h。

### T4 首屏立绘墙 `src/components/hero-wall.tsx` ✅

- 产出：`HeroWall`，每项为 `<a target="_blank" rel="noopener noreferrer">` 包裹 `next/image`（fill、cover、object-position 取 `imagePosition`、priority），叠成员名称与代表色指示条；CSS Module 实现 PC 四列（各 25% 宽、100dvh）/ 移动端四行（各 25dvh）与 hover 灰化（`.wall:hover .panel` 灰化 + `.panel:hover` 恢复并放大，300ms ease-out）；全身立绘经 cover + 顶部锚点缩放裁出上半身（构图系数按断点/成员微调，见技术方案 §3.3）。
- **测试用例（红）**：
  1. 按 members 顺序渲染 4 个链接，href 依次为四位成员 B 站链接（顺序断言即绿黑白紫）。
  2. 每个链接 `target="_blank"` 且 `rel` 含 `noopener noreferrer`。
  3. 4 张图片 `alt` 分别包含成员中文名。
  4. 容器与每项挂载了 hover 灰化所需的 CSS class（结构断言）。
- 对应验收：AC-3、AC-4（布局与动效人工验收）。
- 预计：2h。

### T5 成员介绍区 `src/components/member-section.tsx` ✅

- 产出：`MemberSection({ member, index })`，PC 左立绘（40%）右介绍（60%，垂直居中），移动端上下布局；奇偶区背景交替（night287-9 / night287-8）；标题与强调元素使用对应成员色阶；含「前往 B 站主页」链接；立绘经 cover + 顶部锚点缩放裁出半身、底部对齐区块下缘。
- **测试用例（红）**：
  1. 渲染成员中文名、罗马音、称号、简介摘要。
  2. 渲染指向 `member.bilibili` 的链接（`target="_blank"`）。
  3. 立绘 `img` 的 `alt` 含成员名。
  4. `index` 奇偶对应不同的背景 class。
- 对应验收：AC-5、AC-6。
- 预计：2h。

### T6 阻尼滚动 `src/components/smooth-scroll.tsx` ✅

- 产出：Client Component，`useEffect` 中 `window.matchMedia("(min-width: 48em)")` 命中时初始化 `new Lenis({ autoRaf: true })` 并注册到 `src/lib/lenis.ts`，卸载时清除注册并 `destroy()`；不命中或环境不支持时无副作用。
- **测试用例（红）**：
  1. mock `lenis` 模块：PC 断点命中时构造函数被调用、卸载时 `destroy` 被调用。
  2. 移动端断点不命中时构造函数不被调用。
- 对应验收：AC-5（阻尼手感人工验收）。
- 预计：1h。

### T7 页面组装与全量验收 ✅

- 产出：`src/app/page.tsx` 组装 `<SiteHeader />` + `<SmoothScroll />` + `<HeroWall members={members} />` + 四个 `<MemberSection />`；`layout.tsx` 注入 theme；`globals.css` 设置页面底色 night287-9 与文字色 night287-0；移除占位页内容。
- **测试用例（红）**：
  1. 首页渲染出立绘墙 4 项 + 介绍区 4 区，且两处成员顺序一致（同为绿黑白紫）。
- 全量验证：`pnpm test` / `pnpm lint` / `pnpm build` 全绿；按 §3 人工验收清单逐项对照。
- 对应验收：AC-1 ~ AC-7 整体回归。
- 预计：1.5h。

## 2. 执行顺序与依赖

```
T0（基建）→ T1（数据）→ T2（主题）→ T3（导航）→ T4（立绘墙）→ T5（介绍区）→ T6（阻尼滚动）→ T7（组装验收）
```

- T1/T2 为纯数据与配置，T3–T6 均依赖 T1（成员数据），T2 为 T3–T5 的样式前提。
- T7 依赖全部前置任务。
- 每个任务完成后在本文档 §1 对应标题后标记 ✅。

## 3. 验收对照

| 验收标准 | 覆盖任务 | 验证方式 |
|----------|----------|----------|
| AC-1 调色盘 | T2 | 单测 + `grep` 确认组件无硬编码 hex |
| AC-2 导航栏 | T3 | 单测；人工验证移动端 Drawer 与右对齐 |
| AC-3 PC 首屏 | T4 | 单测；人工验证 hover 灰化/放大、新标签页跳转 |
| AC-4 移动端首屏 | T4 | 单测（结构）；人工验证四行平分、横向占满 |
| AC-5 阻尼滚动与介绍区顺序 | T5、T6、T7 | 单测（顺序）；人工验证阻尼手感 |
| AC-6 介绍内容 | T1、T5 | 单测对照 `resources/` 资料与设计文档文案 |
| AC-7 工程验证 | T7 | `pnpm test && pnpm lint && pnpm build` |

**人工验收环境**：PC Chrome（≥1440px 与 1024px 宽度）、移动端模拟器（iPhone 15 / Android 360px 宽度），对照设计文档 §2、§3 逐项检查。

**人工验收对照记录（2026-09-23 开发自检，无头 Chromium 实拍 + 像素/计算样式测量）：**

| 项目 | 结果 |
|------|------|
| hover 过渡 | ✅ 悬停列 `filter: none` + `scale(2.06)`（含 1.03 提亮放大），其余列 `grayscale(1) brightness(0.6)`，过渡 `300ms ease-out`（计算样式实测）；实拍截图留档 |
| 阻尼手感 | ✅ PC 滚轮 1200px 后 scrollY 采样呈缓出渐近（114→395→661→839→…→1200），移动端不启用保留原生滚动；真机手感待评审人确认 |
| 移动端布局 | ✅ 360/390px 实拍：四行等高平分（170/196px）、介绍区立绘 50dvh 在上文字在下、Drawer 全宽 night287-8 底色（像素采样 #2e2b38）、汉堡图标 night287-0 |
| 立绘裁切构图 | ✅ PC 首屏头→腰（上半身，头顶距面板顶 39–232px，导航栏安全区达标）、介绍区头→臀（半身、底缘对齐区块下缘）、移动端首屏胸像紧裁；bbox 像素测量确认 |
| PC 首屏布局 | ✅ 1440/1024px 实拍：四列各 25%（360/256px）、高 100dvh、顺序绿黑白紫、名称+4px 代表色条就位 |

## 4. 评审记录

| 评审人 | 日期 | 结论 | 备注 |
|--------|------|------|------|
| Deliay | 2026-09-23 | 通过 | PR #1；口头评审通过，记录于开发启动前回填 |
