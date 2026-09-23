import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 纯静态站点，构建期导出为静态产物（部署到 Cloudflare Workers Static Assets）
  output: "export",
  // 静态导出不支持 next/image 运行时优化；站点图片已预置为 avif，关闭优化
  images: {
    unoptimized: true,
  },
  // 开发态代理直播状态接口（生产经 CORS 白名单直连，本地 localhost 不在白名单内）。
  // 静态导出构建期 NODE_ENV=production 返回空数组：rewrites 不参与导出产物（技术方案 §2）。
  async rewrites() {
    if (process.env.NODE_ENV !== "development") {
      return [];
    }
    return [
      {
        source: "/api/live/:path*",
        destination: "https://api.sumire.live/api/live/:path*",
      },
    ];
  },
};

export default nextConfig;
