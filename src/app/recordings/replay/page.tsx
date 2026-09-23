import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { ReplayView } from "@/features/recordings/replay/replay-stage";
import styles from "@/features/recordings/replay/replay-view.module.css";

export const metadata: Metadata = {
  title: "录播回放 | 287 应援站",
  description: "历史录播回放：播放控件、进度 seek 与弹幕时间轴",
};

/**
 * 回放页路由（FR-5 / 静态导出）：
 * `useSearchParams` 需由 `Suspense` 包裹（无服务端渲染，静态导出要求）。
 */
export default function ReplayPage() {
  return (
    <>
      <SiteHeader />
      <main className={styles.main}>
        <Suspense fallback={<p className={styles.fallback}>正在加载回放…</p>}>
          <ReplayView />
        </Suspense>
      </main>
    </>
  );
}
