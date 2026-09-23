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
