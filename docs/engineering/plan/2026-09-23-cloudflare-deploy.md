# Cloudflare 部署支持 · 技术实现计划

- 版本：v1.1（开发完成后回填验收结果）
- 创建日期：2026-09-23
- 对应技术方案：[docs/engineering/proposal/2026-09-23-cloudflare-deploy.md](../proposal/2026-09-23-cloudflare-deploy.md)
- 对应需求文档：[docs/product/requirement/2026-09-23-cloudflare-deploy.md](../../product/requirement/2026-09-23-cloudflare-deploy.md)
- 状态：已评审通过（人工节点「审核实现文档」2026-09-23 完成审核），任务 T0–T5 已全部完成

> 前置状态：需求文档与技术方案已提交需求总分支 `feat/cloudflare-deploy`（PR #2）；本计划以技术方案评审通过为执行前提。
> 每个任务遵循红-绿-重构循环：先写失败测试 → 最小实现使其通过 → 重构保持全绿。
> 本需求不涉及 UI/UX 变更与 `src/` 业务代码改动，仅调整构建配置与部署工具链。

## 1. 任务拆解

### T0 部署配置一致性测试（红）✅

- 新增 `tests/deploy-config.test.ts`，全部用例 initially 失败（`wrangler.toml` 尚不存在、`package.json` 尚无对应脚本与依赖）。
- **测试用例（红）**：
  1. 仓库根目录存在 `wrangler.toml`，解析后 `assets.directory` 为 `"./out"`，`name` 非空且不含任何 secret 字段（不出现 `token` / `secret` / `key` 字样之外的敏感值，实际以字段白名单校验：`name` / `compatibility_date` / `assets`）。
  2. `package.json` `scripts` 包含 `deploy`（含 `wrangler deploy`）与 `preview`（含 `wrangler dev`）。
  3. `package.json` `devDependencies` 包含 `wrangler`。
  4. `next.config.ts` 的默认导出包含 `output: "export"` 与 `images.unoptimized: true`（动态 import 配置文件断言）。
- 涉及文件：`tests/deploy-config.test.ts`（新增）。
- 验证：运行 `pnpm test`，确认新用例**因预期原因失败**（文件缺失/字段缺失），既有用例保持绿色。
- 预计：0.5h。

### T1 静态导出构建配置（绿 · 部分）✅

- 修改 `next.config.ts`：增加 `output: "export"` 与 `images: { unoptimized: true }`（理由见技术方案 §3：静态导出不支持 `next/image` 运行时优化，站点图片已预置为 avif）。
- **TDD 循环**：使 T0 用例 4 转绿；`pnpm test` 全量回归（既有组件/页面测试不受构建配置影响）。
- 涉及文件：`next.config.ts`。
- 预计：0.25h。

### T2 wrangler 配置文件（绿 · 部分）✅

- 新增 `wrangler.toml`：

  ```toml
  name = "287-fan-site"
  compatibility_date = "<执行当天的日期>"
  [assets]
  directory = "./out"
  ```

- 不编写任何 Worker 代码（Workers Static Assets 直接托管 `out/`）；文件不含密钥，纳入 git 管理。
- **TDD 循环**：使 T0 用例 1 转绿。
- 涉及文件：`wrangler.toml`（新增）。
- 预计：0.25h。

### T3 部署工具链脚本与依赖（绿 · 完成）✅

- `package.json`：
  - `devDependencies` 增加 `wrangler`（执行 `pnpm add -D wrangler`，由 pnpm-lock 锁定版本）。
  - `scripts` 增加：
    - `preview`：`next build && wrangler dev`
    - `deploy`：`next build && wrangler deploy`
  - 不增加 `build:cf` 别名（技术方案标注为可选，现有 `build` 语义已足够，保持最小变更）。
- **TDD 循环**：使 T0 用例 2、3 转绿；`pnpm test` 全绿。
- 验证：`pnpm install` 后 `pnpm exec wrangler --version` 正常输出版本号（验收标准 1）。
- 涉及文件：`package.json`、`pnpm-lock.yaml`。
- 预计：0.5h。

### T4 构建产物验证与重构 ✅

- 执行 `pnpm run build`，确认：
  - 构建成功且产出 `out/` 目录；
  - `out/index.html` 存在；
  - `public/` 下静态资源（svg、`images/members/*.avif`）均出现在 `out/` 中。
- 若 `next/image` 在 `unoptimized` 下产生构建警告/错误，回到 T1 修正（保持测试绿色）。
- 重构检查：配置字段命名与注释清晰；`wrangler.toml` 与技术方案 §4 接口定义一致；无多余变更。
- 涉及文件：视验证结果而定（预期无新增改动）。
- 预计：0.5h。

### T5 全量回归与部署验收 ✅

- 全量回归：`pnpm test`、`pnpm run lint`、`pnpm run dev`（可启动）、`pnpm run build` 全部正常（验收标准 6）。
- 本地预览验收：执行 `pnpm run preview`，浏览器访问 wrangler dev 输出的本地地址，确认页面与构建产物一致（验收标准 4）。
- 部署验收（需维护者本机已完成 `wrangler login` 或设置 `CLOUDFLARE_API_TOKEN`）：
  - 执行 `pnpm run deploy`，记录输出的 `*.workers.dev` 地址；
  - 访问该地址：首页正常渲染、Hero 立绘墙与成员区块图片加载正常、无 404 资源（验收标准 2、3）。
- 对照需求文档 §4 验收标准逐条勾选，结果回填本文档 §3。
- 涉及文件：无（纯验收任务）。
- 预计：0.5h（不含真实部署的账号准备时间）。

## 2. 执行顺序与依赖

```
T0（红：测试先行）→ T1（next.config）→ T2（wrangler.toml）→ T3（scripts + 依赖）→ T4（构建验证/重构）→ T5（回归与部署验收）
```

- T0 必须先于 T1–T3 完成（红阶段），T1–T3 为三个独立的小循环，彼此之间无依赖，但均依赖 T0 的测试骨架。
- T4 依赖 T1–T3 全部完成（需要完整配置才能验证 `out/` 产物）。
- T5 依赖 T4；其中真实部署步骤依赖维护者的 Cloudflare 账号认证（不阻塞代码合入，认证凭据不入库）。
- 每个任务完成后在本文档 §1 对应标题后标记 ✅。

## 3. 验收对照

| 验收标准（需求文档 §4） | 覆盖任务 | 验证方式 |
|------------------------|----------|----------|
| 1. wrangler 本地可用 | T3 | `pnpm exec wrangler --version` 输出版本号 |
| 2. 部署地址可访问 | T5 | `pnpm run deploy` 输出地址，浏览器访问 |
| 3. 页面/图片无 404 | T4、T5 | `out/` 产物检查 + 部署后实访 |
| 4. 预览脚本可用 | T3、T5 | `pnpm run preview` 本地访问验证 |
| 5. 配置入库且无密钥 | T2 | T0 用例 1（字段白名单断言）+ 提交前人工检查 |
| 6. 现有流程不破坏 | T1–T5 | `pnpm test` / `lint` / `dev` / `build` 全量回归 |
| 7. 新增部署配置测试 | T0 | `tests/deploy-config.test.ts` 全绿 |

**验收结果回填区**（开发完成后填写）：

| 验收标准 | 结果 | 说明 |
|----------|------|------|
| 1. wrangler 本地可用 | ✅ 通过 | `pnpm exec wrangler --version` → 4.136.1（devDependency，未全局安装） |
| 2. 部署地址可访问 | ✅ 通过 | 本机无 Cloudflare 凭据，以 `wrangler deploy --temporary`（临时预览账号）完成部署，地址 `https://287-fan-site.earthy-tern.workers.dev`，首页返回 200 且 `<title>287 应援站</title>`；正式凭据部署由维护者 `wrangler login` 后执行 `pnpm run deploy` 复验 |
| 3. 页面/图片无 404 | ✅ 通过 | `out/` 含 `index.html`、5 个 svg、4 个 `images/members/*.avif`；线上逐一请求首页/4 张立绘/5 个 svg/favicon/JS/CSS 共 22 项资源全部 200（后续重复 curl 返回 403 为 Cloudflare 反机器人挑战页，非资源缺失，浏览器访问不受影响） |
| 4. 预览脚本可用 | ✅ 通过 | `pnpm run preview` → `wrangler dev` Ready on http://localhost:8787，`/` 与 `/images/members/viridis.avif` 均 200 |
| 5. 配置入库且无密钥 | ✅ 通过 | `wrangler.toml` 仅 `name` / `compatibility_date` / `assets.directory`，T0 用例 1 白名单 + 敏感字段名断言通过；`.wrangler/` 本地状态已加入 `.gitignore` |
| 6. 现有流程不破坏 | ✅ 通过 | `pnpm test` 30/30、`pnpm run lint` 无告警、`pnpm run dev` 首页 200、`pnpm run build` 成功产出 `out/`；返工后 `pnpm run start` 不再保留必然报错的入口（见返工修订记录 P1） |
| 7. 新增部署配置测试 | ✅ 通过 | `tests/deploy-config.test.ts` 用例全绿（先红后绿；返工新增用例 5：禁止 `next start` 脚本） |

**实施偏差记录**（相对本计划的最小偏差）：

1. `pnpm-workspace.yaml` 的 `allowBuilds` 新增 `esbuild: true`、`workerd: true`：wrangler 依赖的这两个包需要执行 postinstall 下载二进制，否则 pnpm 报 `ERR_PNPM_IGNORED_BUILDS` 并使 `pnpm exec wrangler` 触发的依赖状态检查失败（验收标准 1 的必要条件）。
2. `.gitignore` 新增 `.wrangler/`：`wrangler dev` 会在仓库根目录生成本地 miniflare 状态目录，不属于部署配置，不应入库（验收标准 5 的必要条件）。
3. 未增加 `build:cf` 别名（技术方案标注可选），保持最小变更。

**返工修订记录（2026-09-23 · 针对代码审核打回）**：

- **P1（阻塞）`start` 脚本与 `output: 'export'` 不兼容**：`pnpm run build && pnpm run start` 必然失败（`Error: "next start" does not work with "output: export" configuration.`，exit 1）。
  - **采纳方案：(a) 删除 `start` 脚本**。理由：静态导出产物不再具备可被 `next start` 承载的服务端，本地运行由 `pnpm run dev`（开发）与 `pnpm run preview`（wrangler dev，产物预览）覆盖，发布由 `pnpm run deploy` 承担；相较方案 (b)（引入 `serve` 等静态服务器依赖）不新增依赖，符合技术方案「保持最小变更」原则（与不加 `build:cf` 同源）。
  - **测试计划**：`tests/deploy-config.test.ts` 新增用例 5（红）——断言 `package.json` 不得存在调用 `next start` 的 `start` 脚本；删除脚本后转绿（与 T0 用例同批，遵循红-绿流程）。
  - 涉及文件：`package.json`、`tests/deploy-config.test.ts`。
- **S1（非阻塞建议）README 部署章节**：采纳——将 `README.md` 的「Deploy on Vercel」章节替换为本项目实际的 Cloudflare 部署/预览用法（`pnpm run preview` / `pnpm run deploy`），避免文档指向与本期能力不符的平台；不改变任何代码行为。

## 4. 评审记录

| 评审人 | 日期 | 结论 | 备注 |
|--------|------|------|------|
| （待评审） | - | - | - |
