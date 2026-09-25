"use client";

import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import {
  LiveStatusGrid,
  useRecordingStatus,
} from "./live-status-grid";
import { RecordingsSection } from "./recordings-section";
import styles from "./recordings-view.module.css";

/**
 * 录播页客户端组装：只拉一次录制状态，同时供给「当前直播」卡片与
 * 「历史录播」分组（mid → roomId 关联），首屏仅请求 recording-status 一个接口（需求 §5）。
 *
 * `RecordingsSection` 内部经 `useSearchParams` 读取 `?member=`（AC-7 带参直达）；
 * 静态导出要求该 hook 位于 Suspense 边界内，否则构建期报错（技术方案 FR-3）。
 * fallback 取 null：分组点击前零请求，首屏不因该边界产生额外请求（R14-1）。
 */
export function RecordingsView() {
  const controller = useRecordingStatus();

  return (
    <>
      <SiteHeader />
      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.title}>录播</h1>
          <p className={styles.subtitle}>四位成员的直播状态与历史录播回看。</p>
        </header>
        <LiveStatusGrid controller={controller} />
        <Suspense fallback={null}>
          <RecordingsSection
            items={controller.state.items}
            statusKind={controller.state.kind}
          />
        </Suspense>
      </main>
    </>
  );
}
