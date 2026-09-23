# 技术方案：Cloudflare 部署支持

- 主题名：`cloudflare-deploy`
- 创建日期：2026-09-23
- 状态：待评审

## 1. 对应上游文档

- 需求文档：`docs/product/requirement/2026-09-23-cloudflare-deploy.md`
- 设计文档：本需求为纯工程/部署向需求，不涉及 UI/UX 变更，无需设计文档（对应需求文档「范围边界」）。

## 2. 技术选型

| 选型 | 说明 |
|------|------|
| **Next.js 静态导出**（`output: 'export'`） | 站点为纯静态单页应用（无 API 路由、无 SSR 动态内容，数据全部来自 `src/data/members.ts` 构建期内联），静态导出产物即完整站点。 |
| **wrangler**（devDependency） | Cloudflare 官方 CLI，用于本地预览与部署。纳入 devDependencies，通过 pnpm 脚本调用，无需全局安装。 |
| **Cloudflare Workers Static Assets** | 通过 `wrangler.toml` 的 `assets` 配置直接托管 `out/` 静态产物，免费套餐内可用，无需编写 Worker 代码。 |

### 备选方案及取舍

- **`@opennextjs/cloudflare`（OpenNext 适配器）**：支持 Next.js 完整 SSR/ISR 能力，但本项目无任何动态服务端能力，引入适配器会显著增加构建复杂度与维护成本，**不采用**；未来若新增 API 路由或 SSR 需求再评估迁移。
- **Cloudflare Pages**：即将被 Workers Static Assets 取代，官方新项目推荐后者，**不采用**。
- **保持 `next start` + 自建服务器**：违背「低成本、免运维」目标，**不采用**。

## 3. 架构设计

部署链路：

```
pnpm run deploy
  └─ next build（output: 'export'）→ 生成 out/ 静态产物
  └─ wrangler deploy（读取 wrangler.toml，将 out/ 上传为 Workers Static Assets）
```

涉及的文件变更：

- `next.config.ts`：增加 `output: 'export'`；因静态导出不支持 Next.js 图片优化服务，为 `next/image`（`src/components/hero-wall.tsx`、`src/components/member-section.tsx`）增加 `images: { unoptimized: true }`。站点图片均已在构建前优化为 avif（`resources/`、`public/images/`），关闭运行时优化对体积影响可接受。
- `wrangler.toml`（新增）：声明站点名（`name`）与静态资源目录（`assets.directory = "./out"`），纳入版本管理，不含密钥。
- `package.json`：devDependencies 增加 `wrangler`；scripts 增加：
  - `build:cf`：`next build`（语义化别名，可选）
  - `preview`：`next build && wrangler dev`（本地以 Workers 静态资源方式预览产物）
  - `deploy`：`next build && wrangler deploy`
- `tests/`：新增配置文件一致性测试（见「测试策略」）。

与现有代码的关系：不改动 `src/` 下任何业务代码，仅调整构建配置与部署工具链。

## 4. 接口设计

无 API / 数据结构变更。配置接口如下：

`wrangler.toml` 关键字段：

```toml
name = "287-fan-site"
compatibility_date = "<部署日期>"
[assets]
directory = "./out"
```

`next.config.ts` 关键字段：

```ts
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};
```

认证方式：本地执行 `wrangler login`（OAuth）或设置 `CLOUDFLARE_API_TOKEN` 环境变量，凭据不写入仓库。

## 5. 风险与权衡

| 风险 | 影响 | 应对 |
|------|------|------|
| 关闭 `next/image` 运行时优化 | 失去按需缩放/格式协商 | 图片已预置为 avif 且尺寸受控，影响可接受；验收标准中要求部署后图片加载正常 |
| 静态导出后无法使用 SSR/动态路由 | 未来若需动态能力需重构部署方式 | 需求文档范围边界已明确本期纯静态；备选方案记录 OpenNext 迁移路径 |
| Wrangler 版本升级引入破坏性变更 | 部署脚本失效 | wrangler 锁定在 devDependencies（pnpm-lock 固定版本） |
| 误将 API Token 提交入库 | 凭据泄露 | 凭据只走环境变量/本地 OAuth；`wrangler.toml` 仅含非敏感字段；评审与提交时检查 |

## 6. 测试策略

遵循 TDD（红-绿-重构），新增测试：

1. **`tests/deploy-config.test.ts`**（新增）：
   - 红：断言仓库根目录存在 `wrangler.toml` 且 `assets.directory` 指向 `./out`（先失败）。
   - 绿：创建 `wrangler.toml` 使测试通过。
   - 断言 `package.json` 包含 `deploy` / `preview` 脚本且 devDependencies 含 `wrangler`。
2. **既有测试回归**：`pnpm test`（vitest）全量通过，确认 `next.config.ts` 改动不影响 `tests/` 中现有用例。
3. **构建验证**：`pnpm run build` 成功产出 `out/` 目录，包含 `index.html` 与静态资源。
4. **部署验收**：对照需求文档第 4 节逐条人工验证（wrangler 可用、部署地址可访问、图片无 404、预览脚本可用）。

## 7. 评审记录

| 评审人 | 日期 | 结论 | 说明 |
|--------|------|------|------|
| （待评审） | - | - | - |
