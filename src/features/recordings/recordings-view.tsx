"use client";

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
        <RecordingsSection items={controller.state.items} />
      </main>
    </>
  );
}
