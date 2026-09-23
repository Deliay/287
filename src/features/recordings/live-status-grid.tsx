"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { members, type Member } from "@/data/members";
import { fetchRecordingStatus } from "./api";
import type { RecordingStatusItem } from "./types";
import { dispatchRevealGroup } from "./reveal-group";
import { audioRegistry, type AudioLane } from "./live-audio/audio-player-registry";
import styles from "./live-status-grid.module.css";

/** 轮询间隔（FR-2：30 秒）。 */
export const POLL_INTERVAL_MS = 30_000;

export interface RecordingStatusState {
  kind: "loading" | "error" | "ok";
  items: RecordingStatusItem[];
}

export interface RecordingStatusController {
  state: RecordingStatusState;
  retry: () => void;
}

/**
 * 直播状态数据源（技术方案 §3.2）：首拉 + 30s 轮询，
 * `document.hidden` 时暂停轮询，恢复可见立即刷新。
 */
export function useRecordingStatus(): RecordingStatusController {
  const [state, setState] = useState<RecordingStatusState>({ kind: "loading", items: [] });
  /** 请求代次：旧响应（轮询/重试/visibility 叠加）不得覆盖新数据（审核次要5） */
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const response = await fetchRecordingStatus();
      if (seq !== seqRef.current) return;
      setState({ kind: "ok", items: response.items });
    } catch {
      if (seq !== seqRef.current) return;
      setState((prev) => ({ kind: "error", items: prev.items }));
    }
  }, []);

  useEffect(() => {
    // 首拉为异步 fetch，setState 发生在 Promise 回调中（非 effect 内同步写状态）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      seqRef.current += 1; // 卸载后丢弃在途响应
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load]);

  return { state, retry: () => void load() };
}

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function laneFor(lanes: readonly AudioLane[], roomId: number | undefined): AudioLane | undefined {
  if (roomId === undefined) return undefined;
  return lanes.find((lane) => lane.roomId === roomId);
}

interface MemberCardProps {
  member: Member;
  item: RecordingStatusItem | undefined;
  lane: AudioLane | undefined;
}

function ListenButton({ member, item, lane }: MemberCardProps) {
  const recording = item?.state === "recording";
  const roomId = item?.roomId ?? member.roomId;

  if (lane?.state === "loading") {
    return (
      <button type="button" className={styles.listen} disabled aria-label={`加载中${member.name}`}>
        加载中…
      </button>
    );
  }
  if (lane?.state === "error") {
    return (
      <button
        type="button"
        className={styles.listenError}
        aria-label={`重试${member.name}`}
        onClick={() => audioRegistry.retry(lane.roomId)}
      >
        重试
      </button>
    );
  }
  if (lane) {
    return (
      <button
        type="button"
        className={styles.stop}
        aria-label={`停止${member.name}`}
        onClick={() => audioRegistry.stop(lane.roomId)}
      >
        ■ 停止收听
      </button>
    );
  }
  return (
    <button
      type="button"
      className={styles.listen}
      disabled={!recording || roomId === undefined}
      aria-label={`听${member.name}`}
      onClick={() => {
        if (roomId === undefined) return;
        audioRegistry.play(roomId, { label: member.name, colorKey: member.colorKey });
      }}
    >
      ▸ 听直播
    </button>
  );
}

function MemberCard({ member, item, lane }: MemberCardProps) {
  const recording = item?.state === "recording";

  /** 定位并展开对应录播分组（按钮/链接点击除外）——鼠标与键盘共用（审核次要5/次要6） */
  const revealGroup = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    if (element && typeof element.closest === "function" && element.closest("button, a")) return;
    dispatchRevealGroup(member.id);
    const el = document.getElementById(`recordings-group-${member.id}`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    revealGroup(event.target);
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // 焦点在卡片内部按钮/链接上时交由其自身处理（Enter 触发 click）
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    revealGroup(event.target);
  };

  return (
    <article
      data-testid={`live-card-${member.id}`}
      className={styles.card}
      role="button"
      tabIndex={0}
      aria-label={`${member.name} 直播状态卡片，回车定位到录播分组`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <span
        className={styles.bar}
        style={{ backgroundColor: `var(--mantine-color-${member.colorKey}-6)` }}
        aria-hidden="true"
      />
      <header className={styles.cardHeader}>
        <h3 className={styles.name}>
          <span style={{ color: `var(--mantine-color-${member.colorKey}-6)` }}>{member.name}</span>{" "}
          {member.romanName}
        </h3>
        <span className={recording ? styles.badgeLive : styles.badgeIdle}>
          <span
            className={recording ? styles.dotLive : styles.dotIdle}
            aria-hidden="true"
          />
          {recording ? "直播中" : "未开播"}
        </span>
      </header>
      {recording && item?.sessionTitle ? (
        <p className={styles.title}>{item.sessionTitle}</p>
      ) : null}
      <footer className={styles.cardFooter}>
        <time className={styles.updatedAt} dateTime={item?.updatedAt}>
          {item?.updatedAt ? `更新于 ${formatUpdatedAt(item.updatedAt)}` : "更新于 —"}
        </time>
        <ListenButton member={member} item={item} lane={lane} />
      </footer>
    </article>
  );
}

/**
 * 纯展示态网格（FR-2 / FR-3 UI）：四位成员按绿黑白紫顺序的 2×2 卡片，
 * 接口未返回的成员兜底「未开播」；「听直播」接入多路音频注册表。
 * 数据由 props 注入（`state`/`retry`），自身不取数——取数策略见 `LiveStatusGrid`（审核 R9-b）。
 */
function StatusGrid({ state, retry }: RecordingStatusController) {
  const lanes = useSyncExternalStore(
    useCallback((listener: () => void) => audioRegistry.subscribeLanes(listener), []),
    () => audioRegistry.getLanesSnapshot(),
    () => audioRegistry.getLanesSnapshot(),
  );

  return (
    <section aria-labelledby="live-status-heading" className={styles.section}>
      <h2 id="live-status-heading" className={styles.heading}>
        当前直播
      </h2>

      {state.kind === "error" && (
        <div className={styles.error} role="alert">
          <span>直播状态获取失败，请稍后重试。</span>
          <button type="button" className={styles.retry} onClick={retry}>
            重试
          </button>
        </div>
      )}

      <div className={styles.grid}>
        {members.map((member) => {
          const item = state.items.find((candidate) => candidate.mid === member.mid);
          const roomId = item?.roomId ?? member.roomId;
          return (
            <MemberCard
              key={member.id}
              member={member}
              item={item}
              lane={laneFor(lanes, roomId)}
            />
          );
        })}
      </div>
    </section>
  );
}

/** 自持状态源的网格（默认导出形态）：内部发起 recording-status 拉取与轮询。 */
function SelfContainedGrid() {
  const controller = useRecordingStatus();
  return <StatusGrid state={controller.state} retry={controller.retry} />;
}

/**
 * 当前直播状态网格（FR-2 / FR-3 UI）：四位成员按绿黑白紫顺序的 2×2 卡片，
 * 接口未返回的成员兜底「未开播」；「听直播」接入多路音频注册表。
 * 页面可注入 `controller` 以与录播列表共享同一次状态拉取；缺省时自持一份。
 */
export function LiveStatusGrid({ controller }: { controller?: RecordingStatusController } = {}) {
  if (controller) return <StatusGrid state={controller.state} retry={controller.retry} />;
  return <SelfContainedGrid />;
}
