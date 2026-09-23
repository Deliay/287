"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type UIEvent,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { members } from "@/data/members";
import { fetchRoomRecordings, recordingFileUrl } from "../api";
import type { RecordingFile } from "../types";
import { formatDateTime, formatOffset } from "../format";
import {
  DanmakuOverlay,
} from "./danmaku-overlay";
import { useReplayEvents, type FetchEvents } from "./replay-events";
import { segmentBoundsForFile, windowIndexFor, type SegmentBounds } from "./replay-windows";
import {
  SeekWatchdog,
  performSeek as defaultPerformSeek,
  type PerformSeekArgs,
} from "./seek";
import {
  configureBufferForBitrate,
  destroyReplay as defaultDestroyReplay,
  isPlaybackSupported as defaultIsPlaybackSupported,
  pauseReplay,
  resumeReplay,
  startReplay as defaultStartReplay,
  type StartReplayArgs,
} from "./flv-player";
import styles from "./replay-stage.module.css";

/** 倍速档位（FR-5：0.5×–2×）。 */
export const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2] as const;

/** 控件栏静止自动隐藏延时（仅播放中生效）。 */
const CONTROLS_HIDE_MS = 3000;

/** 依赖注入点：单测替换播放器/取数实现，生产走默认实现。 */
export interface ReplayStageDeps {
  startReplay?: (args: StartReplayArgs) => Promise<boolean>;
  destroyReplay?: (url?: string) => void;
  isPlaybackSupported?: () => Promise<boolean>;
  performSeek?: (args: PerformSeekArgs) => Promise<boolean>;
  fetchEvents?: FetchEvents;
}

export interface ReplayStageProps {
  roomId: number;
  file: RecordingFile;
  bounds: SegmentBounds;
  deps?: ReplayStageDeps;
}

interface TimelineEntry {
  eventId: string;
  type: string;
  occurredAt: string;
  offsetSeconds: number;
  sender: string;
  content: string;
}

function entryLabel(entry: TimelineEntry): string {
  const type =
    entry.type === "super_chat"
      ? "SC "
      : entry.type === "gift"
        ? "礼物 "
        : entry.type === "guard_buy"
          ? "舰长 "
          : "";
  return `${type}${entry.sender}：${entry.content}`;
}

/**
 * 回放舞台（设计文档 §2.5）：视频区（播放器 + 弹幕浮层）+ 控件栏 + 事件列表，
 * PC 4/5 + 1/5、移动端上下布局；MSE 不支持降级、seek 中态与失败重试。
 */
export function ReplayStage({ roomId, file, bounds, deps = {} }: ReplayStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);
  const lastWindowRef = useRef(-1);
  /** 当前 seek 的看门狗：seekTo 内登记，续播/失败/卸载路径解除（审核 P1） */
  const watchdogRef = useRef<SeekWatchdog | null>(null);
  /** seek 代次：过期 seek 的回调一律丢弃（审核 P3-b） */
  const seekTokenRef = useRef(0);
  /** 最近一次 seek 目标（重试按钮用） */
  const lastSeekRef = useRef<number | null>(null);
  /** 续播判定上下文：从 pre-seek 位置到 target 的移动视为恢复 */
  const seekResumeRef = useRef<{ token: number; from: number | null; target: number } | null>(null);

  const url = recordingFileUrl(roomId, file.name);
  const recordStartMs = bounds.startMs;
  const boundsDuration =
    Number.isFinite(bounds.startMs) && Number.isFinite(bounds.endMs) && bounds.endMs > bounds.startMs
      ? (bounds.endMs - bounds.startMs) / 1000
      : 0;

  const [supported, setSupported] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(boundsDuration);
  /** 已缓冲区间末端（秒）：来自 `video.buffered`，进度条「已缓冲」段用（审核 P2） */
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [seekError, setSeekError] = useState<string | null>(null);
  /** 进度条拖动预览值：松开才真正 seek（审核 P3-a） */
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const volumeBeforeMuteRef = useRef(1);
  const [rate, setRate] = useState(1);
  const [danmakuEnabled, setDanmakuEnabled] = useState(true);
  const [controlsIdle, setControlsIdle] = useState(false);
  const [controlsActivity, setControlsActivity] = useState(0);
  const [following, setFollowing] = useState(true);

  const startReplay = deps.startReplay ?? defaultStartReplay;
  const destroyReplay = deps.destroyReplay ?? defaultDestroyReplay;
  const detectSupport = deps.isPlaybackSupported ?? defaultIsPlaybackSupported;
  const performSeekFn = deps.performSeek ?? defaultPerformSeek;

  const { events, eventsFor, loading, error, focusWindow, prefetchNext, retry } = useReplayEvents(
    roomId,
    { startMs: recordStartMs, endMs: bounds.endMs },
    deps.fetchEvents,
  );

  const member = useMemo(
    () => (file.info ? members.find((candidate) => candidate.mid === file.info?.mid) : undefined),
    [file.info],
  );
  const title = file.info?.title?.trim() || file.name;

  // 窗口化渲染（技术方案 §5-4 风险缓解 / 审核 P4）：
  // 仅取「当前及相邻窗口」的事件，长录播累积上万条也不全量挂载 DOM。
  const windowedEvents = useMemo(
    () => eventsFor(currentTime * 1000),
    // events 进入依赖：窗口取数源自 store 内部快照，快照（events）变更后需按新窗口重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventsFor, events, currentTime],
  );

  const entries = useMemo<TimelineEntry[]>(() => {
    if (!Number.isFinite(recordStartMs)) return [];
    const mapped: TimelineEntry[] = [];
    for (const event of windowedEvents) {
      const offset = Date.parse(event.occurredAt) - recordStartMs;
      if (!Number.isFinite(offset)) continue;
      mapped.push({
        eventId: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt,
        offsetSeconds: offset / 1000,
        sender: event.sender.name,
        content: event.content ?? (event.type === "danmaku" ? "" : event.type),
      });
    }
    mapped.sort((a, b) => a.offsetSeconds - b.offsetSeconds);
    return mapped;
  }, [windowedEvents, recordStartMs]);

  const currentIndex = useMemo(() => {
    let index = -1;
    for (let i = 0; i < entries.length; i += 1) {
      if (entries[i].offsetSeconds <= currentTime) index = i;
      else break;
    }
    return index;
  }, [entries, currentTime]);

  // MSE 支持探测 → 初始化回放播放器（不支持时降级，不初始化）
  useEffect(() => {
    let active = true;
    void detectSupport().then((ok) => {
      if (active) setSupported(ok);
    });
    return () => {
      active = false;
    };
  }, [detectSupport]);

  useEffect(() => {
    if (supported !== true) return;
    const media = videoRef.current;
    if (!media) return;
    setFailed(false);
    void startReplay({
      url,
      media,
      fileSize: file.size,
      onError: () => setFailed(true),
    }).then((started) => {
      if (!started) setSupported(false);
    });
    return () => destroyReplay(url);
  }, [supported, url, file.size, startReplay, destroyReplay]);

  // seek 看门狗：卸载清理
  useEffect(
    () => () => {
      watchdogRef.current?.disarm();
      watchdogRef.current = null;
    },
    [],
  );

  // 控件栏：播放中静止 3s 自动隐藏，移动鼠标重现（未播放时始终显示，无需写状态）
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setControlsIdle(true), CONTROLS_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [playing, controlsActivity]);

  const handleMediaEvent = useCallback(
    (media: HTMLVideoElement) => {
      setCurrentTime(media.currentTime);
      const mediaDuration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
      if (mediaDuration > 0) {
        setDuration((previous) => {
          if (previous === mediaDuration) return previous;
          configureBufferForBitrate(file.size, mediaDuration);
          return mediaDuration;
        });
      }
      // 已缓冲区间末端（进度条「已缓冲」段，审核 P2）
      let bufferedTo = 0;
      try {
        const ranges = media.buffered;
        for (let index = 0; index < (ranges?.length ?? 0); index += 1) {
          bufferedTo = Math.max(bufferedTo, ranges.end(index));
        }
      } catch {
        // buffered 不可用：保持 0
      }
      setBufferedEnd(bufferedTo);

      // 续播恢复判定：currentTime 离开 pre-seek 位置或到达目标 → 解除看门狗（审核 P1）
      const resume = seekResumeRef.current;
      if (watchdogRef.current && resume && resume.token === seekTokenRef.current) {
        const moved = resume.from !== null && media.currentTime !== resume.from;
        const reached = Math.abs(media.currentTime - resume.target) <= 1;
        if (moved || reached) {
          watchdogRef.current.disarm();
          watchdogRef.current = null;
          seekResumeRef.current = null;
          setSeeking(false);
        }
      }
      // 注意：不在这里无条件 setSeeking(false)——seek 中态由 seek 生命周期收敛（审核 P3-c）
    },
    [file.size],
  );

  // 播放推进：切换关注窗口 + 过半预取下一窗
  useEffect(() => {
    if (!Number.isFinite(recordStartMs)) return;
    const offset = currentTime * 1000;
    const index = windowIndexFor(offset);
    if (index !== lastWindowRef.current) {
      lastWindowRef.current = index;
      focusWindow(index);
    }
    prefetchNext(offset);
  }, [recordStartMs, currentTime, focusWindow, prefetchNext]);

  // 事件列表自动跟随高亮
  useEffect(() => {
    if (!following || currentIndex < 0) return;
    const container = listRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-index="${currentIndex}"]`);
    if (!container || !target) return;
    programmaticScrollRef.current = true;
    container.scrollTop = Math.max(0, target.offsetTop - container.clientHeight / 2);
    const release = () => {
      programmaticScrollRef.current = false;
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(release);
    else window.setTimeout(release, 0);
  }, [following, currentIndex]);

  /** 进度条预览值（ref 作为提交幂等的真源：pointerup + mouseup 双事件只提交一次） */
  const draftRef = useRef<number | null>(null);

  const seekTo = useCallback(
    (offsetSeconds: number) => {
      if (!Number.isFinite(offsetSeconds) || offsetSeconds < 0) return;
      draftRef.current = null;
      setDraftTime(null);
      const token = ++seekTokenRef.current;
      // 新 seek 接管：先解除上一轮看门狗，避免过期超时误报（审核 P1）
      watchdogRef.current?.disarm();
      watchdogRef.current = null;
      lastSeekRef.current = offsetSeconds;
      setSeekError(null);
      setSeeking(true);
      const media = videoRef.current;
      seekResumeRef.current = { token, from: media ? media.currentTime : null, target: offsetSeconds };

      const watchdog = new SeekWatchdog(() => {
        if (seekTokenRef.current !== token) return;
        watchdogRef.current = null;
        seekResumeRef.current = null;
        setSeeking(false);
        setSeekError("seek 超时：15 秒内未恢复播放");
      });
      // 登记进 watchdogRef：续播/卸载路径据此可靠解除（审核 P1）
      watchdogRef.current = watchdog;

      void performSeekFn({
        video: media,
        url,
        targetSeconds: offsetSeconds,
        durationSeconds: duration,
        fileSize: file.size,
        onSeeking: () => {
          if (seekTokenRef.current !== token) return;
          setSeeking(true);
        },
        onFailed: (reason) => {
          // 过期 seek 的失败一律丢弃，不得覆盖最终 seek 的状态（审核 P3-b）
          if (seekTokenRef.current !== token) return;
          watchdog.disarm();
          if (watchdogRef.current === watchdog) watchdogRef.current = null;
          setSeeking(false);
          setSeekError(reason);
        },
        watchdog,
      }).then((ok) => {
        if (seekTokenRef.current !== token) return;
        if (ok) {
          // 成功分支：已缓冲路径会同步落位 → 立即收敛；
          // 未缓冲路径保持 seek 中态，直到续播恢复 / 失败 / 看门狗（审核 P3-c）
          const media2 = videoRef.current;
          if (media2 && Math.abs(media2.currentTime - offsetSeconds) <= 1) {
            watchdog.disarm();
            if (watchdogRef.current === watchdog) watchdogRef.current = null;
            setSeeking(false);
          }
          return;
        }
        // performSeek 返回 false 但未回调 onFailed 时兜底显性报错（同样受代次保护）
        watchdog.disarm();
        if (watchdogRef.current === watchdog) watchdogRef.current = null;
        setSeeking(false);
        setSeekError((previous) => previous ?? "seek 失败：无法跳转到该时间点");
      });
      if (Number.isFinite(recordStartMs)) {
        const index = windowIndexFor(offsetSeconds * 1000);
        lastWindowRef.current = index;
        focusWindow(index);
      }
      setCurrentTime(offsetSeconds);
    },
    [url, duration, file.size, performSeekFn, recordStartMs, focusWindow],
  );

  /** 进度条松开/键盘抬起才提交 seek（设计 §2.5「拖动松开后开始 seek」，审核 P3-a） */
  const commitDraft = useCallback(() => {
    const value = draftRef.current;
    if (value === null) return;
    draftRef.current = null;
    setDraftTime(null);
    if (Math.abs(value - currentTime) > 0.05) seekTo(value);
  }, [currentTime, seekTo]);

  const handleListScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    setFollowing(false);
  }, []);

  const handleManualScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (programmaticScrollRef.current) return;
    const container = event.currentTarget;
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance > 8) setFollowing(false);
  }, []);

  const resumeFollowing = useCallback(() => {
    setFollowing(true);
  }, []);

  /** 重现控件栏（移动鼠标 / 触摸，次要7） */
  const revealControls = useCallback(() => {
    if (controlsIdle) setControlsIdle(false);
    setControlsActivity((value) => value + 1);
  }, [controlsIdle]);

  const togglePlay = () => {
    if (playing) {
      pauseReplay();
      setPlaying(false);
    } else {
      resumeReplay();
      setPlaying(true);
    }
  };

  const handleRateChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = Number(event.target.value);
    setRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  const handleFullscreen = () => {
    const container = containerRef.current;
    if (container && typeof container.requestFullscreen === "function") {
      void container.requestFullscreen().catch(() => {});
    }
  };

  const seekFailed = seekError !== null;

  return (
    <div className={styles.stage} data-testid="replay-stage">
      <header className={styles.pageHeader}>
        <Link href="/recordings" className={styles.back}>
          ← 返回录播列表
        </Link>
        <div className={styles.headings}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.meta}>
            {member ? `${member.name} ${member.romanName} · ` : ""}
            录制于 {formatDateTime(file.info?.startedAt ?? file.createdAt)}
          </p>
        </div>
      </header>

      <div className={styles.layout}>
        <div
          className={styles.videoColumn}
          ref={containerRef}
          data-testid="video-column"
          onMouseMove={revealControls}
          onTouchStart={revealControls}
        >
          {supported === false ? (
            <div className={styles.degrade} role="alert" data-testid="mse-degrade">
              当前浏览器无法播放，请使用最新版 Chrome / Edge / Safari
            </div>
          ) : (
            <div className={styles.videoArea}>
              <video
                ref={videoRef}
                aria-label="录播视频"
                playsInline
                className={styles.video}
                onTimeUpdate={(event) => handleMediaEvent(event.currentTarget)}
                onLoadedMetadata={(event) => handleMediaEvent(event.currentTarget)}
                onDurationChange={(event) => handleMediaEvent(event.currentTarget)}
                onProgress={(event) => handleMediaEvent(event.currentTarget)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
              {Number.isFinite(recordStartMs) && (
                <DanmakuOverlay
                  events={events}
                  recordStartMs={recordStartMs}
                  currentTime={currentTime}
                  playing={playing}
                  enabled={danmakuEnabled}
                />
              )}

              {seeking && (
                <div className={styles.overlayState} role="status" aria-label="缓冲中">
                  缓冲中…
                </div>
              )}
              {seekFailed && (
                <div className={styles.overlayError} role="alert">
                  <span>{seekError}</span>
                  <button
                    type="button"
                    onClick={() => lastSeekRef.current !== null && seekTo(lastSeekRef.current)}
                  >
                    重试
                  </button>
                </div>
              )}
              {failed && (
                <div className={styles.overlayError} role="alert">
                  播放失败，请稍后重试。
                </div>
              )}
            </div>
          )}

          {supported !== false && (
            <div
              className={playing && controlsIdle ? styles.controlsHidden : styles.controls}
              data-controls={playing && controlsIdle ? "hidden" : "visible"}
              onMouseMove={revealControls}
              role="group"
              aria-label="播放控件"
            >
              <button type="button" aria-label={playing ? "暂停" : "播放"} onClick={togglePlay}>
                {playing ? "⏸" : "▶"}
              </button>

              <div className={styles.progressWrap}>
                {/* 三段配色（设计 §2.5）：未加载 287-7 轨道 / 已缓冲 287-5 / 已播放 成员色 */}
                <div className={styles.progressTrack} aria-hidden="true">
                  <div
                    className={styles.buffered}
                    data-testid="buffered-bar"
                    style={{
                      width: duration > 0 ? `${Math.min(100, (bufferedEnd / duration) * 100)}%` : "0%",
                    }}
                  />
                  <div
                    className={styles.played}
                    data-testid="played-bar"
                    style={{
                      width: duration > 0 ? `${Math.min(100, (currentTime / duration) * 100)}%` : "0%",
                      backgroundColor: member
                        ? `var(--mantine-color-${member.colorKey}-6)`
                        : "var(--mantine-color-night287-4)",
                    }}
                  />
                </div>
                <input
                  type="range"
                  aria-label="播放进度"
                  min={0}
                  max={duration > 0 ? duration : 0}
                  step={0.1}
                  value={Math.min(
                    draftTime ?? currentTime,
                    duration > 0 ? duration : currentTime,
                  )}
                  disabled={seeking || duration <= 0}
                  style={{
                    accentColor: member
                      ? `var(--mantine-color-${member.colorKey}-6)`
                      : "var(--mantine-color-night287-4)",
                  }}
                  // 拖动中仅更新预览；松开（pointer/mouse/touch）或键盘抬起才提交 seek（审核 P3-a）
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    draftRef.current = next;
                    setDraftTime(next);
                  }}
                  onPointerUp={commitDraft}
                  onMouseUp={commitDraft}
                  onTouchEnd={commitDraft}
                  onKeyUp={(event) => {
                    if (
                      [
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                        "Home",
                        "End",
                        "PageUp",
                        "PageDown",
                      ].includes(event.key)
                    ) {
                      commitDraft();
                    }
                  }}
                />
              </div>
              <span className={styles.time} aria-label="播放时间">
                {formatOffset(currentTime)} / {formatOffset(duration)}
              </span>

              <label className={styles.volume}>
                <span aria-hidden="true">🔊</span>
                <input
                  type="range"
                  aria-label="音量"
                  min={0}
                  max={1}
                  step={0.1}
                  value={volume}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setVolume(next);
                    if (next > 0) setMuted(false);
                    if (videoRef.current) videoRef.current.volume = next;
                  }}
                />
              </label>
              {/* 移动端仅静音切换（设计 §2.5，次要7）：CSS 控制滑杆/按钮的显隐 */}
              <button
                type="button"
                className={styles.muteButton}
                aria-label={muted ? "取消静音" : "静音"}
                onClick={() => {
                  if (muted) {
                    const restored = volumeBeforeMuteRef.current;
                    setVolume(restored);
                    setMuted(false);
                    if (videoRef.current) videoRef.current.volume = restored;
                  } else {
                    volumeBeforeMuteRef.current = volume;
                    setVolume(0);
                    setMuted(true);
                    if (videoRef.current) videoRef.current.volume = 0;
                  }
                }}
              >
                {muted ? "🔇" : "🔊"}
              </button>

              <select aria-label="倍速" value={rate} onChange={handleRateChange}>
                {PLAYBACK_RATES.map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>

              <button type="button" aria-label="全屏" onClick={handleFullscreen}>
                ⛶
              </button>

              <button
                type="button"
                aria-label="弹幕开关"
                aria-pressed={danmakuEnabled}
                onClick={() => setDanmakuEnabled((value) => !value)}
              >
                弹幕{danmakuEnabled ? "开" : "关"}
              </button>
            </div>
          )}
        </div>

        <section className={styles.timeline} aria-label="事件列表">
          {!following && (
            <button type="button" className={styles.followButton} onClick={resumeFollowing}>
              回到底部跟随
            </button>
          )}
          <div
            ref={listRef}
            data-testid="event-list"
            className={styles.list}
            onScroll={handleListScroll}
            onWheel={handleManualScroll}
          >
            {error && (
              <div className={styles.listState}>
                <p>弹幕事件加载失败。</p>
                <button type="button" onClick={retry}>
                  重试
                </button>
              </div>
            )}
            {!error && loading && entries.length === 0 && (
              <p className={styles.listState} role="status">
                正在加载弹幕事件…
              </p>
            )}
            {!error && !loading && entries.length === 0 && (
              <p className={styles.listState}>本场直播暂无弹幕事件</p>
            )}
            {entries.map((entry, index) => (
              <button
                key={entry.eventId}
                type="button"
                data-index={index}
                data-current={index === currentIndex ? "true" : undefined}
                className={index === currentIndex ? styles.entryCurrent : styles.entry}
                onClick={() => seekTo(entry.offsetSeconds)}
              >
                <span className={styles.entryTime}>{formatOffset(entry.offsetSeconds)}</span>
                <span className={styles.entryText}>{entryLabel(entry)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

interface ReplayViewProps {
  /** 测试可注入舞台依赖；生产缺省。 */
  deps?: ReplayStageDeps;
}

type ResolveState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "error" }
  | { kind: "notfound" }
  | { kind: "ok"; file: RecordingFile; bounds: SegmentBounds };

/**
 * 回放页客户端：解析并校验 `roomId` / `file`、回源 recordings 列表取文件元信息
 * 与分段边界（T9 锚点），再装配 `ReplayStage`。参数缺失/回源失败均给出明确文案，不白屏。
 */
export function ReplayView({ deps }: ReplayViewProps = {}) {
  const params = useSearchParams();
  const roomIdRaw = params.get("roomId");
  const fileParam = params.get("file");
  const roomId = roomIdRaw !== null && /^\d+$/.test(roomIdRaw) ? Number(roomIdRaw) : null;
  const valid = roomId !== null && roomId > 0 && Boolean(fileParam);
  const requestKey = valid && fileParam ? `${roomId}\u0000${fileParam}` : null;

  const [resolved, setResolved] = useState<{ key: string; state: ResolveState } | null>(null);

  useEffect(() => {
    if (requestKey === null || roomId === null || !fileParam) return;
    let active = true;
    fetchRoomRecordings(roomId)
      .then((response) => {
        if (!active) return;
        const match = response.files.find((candidate) => candidate.name === fileParam);
        if (!match) {
          setResolved({ key: requestKey, state: { kind: "notfound" } });
          return;
        }
        setResolved({
          key: requestKey,
          state: { kind: "ok", file: match, bounds: segmentBoundsForFile(response.files, fileParam) },
        });
      })
      .catch(() => {
        if (!active) return;
        setResolved({ key: requestKey, state: { kind: "error" } });
      });
    return () => {
      active = false;
    };
  }, [requestKey, roomId, fileParam]);

  const state: ResolveState =
    resolved !== null && resolved.key === requestKey
      ? resolved.state
      : requestKey === null
        ? { kind: "invalid" }
        : { kind: "loading" };

  if (state.kind === "invalid") {
    return (
      <div className={styles.message} role="alert" data-testid="replay-invalid">
        <p>参数无效：缺少有效的 roomId 或 file。</p>
        <Link href="/recordings">← 返回录播列表</Link>
      </div>
    );
  }
  if (state.kind === "loading") {
    return (
      <div className={styles.message} role="status">
        正在加载录播…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className={styles.message} role="alert">
        <p>录播信息加载失败，请稍后重试。</p>
        <Link href="/recordings">← 返回录播列表</Link>
      </div>
    );
  }
  if (state.kind === "notfound") {
    return (
      <div className={styles.message} role="alert">
        <p>录播不存在或已删除。</p>
        <Link href="/recordings">← 返回录播列表</Link>
      </div>
    );
  }

  return <ReplayStage roomId={roomId as number} file={state.file} bounds={state.bounds} deps={deps} />;
}
