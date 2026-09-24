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
import {
  IconArrowLeft,
  IconFullscreen,
  IconPause,
  IconPlay,
  IconVolume,
  IconVolumeMute,
} from "@/components/icons";
import { members } from "@/data/members";
import { fetchRoomRecordings, recordingFileUrl } from "../api";
import type { RecordingFile } from "../types";
import { formatDateTime, formatOffset } from "../format";
import {
  DanmakuOverlay,
} from "./danmaku-overlay";
import { useReplayEvents, type FetchEvents } from "./replay-events";
import { segmentBoundsForFile, windowIndexFor, type SegmentBounds, offsetMsFor } from "./replay-windows";
import {
  SEEK_TIMEOUT_MESSAGE,
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

/** mpegts 资源加载失败文案（≠ 设计 §2.5 的 MSE 降级文案，审核 R9-a / 次要5）。 */
const PLAYER_LOAD_ERROR_MESSAGE = "播放器资源加载失败，请重试";

/** 落位判定：以 seek 目标为中心的邻域容差（秒，审核 R1）。 */
const SEEK_LAND_TOLERANCE = 1;
/** 落位判定：单次媒体采样内位移超过该值（秒）视为 seek 跳变落位，而非旧播放的连续推进（审核 R1）。 */
const SEEK_SAMPLE_JUMP_SECONDS = 2;
/** 落位判定容差（秒）：`seeked` 位置与 apply 时采样落点的比对容差（落位动作前后对比，审核 R7-c）。 */
const SEEK_LANDING_EPS = 0.5;
/**
 * `seeked` 归属的「目标窗口」（秒）：位置距本次目标 ≤ 该窗口即认为反映本次落位动作——
 * 覆盖关键帧/RECOMMEND_SEEKPOINT 落点与目标可差一个 GOP（约 8s）的常态（审核 R7-c）。
 */
const SEEK_TARGET_WINDOW_SECONDS = 10;
/**
 * 前次 apply 的补丁残留 clamp 链窗口（ms）：`scheduleSeekAlignment` 为 apply 后 250ms×20 次、
 * 末次恰在 +5.0s，取 **5.0s 链长 + 1.0s 投递余量 = 6.0s**。
 * 仅用于约束 **timeupdate 的跳变/邻域证据**（启发式信号）；`seeked` 一律按位置归属判定，不受此窗约束
 * （时间窗不是归属判据，审核 R7-c）。
 */
const RESIDUAL_CLAMP_WINDOW_MS = 6_000;

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
  /**
   * 本次 seek 的落位监控（审核 R1/R5/R7）：`applied` 表示 performSeek 已生效；
   * `expected` 为 apply 时刻采样的落点（补丁 directSeek 同步写入的 currentTime），
   * 供后续 `seeked`/媒体事件做**落位动作前后对比**的归属判定（审核 R7-c）。
   * 注意：看门狗超时**不**清本监控——迟到的真实落位仍须清除超时浮层（审核 R7-a）。
   * 终结路径共四类（审核 R9-b 口径核对）：① 归属成立的落位（`convergeLanding`）；
   * ② 失败终局（`onFailed` 与 `.then` 兜底清错分支）；③ 新 seek 接管；④ 组件卸载。
   */
  const seekResumeRef = useRef<{
    token: number;
    target: number;
    applied: boolean;
    expected: number | null;
    prevApplyAt: number | null;
  } | null>(null);
  /** 终局作废信号：超时/失败/被新 seek 取代/卸载时 abort 在途 Range 请求与后续 apply（审核 R6-a） */
  const seekAbortRef = useRef<AbortController | null>(null);
  /** 最近一次 performSeek 生效的时间戳：用于识别前次补丁 clamp 链的残留 seeked（审核 R6-c） */
  const lastApplyAtRef = useRef<number | null>(null);
  /** 已被终局作废的 seek 代次（abort 收敛后不再让 .then(false) 覆盖 UI） */
  const abortedTokenRef = useRef<number | null>(null);
  /** 上一次媒体采样时间：用于识别单次采样内的跳变落位（区别于旧播放的连续推进） */
  const lastSampleRef = useRef<number | null>(null);

  const url = recordingFileUrl(roomId, file.name);
  const recordStartMs = bounds.startMs;
  const boundsDuration =
    Number.isFinite(bounds.startMs) && Number.isFinite(bounds.endMs) && bounds.endMs > bounds.startMs
      ? (bounds.endMs - bounds.startMs) / 1000
      : 0;

  const [supported, setSupported] = useState<boolean | null>(null);
  /** 播放器资源加载失败（网络/CDN）：给「加载失败 + 重试」，不走 MSE 降级（审核 R9-a） */
  const [loadError, setLoadError] = useState(false);
  /** 触发探测/起播重试的代次 */
  const [startAttempt, setStartAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(boundsDuration);
  /** 已缓冲区间集合（起止秒）：来自 `video.buffered`，进度条「已缓冲」按区间多段渲染（审核 P2/次要10） */
  const [bufferedRanges, setBufferedRanges] = useState<Array<[number, number]>>([]);
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
      const offset = offsetMsFor(event.occurredAt, recordStartMs);
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
    void detectSupport().then(
      (ok) => {
        if (active) {
          setSupported(ok);
          if (ok) setLoadError(false);
        }
      },
      () => {
        // 资源加载失败 ≠ 浏览器不支持：保持未判定并给「加载失败 + 重试」（审核 R9-a）
        if (active) {
          setSupported(null);
          setLoadError(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [detectSupport, startAttempt]);

  useEffect(() => {
    if (supported !== true) return;
    const media = videoRef.current;
    if (!media) return;
    // cancelled：本 effect 已被取代/卸载时，过期结果（含被代次作废的 false）一律丢弃——
    // 对齐 P3-b「过期回调一律丢弃」的代次纪律（审核 R9-a）
    let cancelled = false;
    let loadFailed = false;
    setFailed(false);
    void startReplay({
      url,
      media,
      fileSize: file.size,
      onError: () => {
        if (!cancelled) setFailed(true);
      },
      onLoadError: () => {
        loadFailed = true;
      },
    }).then((started) => {
      if (cancelled) return;
      if (started) {
        setLoadError(false);
        return;
      }
      if (loadFailed) {
        setLoadError(true); // 加载失败 → 重试文案，不得折算成 MSE 降级（审核 R9-a）
        return;
      }
      // 只有「isSupported() === false」才判设计 §2.5 降级
      setSupported(false);
    });
    return () => {
      cancelled = true;
      destroyReplay(url);
    };
  }, [supported, url, file.size, startReplay, destroyReplay, startAttempt]);

  /** 重试播放器资源加载：重新探测 + 起播（审核 R9-a）。 */
  const retryPlayerLoad = () => {
    setLoadError(false);
    setStartAttempt((value) => value + 1);
  };

  // seek 看门狗 / 在途 Range：卸载即终局作废（看门狗 disarm、在途请求 abort、代次推进使迟到回调失效）
  useEffect(
    () => () => {
      seekTokenRef.current += 1;
      watchdogRef.current?.disarm();
      watchdogRef.current = null;
      seekAbortRef.current?.abort();
      seekAbortRef.current = null;
    },
    [],
  );

  // 控件栏：播放中静止 3s 自动隐藏，移动鼠标重现（未播放时始终显示，无需写状态）
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setControlsIdle(true), CONTROLS_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [playing, controlsActivity]);

  /**
   * 归属成立的落位收敛——**本次 seek 的真实落位是唯一收敛判据**（审核 R7 统一原则）：
   * 解除看门狗、收敛中态，并清除错误浮层（迟到的真实落位不得残留「seek 超时」，R7-a）。
   * 调用方有两处（审核 R9-b 口径核对）：`tryLand()`（任一归属证据成立，证据为并列关系）
   * 与 `performSeek` 成功分支（落点已在目标邻域时即时收敛）。
   */
  const convergeLanding = useCallback(() => {
    watchdogRef.current?.disarm();
    watchdogRef.current = null;
    seekResumeRef.current = null;
    abortedTokenRef.current = null;
    setSeeking(false);
    setSeekError(null);
  }, []);

  /**
   * 落位归属判定（审核 R7-c）——不以 latch 存在性、paused 或裸时间猜窗为判据：
   * - 前置：本次 seek 已生效（applied）且代次一致；飞行期（applied=false）一律不消费（R5-a）；
   * - `seeked`：**位置比对（落位动作前后对比）**——与 apply 时刻采样落点差 ≤0.5s，
   *   或发生位移后落在目标 ±10s（GOP 级）窗口内；不受任何时间窗约束；
   * - 媒体事件（timeupdate 等）：邻域/落点/跳变三类证据，且避开**前次 apply 的残留 clamp 链窗口**
   *   （6.0s = 链长 5.0s + 投递余量 1.0s）——该窗只约束启发式跳变证据，不是归属判据。
   * 残余歧义（如实记录）：前次 clamp 落点恰好落在本次落点 ±0.5s 内的极窄情形，应用层无法仅凭位置区分。
   */
  const tryLand = useCallback(
    (media: HTMLVideoElement, source: "seeked" | "media") => {
      const resume = seekResumeRef.current;
      if (!resume || !resume.applied) return;
      if (resume.token !== seekTokenRef.current) return;
      const current = media.currentTime;
      const expected = resume.expected;
      const nearExpected = expected !== null && Math.abs(current - expected) <= SEEK_LANDING_EPS;
      const nearTarget = Math.abs(current - resume.target) <= SEEK_LAND_TOLERANCE;
      const withinTargetWindow = Math.abs(current - resume.target) <= SEEK_TARGET_WINDOW_SECONDS;
      const movedFromExpected = expected !== null && Math.abs(current - expected) > SEEK_LANDING_EPS;
      const previous = lastSampleRef.current;
      const jumped =
        previous !== null && Math.abs(current - previous) > SEEK_SAMPLE_JUMP_SECONDS;
      const inResidualWindow =
        resume.prevApplyAt !== null && Date.now() - resume.prevApplyAt < RESIDUAL_CLAMP_WINDOW_MS;

      const attributed =
        source === "seeked"
          ? nearExpected || (movedFromExpected && withinTargetWindow)
          : !inResidualWindow && (nearExpected || nearTarget || jumped);
      if (attributed) convergeLanding();
    },
    [convergeLanding],
  );

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
      // 已缓冲区间集合（进度条「已缓冲」段；多区间按段渲染，不以 max(end) 单段高估，审核次要10）
      const ranges: Array<[number, number]> = [];
      try {
        const buffered = media.buffered;
        for (let index = 0; index < (buffered?.length ?? 0); index += 1) {
          ranges.push([buffered.start(index), buffered.end(index)]);
        }
      } catch {
        // buffered 不可用：保持空
      }
      setBufferedRanges((previous) => {
        if (
          previous.length === ranges.length &&
          previous.every((range, index) => range[0] === ranges[index][0] && range[1] === ranges[index][1])
        ) {
          return previous;
        }
        return ranges;
      });

      // 落位归属判定（审核 R7-c）：飞行期不消费；终局后的真实落位仍可收敛并清错（R7-a）
      tryLand(media, "media");
      lastSampleRef.current = media.currentTime;
      // 注意：不在这里无条件 setSeeking(false)——seek 中态由 seek 生命周期收敛（审核 P3-c）
    },
    [file.size, tryLand],
  );

  /** 补丁 directSeek / RECOMMEND_SEEKPOINT 落位后的 `seeked`：按位置归属判定（R7-c），
   *  并同步采样点，避免被丢弃的残留位置污染后续跳变证据。 */
  const handleSeeked = useCallback(() => {
    const media = videoRef.current;
    if (!media) return;
    tryLand(media, "seeked");
    lastSampleRef.current = media.currentTime;
  }, [tryLand]);

  // 播放推进：切换关注窗口 + 过半预取下一窗
  useEffect(() => {
    if (!Number.isFinite(recordStartMs)) return;
    // R15-5：跨窗 seek 期间窗口锚定 seekTo 已聚焦的目标窗——旧播放 timeupdate 回写的旧位置
    // 不得切窗（会中止目标窗在途首拉 → 落位后重拉的双拉与进度回跳）；落位/失败后 seeking 归零自然恢复
    if (seeking) return;
    const offset = currentTime * 1000;
    const index = windowIndexFor(offset);
    if (index !== lastWindowRef.current) {
      lastWindowRef.current = index;
      focusWindow(index);
    }
    prefetchNext(offset);
  }, [recordStartMs, currentTime, seeking, focusWindow, prefetchNext]);

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
      // 新 seek 接管：作废上一轮看门狗与在途 Range/apply，避免过期超时误报与迟到跳转（审核 P1/R6-a）
      watchdogRef.current?.disarm();
      watchdogRef.current = null;
      seekAbortRef.current?.abort();
      const controller = new AbortController();
      seekAbortRef.current = controller;
      lastSeekRef.current = offsetSeconds;
      setSeekError(null);
      setSeeking(true);
      const media = videoRef.current;
      seekResumeRef.current = {
        token,
        target: offsetSeconds,
        applied: false,
        expected: null,
        prevApplyAt: lastApplyAtRef.current,
      };
      lastSampleRef.current = media ? media.currentTime : null;

      const watchdog = new SeekWatchdog(() => {
        if (seekTokenRef.current !== token) return;
        // 终局：作废在途 seek（Range 请求 abort，迟到响应不得再触碰媒体元素，审核 R6-a）；
        // 但**保留落位监控**（seekResumeRef/watchdogRef）——迟到的真实落位仍须清除超时浮层（审核 R7-a）
        controller.abort();
        abortedTokenRef.current = token;
        setSeeking(false);
        setSeekError(SEEK_TIMEOUT_MESSAGE); // 中性文案（生产常量）：播放/暂停两种状态下均成立（审核 R7-b）
      });
      // 登记进 watchdogRef 并**发起即武装**：覆盖网络扫描全阶段，
      // Range 请求挂起也能在 15s 内显性超时（审核 R5-c）；任何结束路径 disarm 为终局（审核 R5-1）
      watchdogRef.current = watchdog;
      watchdog.arm();

      void performSeekFn({
        video: media,
        url,
        targetSeconds: offsetSeconds,
        durationSeconds: duration,
        fileSize: file.size,
        signal: controller.signal,
        onSeeking: () => {
          if (seekTokenRef.current !== token) return;
          setSeeking(true);
        },
        onFailed: (reason) => {
          // 过期 seek 的失败一律丢弃，不得覆盖最终 seek 的状态（审核 P3-b）
          if (seekTokenRef.current !== token) return;
          controller.abort();
          watchdog.disarm();
          if (watchdogRef.current === watchdog) watchdogRef.current = null;
          seekResumeRef.current = null;
          abortedTokenRef.current = token;
          setSeeking(false);
          setSeekError(reason);
        },
        onAborted: () => {
          // 本次 seek 被终局作废（超时/失败/卸载）：不报新错、**不以 paused 清错**（审核 R7-b：
          // 旧播放是否在推进无法区分「seek 失败」与「新位置已续播」，错误必须保留到
          // 归属成立的真实落位 / 用户重试 / 新 seek）。此处只收敛 spinner 与看门狗；
          // 落位监控保留，供迟到的真实落位按归属清错（审核 R7-a）。
          if (seekTokenRef.current !== token) return;
          watchdog.disarm();
          if (watchdogRef.current === watchdog) watchdogRef.current = null;
          abortedTokenRef.current = token;
          setSeeking(false);
        },
        watchdog,
      }).then((ok) => {
        if (seekTokenRef.current !== token) return;
        if (ok) {
          const latch = seekResumeRef.current;
          if (latch && latch.token === token) {
            latch.applied = true;
            // 落位动作前后对比的「后」采样点：apply 时补丁已 directSeek，此刻 currentTime 即落点
            const media2 = videoRef.current;
            latch.expected = media2 ? media2.currentTime : null;
            lastApplyAtRef.current = Date.now();
            // 已缓冲路径/落点已在目标邻域 → 立即收敛；否则交给生效后的 seeked（位置归属）收敛（审核 R1/R7-c）
            if (media2 && Math.abs(media2.currentTime - offsetSeconds) <= SEEK_LAND_TOLERANCE) {
              convergeLanding();
            }
          }
          return;
        }
        // 已被 abort 收敛（onAborted 已处理 UI）：不得再覆盖错误文案
        if (abortedTokenRef.current === token) return;
        // performSeek 返回 false 但未回调 onFailed 时兜底显性报错（同样受代次保护）
        watchdog.disarm();
        if (watchdogRef.current === watchdog) watchdogRef.current = null;
        seekResumeRef.current = null;
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
    [url, duration, file.size, performSeekFn, recordStartMs, focusWindow, convergeLanding],
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
      // 乐观置位；play() 被拒绝（自动播放策略等）时复位，避免假「暂停」按钮态（审核 次-1）
      setPlaying(true);
      void resumeReplay().then((ok) => {
        if (!ok) setPlaying(false);
      });
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
        <div className={styles.backRow}>
          <Link href="/recordings" className={styles.back}>
            <IconArrowLeft /> 返回录播列表
          </Link>
        </div>
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
                onSeeked={handleSeeked}
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

          {loadError && supported !== false && (
            <div className={styles.loadError} role="alert" data-testid="player-load-error">
              <span>{PLAYER_LOAD_ERROR_MESSAGE}</span>
              <button type="button" onClick={retryPlayerLoad}>
                重试
              </button>
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
                {playing ? <IconPause /> : <IconPlay />}
              </button>

              <div className={styles.progressWrap}>
                {/* 三段配色（设计 §2.5）：未加载 287-7 轨道 / 已缓冲 287-5（多区间多段） / 已播放 成员色 */}
                <div className={styles.progressTrack} aria-hidden="true">
                  <div data-testid="buffered-bar" className={styles.bufferedBar}>
                    {bufferedRanges.map(([start, end]) => (
                      <div
                        key={`${start}-${end}`}
                        data-testid="buffered-segment"
                        className={styles.buffered}
                        style={{
                          left: duration > 0 ? `${Math.min(100, (start / duration) * 100)}%` : "0%",
                          width:
                            duration > 0
                              ? `${Math.min(100, (Math.max(0, end - start) / duration) * 100)}%`
                              : "0%",
                        }}
                      />
                    ))}
                  </div>
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
                <span aria-hidden="true">
                  <IconVolume />
                </span>
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
                {muted ? <IconVolumeMute /> : <IconVolume />}
              </button>

              <select aria-label="倍速" value={rate} onChange={handleRateChange}>
                {PLAYBACK_RATES.map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>

              <button type="button" aria-label="全屏" onClick={handleFullscreen}>
                <IconFullscreen />
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
