This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Cloudflare

本站采用 Next.js 静态导出（`output: "export"`），通过 [wrangler](https://developers.cloudflare.com/workers/wrangler/) 部署为 Cloudflare Workers Static Assets，构建产物为根目录 `out/`（配置见 `wrangler.toml`）。

```bash
# 部署前本地预览（构建 + wrangler dev，默认 http://localhost:8787）
pnpm run preview

# 构建并部署到 Cloudflare（需先 pnpm exec wrangler login 或设置 CLOUDFLARE_API_TOKEN）
pnpm run deploy
```

本地开发仍使用 `pnpm run dev`；静态导出不支持 `next start`，因此不提供 `start` 脚本。

## 本地验收（录播模块跨域 / R10）

两个服务 API 均为 **origin 白名单 CORS**（2026-09-24 实测仅放行 `https://sumire.live`），
本地浏览器直连会被拦截，因此 `pnpm dev` 会**自动启动本地反代并注入基址**（前端代码与线上同为直连形态）：

```bash
pnpm dev        # next dev + 本地反代 http://127.0.0.1:8788（透传 Range / 流式响应）
pnpm proxy      # 仅启动本地反代（调试用）
LOCAL_PROXY=0 pnpm dev   # 关闭反代（前端直连生产源）

# 探活
curl -s http://127.0.0.1:8788/__proxy/health
```

路径映射：`/recordings/**` → `recordings.vtuber.fffdan.com`，`/events/**` → `api.sumire.live`。
浏览器人工验收清单（四家状态 / 录播列表 / 回放含未缓冲 seek / 弹幕事件 / 听直播多路）见
`docs/engineering/plan/2026-09-23-recordings-module.md` 的 **T15** 小节。

`pnpm build` / `pnpm preview` / `pnpm deploy` **不经过**本地反代，产物保持线上直连形态。

**上线前置条件（人工协调）**：需服务侧把本站生产域名加入两个服务的 CORS 白名单，复验：

```bash
curl -s -D- -o /dev/null -H "Origin: <生产域>" \
  https://recordings.vtuber.fffdan.com/api/b/live/recording-status | grep -i access-control
# 期望回显：access-control-allow-origin: <生产域>（弹幕服务同法复验）
```

若无法获得白名单，线上直连不成立，需回到技术方案 §5-1 的 Worker 反代退路并**提交人工决策**。
