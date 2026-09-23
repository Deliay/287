import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 纯静态站点，构建期导出为静态产物（部署到 Cloudflare Workers Static Assets）
  output: "export",
  // 静态导出不支持 next/image 运行时优化；站点图片已预置为 avif，关闭优化
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
