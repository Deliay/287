# 287 应援站

VirtuaReal 二十八期（「287」期）四位成员——小松绿 Viridis、四时小路 Komichi、羽啾 Chu2u、枝堇 Sumire 的粉丝站。

站点为纯静态 Next.js 应用，包含**首页立绘展示**与**录播模块**两大功能：前者以成员立绘与调色盘建立视觉基调，后者提供直播状态、多路在线收听、历史录播回看与弹幕。

## 功能一览

### 首页

- **成员立绘墙**：PC 端四列并排、移动端四行排列，均占满首屏，顺序固定为「绿黑白紫」；悬停高亮当前成员、其余变灰，点击平滑滚动到对应介绍区。
- **成员介绍区**：左侧立绘、右侧文案（移动端纵向），含身份称号、简介、代表色强调与 B 站主页入口。
- **滚动体验**：全局阻尼滚动（lenis），并按成员介绍区逐屏吸附。
- **实时直播徽章**：首屏与介绍区共享同一数据源，开播时显示「正在直播：{标题}」并以成员代表色着色，未开播/请求失败时降级为「未开播」。
- **主题体系**：一套「287」团体调色盘 + 四套成员调色盘，统一收敛在 `src/theme.ts`。

### 录播

- **直播状态卡片**：四位成员 2×2（移动端单列）展示，30 秒轮询；页面不可见时暂停，恢复后立即刷新。
- **多路听直播**：最多同时收听 4 路（每位成员一路），各路独立启停与调节音量，单路失败不影响其他路。
- **悬浮播放组件**：挂载于根布局，跨页面不中断；支持单路停止、全部停止、收起为迷你条。
- **历史录播列表**：按成员分组、默认收起，点击展开后才按需请求；按开播时间倒序、每页 20 条，每项提供「播放 / 下载」入口。
- **站内回放页** `/recordings/replay`：FLV 播放（mpegts.js），支持播放/暂停、进度条（含缓冲显示与 hover 时间预览）、未缓冲区域 seek、倍速、音量、浏览器全屏与网页全屏（theater）。
- **弹幕与事件流**：弹幕浮层与视频时间轴对齐，seek 后自动重建；事件列表按 10 分钟窗口增量加载、跟随播放高亮、点击跳播。

### 全站

- 顶部固定导航（PC 右对齐，移动端折叠菜单），当前页高亮。
- 全站暗色主题、响应式布局、键盘可操作的播放控件，外部接口失败均有兜底 UI。

## 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | Next.js 16（App Router）+ React 19 + TypeScript |
| UI / 主题 | Mantine 9、CSS Modules、postcss-preset-mantine |
| 媒体播放 | mpegts.js（FLV / MSE，含本地补丁） |
| 滚动 | lenis |
| 测试 | Vitest + Testing Library（jsdom） |
| 部署 | 静态导出（`output: "export"`）→ Cloudflare Workers Static Assets（wrangler） |

## 快速开始

环境要求：Node.js 20+、pnpm 11（仓库通过 `packageManager` 锁定版本）。

```bash
pnpm install
pnpm dev
```

打开 <http://localhost:3000>。`pnpm dev` 会先拉起本地反代，再启动 Next 开发服务器（见下文「本地开发与跨域」）。

### 常用脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动本地反代 + `next dev`（默认注入代理基址） |
| `pnpm proxy` | 仅启动本地反代（默认 `http://127.0.0.1:8788`），调试用 |
| `pnpm test` | 运行全部 Vitest 用例 |
| `pnpm lint` | ESLint 检查 |
| `pnpm build` | 构建静态产物到 `out/` |
| `pnpm preview` | 构建后用 `wrangler dev` 本地预览产物 |
| `pnpm deploy` | 构建并部署到 Cloudflare |

## 目录结构

```
.
├── src/
│   ├── app/                        # App Router：首页、/recordings、/recordings/replay
│   ├── components/                 # 导航、立绘墙、成员介绍、直播徽章等通用组件
│   ├── data/members.ts             # 四位成员的基础资料与映射（mid / roomId / 主题色 / 链接）
│   ├── features/recordings/        # 录播模块
│   │   ├── api.ts                  # 外部接口封装与错误归一化
│   │   ├── live-status-grid.tsx    # 直播状态卡片与轮询
│   │   ├── recordings-section.tsx  # 历史录播列表（懒加载 + 分页）
│   │   ├── live-audio/             # 多路音频注册表与悬浮播放组件
│   │   └── replay/                 # 回放页：播放器、seek、弹幕浮层、事件流
│   ├── lib/                        # 直播状态请求、lenis 等
│   └── theme.ts                    # 团体与成员调色盘
├── scripts/                        # 本地开发反代与启动器
├── patches/                        # mpegts.js 字节偏移 seek 补丁
├── tests/                          # Vitest 用例
├── docs/                           # 需求、设计、技术方案与实现计划
└── resources/                      # 成员原始资料与立绘素材
```

## 数据来源

站点为纯静态导出、无服务端，浏览器直接访问以下外部服务：

| 用途 | 地址 |
|------|------|
| 直播状态 | `https://api.sumire.live/api/live/{member}/status` |
| 录制状态 / 录播列表 / 录播文件 / 直播音频 | `https://recordings.vtuber.fffdan.com/api/b/live/...` |
| 历史弹幕与直播事件 | `https://api.sumire.live/api/live-events/replay` |

媒体与接口基址可通过构建期环境变量覆盖（缺省即生产地址）：

```bash
NEXT_PUBLIC_RECORDINGS_BASE_URL=http://127.0.0.1:8788/recordings
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8788/events
```

## 本地开发与跨域

录播与弹幕两个服务均为 **origin 白名单 CORS**（2026-09-24 实测仅放行参考站域名），`localhost` 直连会被浏览器拦截。因此 `pnpm dev` 会自动启动本地反代并注入基址，前端代码与线上保持一致（仍为「直连」形态）：

```bash
pnpm dev                  # next dev + 本地反代 127.0.0.1:8788（透传 Range / 流式响应）
pnpm proxy                # 仅启动本地反代（调试用）
LOCAL_PROXY=0 pnpm dev    # 关闭反代，前端直连生产源

# 探活
curl -s http://127.0.0.1:8788/__proxy/health
```

路径映射：`/recordings/**` → `recordings.vtuber.fffdan.com`，`/events/**` → `api.sumire.live`。

`pnpm build` / `pnpm preview` / `pnpm deploy` **不经过**本地反代，产物保持线上直连形态。

> **上线前置条件（人工协调）**：需服务侧把本站生产域名加入两个服务的 CORS 白名单。复验方式：
>
> ```bash
> curl -s -D- -o /dev/null -H "Origin: <生产域>" \
>   https://recordings.vtuber.fffdan.com/api/b/live/recording-status | grep -i access-control
> # 期望回显：access-control-allow-origin: <生产域>（弹幕服务同法复验）
> ```

## 部署

站点采用 Next.js 静态导出（`output: "export"`），通过 [wrangler](https://developers.cloudflare.com/workers/wrangler/) 部署为 Cloudflare Workers Static Assets，构建产物为根目录 `out/`（配置见 `wrangler.toml`）。

```bash
# 部署前本地预览（构建 + wrangler dev，默认 http://localhost:8787）
pnpm run preview

# 构建并部署到 Cloudflare（需先 pnpm exec wrangler login 或设置 CLOUDFLARE_API_TOKEN）
pnpm run deploy
```

静态导出不支持 `next start`，因此不提供 `start` 脚本。

## 测试

```bash
pnpm test     # Vitest（jsdom + Testing Library）
pnpm lint
pnpm build
```

`tests/` 覆盖首页交互、主题、直播状态、录播 API、多路音频、悬浮组件、回放 seek / 弹幕 / 事件流、部署配置与本地反代等模块。

## 文档与开发流程

产品与技术文档位于 `docs/`：

- 需求：`docs/product/requirement/`
- UI/UX：`docs/product/design/`
- 技术方案：`docs/engineering/proposal/`
- 技术实现计划：`docs/engineering/plan/`

开发遵循「产品需求 → UI/UX → Review → 技术方案 → 技术实现方案 → 开发」流程，并以 TDD（红-绿-重构）推进；详见 [`AGENTS.md`](./AGENTS.md) 及各目录下的 `AGENTS.md`。

## 致谢

录播播放器、字节偏移 seek 与弹幕窗口化加载等实现参考了 [Deliay/sumire](https://github.com/Deliay/sumire)。
