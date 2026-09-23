"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  audioRegistry,
  type AudioLane,
  type LaneState,
} from "./audio-player-registry";
import styles from "./floating-audio-player.module.css";

/** 成员调色盘白名单（防注入到 CSS 自定义属性）。 */
const COLOR_KEYS = new Set(["viridis", "komichi", "chu2u", "sumire"]);

function laneLabel(lane: AudioLane): string {
  return lane.label ?? `直播间 ${lane.roomId}`;
}

function laneColor(lane: AudioLane): string | undefined {
  return lane.colorKey && COLOR_KEYS.has(lane.colorKey)
    ? `var(--mantine-color-${lane.colorKey}-6)`
    : undefined;
}

const STATE_TEXT: Record<LaneState, string> = {
  loading: "加载中…",
  playing: "播放中",
  error: "失败",
};

/**
 * 悬浮播放组件（FR-6 / 设计文档 §2.6）。
 *
 * 挂载于 root layout：路由切换时组件与媒体元素宿主均不卸载，因此「听直播」跨页不断流（AC-8）。
 * 0 路时不渲染任何界面，仅保留空宿主。
 */
export function FloatingAudioPlayer() {
  const subscribe = useCallback((listener: () => void) => audioRegistry.subscribeLanes(listener), []);
  const lanes = useSyncExternalStore(
    subscribe,
    () => audioRegistry.getLanesSnapshot(),
    () => audioRegistry.getLanesSnapshot(),
  );
  const mediaElements = useSyncExternalStore(
    subscribe,
    () => audioRegistry.getMediaElements(),
    () => audioRegistry.getMediaElements(),
  );
  const [collapsed, setCollapsed] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  // 媒体元素宿主：把各路 <video> 挂进 root layout 内的容器（跨路由存活的关键），
  // 并摘除已停止路遗留的孤儿节点（审核次要4：反复收听不得累积）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const keep = new Set(mediaElements.map((entry) => entry.element));
    for (const entry of mediaElements) {
      if (entry.element.parentElement !== host) host.appendChild(entry.element);
    }
    for (const child of Array.from(host.children)) {
      if (child instanceof HTMLVideoElement && !keep.has(child)) host.removeChild(child);
    }
  }, [mediaElements]);

  return (
    <>
      <div
        ref={hostRef}
        data-testid="floating-audio-host"
        className={styles.host}
        aria-hidden="true"
      />
      {lanes.length > 0 && (
        <section
          data-testid="floating-audio-player"
          aria-label="悬浮播放组件"
          className={collapsed ? styles.mini : styles.panel}
        >
          {collapsed ? (
            <div className={styles.miniRow}>
              <span className={styles.miniText}>♪ 在听 {lanes.length} 路</span>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="展开"
                onClick={() => setCollapsed(false)}
              >
                ▢
              </button>
            </div>
          ) : (
            <>
              <header className={styles.header}>
                <span className={styles.title}>正在收听（{lanes.length}路）</span>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label="收起"
                  onClick={() => setCollapsed(true)}
                >
                  ─
                </button>
              </header>
              <ul className={styles.lanes}>
                {lanes.map((lane) => (
                  <li key={lane.roomId} className={styles.lane}>
                    <span
                      className={styles.swatch}
                      style={{ backgroundColor: laneColor(lane) ?? "var(--mantine-color-night287-5)" }}
                      aria-hidden="true"
                    />
                    <Link href="/recordings" className={styles.name}>
                      {laneLabel(lane)}
                    </Link>
                    <span
                      className={
                        lane.state === "error" ? styles.stateError : styles.state
                      }
                    >
                      {STATE_TEXT[lane.state]}
                      {lane.state === "error" && (
                        <button
                          type="button"
                          className={styles.retry}
                          aria-label={`重试${laneLabel(lane)}`}
                          onClick={() => audioRegistry.retry(lane.roomId)}
                        >
                          重试
                        </button>
                      )}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={lane.volume}
                      aria-label={`音量${laneLabel(lane)}`}
                      className={styles.volume}
                      onChange={(event) => audioRegistry.setVolume(lane.roomId, Number(event.target.value))}
                    />
                    <button
                      type="button"
                      className={styles.stopButton}
                      aria-label={`停止${laneLabel(lane)}`}
                      onClick={() => audioRegistry.stop(lane.roomId)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={styles.stopAll}
                onClick={() => audioRegistry.stopAll()}
              >
                全部停止
              </button>
            </>
          )}
        </section>
      )}
    </>
  );
}
