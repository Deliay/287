/**
 * 多路音频注册表（技术方案 §3.2 / §4.2）：按 roomId 维护至多 4 路「听直播」。
 *
 * 与参考站的模块级单例播放器不同，这里每路持有独立媒体元素与独立播放器实例，
 * 各路启停互不影响（AC-3 的核心改进点）；模块级单例 + 订阅快照供
 * `useSyncExternalStore` 消费（状态卡片按钮与悬浮组件共用同一状态源）。
 */

import { liveAudioUrl } from "../api";

/** 同时收听上限（= 成员数）。 */
export const MAX_AUDIO_LANES = 4;

/** MSE 不可用标记（错误 code）：浏览器无 MSE 时进入**不可重试**的降级态（审核 R12-b）。 */
export const MSE_UNSUPPORTED_CODE = "MSE_UNSUPPORTED";

/** 与设计 §2.5 / PRD §5 一致的降级文案（状态卡片与悬浮组件同步呈现）。 */
export const MSE_DEGRADE_TEXT = "当前浏览器无法播放，请使用最新版 Chrome / Edge / Safari";

/**
 * 单路状态：加载中 / 播放中 / 失败 / **MSE 不可用降级**（审核 R12-b 新增）。
 * 失败仅影响本路（FR-3）；降级态为环境性不可用，不提供重试。
 */
export type LaneState = "loading" | "playing" | "error" | "unsupported";

/** 对外只读的单路快照。 */
export interface AudioLane {
  roomId: number;
  state: LaneState;
  volume: number;
  /** 展示用成员名（悬浮组件/卡片标题），缺省回退「直播间 {roomId}」。 */
  label?: string;
  /** 成员调色盘键（色块/强调色），可缺省。 */
  colorKey?: string;
}

/** 播放时可选携带的展示元信息（成员名与调色）。 */
export interface LaneMeta {
  label: string;
  colorKey: string;
}

/** 单路媒体元素（挂载到悬浮组件宿主，root layout 内跨路由存活）。 */
export interface LaneMedia {
  roomId: number;
  element: HTMLVideoElement;
}

/** 注册表持有的播放器能力（mpegts 实例或测试替身）。 */
export interface LivePlayer {
  setVolume(volume: number): void;
  destroy(): void;
}

export interface LivePlayerRequest {
  url: string;
  media: HTMLVideoElement;
  volume: number;
  onReady: () => void;
  onError: () => void;
}

/** 播放器工厂：异步创建（mpegts 动态 import），测试注入同步替身。 */
export type LivePlayerFactory = (request: LivePlayerRequest) => LivePlayer | Promise<LivePlayer>;

interface LaneRecord {
  roomId: number;
  state: LaneState;
  volume: number;
  media: HTMLVideoElement;
  player: LivePlayer | null;
  meta?: LaneMeta;
  /** 就绪事件先于异步 settle 到达时挂起，settle 后据此进入 playing（审核次要4） */
  readyPending?: boolean;
  /** 创建代次：stop/重试后丢弃过期的异步创建结果。 */
  generation: number;
}

function createMediaElement(): HTMLVideoElement {
  const media = document.createElement("video");
  media.muted = false;
  media.playsInline = true;
  media.setAttribute("aria-hidden", "true");
  media.dataset.laneMedia = "true";
  return media;
}

/** 注册表实现：可独立实例化（测试用），生产走模块级单例。 */
export class AudioPlayerRegistry {
  private readonly lanes = new Map<number, LaneRecord>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly AudioLane[] = Object.freeze([]);
  private mediaSnapshot: readonly LaneMedia[] = Object.freeze([]);

  constructor(private readonly factory: LivePlayerFactory) {}

  /** 开始收听某房间；幂等，超过 4 路拒绝并返回 false。`meta` 携带成员名/调色供悬浮组件展示。 */
  play(roomId: number, meta?: LaneMeta): boolean {
    const existing = this.lanes.get(roomId);
    if (existing) return true;
    if (this.lanes.size >= MAX_AUDIO_LANES) return false;

    const lane: LaneRecord = {
      roomId,
      state: "loading",
      volume: 1,
      media: createMediaElement(),
      player: null,
      meta,
      generation: 0,
    };
    this.lanes.set(roomId, lane);
    this.invalidate();
    this.spawn(lane, liveAudioUrl(roomId));
    return true;
  }

  /** 停止单路并释放其播放器/媒体元素。 */
  stop(roomId: number): void {
    const lane = this.lanes.get(roomId);
    if (!lane) return;
    lane.generation += 1;
    lane.player?.destroy();
    lane.player = null;
    this.lanes.delete(roomId);
    this.invalidate();
  }

  /** 停止全部（悬浮组件「全部停止」）。 */
  stopAll(): void {
    if (this.lanes.size === 0) return;
    for (const lane of this.lanes.values()) {
      lane.generation += 1;
      lane.player?.destroy();
      lane.player = null;
    }
    this.lanes.clear();
    this.invalidate();
  }

  /** 独立音量（0–1），仅作用于指定路。 */
  setVolume(roomId: number, volume: number): void {
    const lane = this.lanes.get(roomId);
    if (!lane) return;
    const next = Math.min(Math.max(volume, 0), 1);
    if (lane.volume === next) return;
    lane.volume = next;
    lane.player?.setVolume(next);
    this.invalidate();
  }

  /** 失败重试：销毁旧实例并以同音量重建（FR-3 重试入口）；MSE 降级态不可重试（审核 R12-b）。 */
  retry(roomId: number): boolean {
    const lane = this.lanes.get(roomId);
    if (!lane) return false;
    if (lane.state === "unsupported") return false;
    lane.generation += 1;
    lane.player?.destroy();
    lane.player = null;
    lane.state = "loading";
    this.invalidate();
    this.spawn(lane, liveAudioUrl(roomId));
    return true;
  }

  subscribeLanes(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 只读快照：无变更时保持同一引用（useSyncExternalStore 契约）。 */
  getLanesSnapshot(): readonly AudioLane[] {
    return this.snapshot;
  }

  /** 各路媒体元素（供悬浮组件宿主按序挂载）。 */
  getMediaElements(): readonly LaneMedia[] {
    return this.mediaSnapshot;
  }

  private spawn(lane: LaneRecord, url: string): void {
    const generation = lane.generation;
    const isCurrent = () => this.lanes.get(lane.roomId) === lane && lane.generation === generation;
    // 每代创建都复位就绪标记：上一代残留的 readyPending 不得让新 player 未经就绪即显「播放中」（审核 R12-d）
    lane.readyPending = false;
    const toLaneError = () => {
      lane.readyPending = false; // 失败必须同时作废就绪挂起（审核 R12-d(1)）
      // 已是 unsupported（环境性降级）时不再降为 error（审核 次-6：直白分支，不用 as 掩盖收窄）
      if (lane.state !== "unsupported") lane.state = "error";
    };
    const markUnsupported = () => {
      lane.readyPending = false;
      lane.state = "unsupported"; // 环境性不可用：不进 error、不提供重试（审核 R12-b）
    };

    let result: LivePlayer | Promise<LivePlayer>;
    try {
      result = this.factory({
        url,
        media: lane.media,
        volume: lane.volume,
        onReady: () => {
          if (!isCurrent()) return;
          // 就绪可能先于异步 settle 到达（mpegts 动态 import）→ 挂起，settle 时消费（审核次要4）
          if (lane.player) lane.state = "playing";
          else lane.readyPending = true;
          this.invalidate();
        },
        onError: () => {
          if (!isCurrent()) return;
          toLaneError();
          this.invalidate();
        },
      });
    } catch (error) {
      if (!isCurrent()) return;
      if ((error as { code?: string } | null)?.code === MSE_UNSUPPORTED_CODE) markUnsupported();
      else toLaneError();
      this.invalidate();
      return;
    }

    const settle = (player: LivePlayer) => {
      if (!isCurrent()) {
        // 创建期间该路已被停止/重建：立即释放，避免泄漏
        player.destroy();
        return;
      }
      lane.player = player;
      player.setVolume(lane.volume);
      if (lane.readyPending) {
        lane.state = "playing";
        lane.readyPending = false;
      }
      this.invalidate();
    };

    if (result instanceof Promise) {
      void result.then(settle).catch((error: unknown) => {
        if (!isCurrent()) return;
        if ((error as { code?: string } | null)?.code === MSE_UNSUPPORTED_CODE) markUnsupported();
        else toLaneError();
        this.invalidate();
      });
    } else {
      settle(result);
    }
  }

  private invalidate(): void {
    this.snapshot = Object.freeze(
      [...this.lanes.values()].map((lane) =>
        Object.freeze({
          roomId: lane.roomId,
          state: lane.state,
          volume: lane.volume,
          ...(lane.meta ? { label: lane.meta.label, colorKey: lane.meta.colorKey } : {}),
        }),
      ),
    );
    this.mediaSnapshot = Object.freeze(
      [...this.lanes.values()].map((lane) => Object.freeze({ roomId: lane.roomId, element: lane.media })),
    );
    for (const listener of this.listeners) listener();
  }
}

/**
 * 默认播放器工厂：动态加载 mpegts.js（补丁版）拉起 FLV 直播流。
 * `MEDIA_INFO` 视为就绪（进入 playing），`ERROR` 视为本路失败。
 */
const defaultLivePlayerFactory: LivePlayerFactory = async ({ url, media, volume, onReady, onError }) => {
  const mpegts = (await import("mpegts.js")).default;
  // MSE 探测（照 flv-player.ts 模式）：不可用时以 MSE_UNSUPPORTED_CODE 上抛，
  // 由注册表转为不可重试的 unsupported 降级态——生产路径唯一抛出点（PRD §5 / 提案 §5 风险5，审核 R13-a）
  if (!mpegts.isSupported()) {
    const error: Error & { code?: string } = new Error(MSE_DEGRADE_TEXT);
    error.code = MSE_UNSUPPORTED_CODE;
    throw error;
  }
  media.volume = volume;
  const player = mpegts.createPlayer({ type: "flv", isLive: true, url });
  const handleReady = () => onReady();
  const handleError = () => onError();
  player.on(mpegts.Events.MEDIA_INFO, handleReady);
  player.on(mpegts.Events.ERROR, handleError);
  player.attachMediaElement(media);
  player.load();
  // play() 在部分实现返回 void，统一按 Promise 处理失败回调
  void Promise.resolve(player.play()).catch(() => onError());
  return {
    setVolume(next: number) {
      media.volume = next;
    },
    destroy() {
      try {
        player.off(mpegts.Events.MEDIA_INFO, handleReady);
        player.off(mpegts.Events.ERROR, handleError);
        player.destroy();
      } catch {
        // destroy 失败忽略（元素随宿主卸载）
      }
    },
  };
};

let livePlayerFactory: LivePlayerFactory = defaultLivePlayerFactory;

/**
 * 替换全局播放器工厂（依赖注入：测试替身 / 宿主定制）。
 * 返回还原函数，测试用完务必还原。
 */
export function setLivePlayerFactory(factory: LivePlayerFactory): () => void {
  const previous = livePlayerFactory;
  livePlayerFactory = factory;
  return () => {
    livePlayerFactory = previous;
  };
}

/** 便捷工厂：创建彼此隔离的独立实例（单测用）。 */
export function createAudioPlayerRegistry(factory: LivePlayerFactory): AudioPlayerRegistry {
  return new AudioPlayerRegistry(factory);
}

/** 模块级单例：悬浮组件与状态卡片共享同一注册表（跨路由存活，AC-8）。 */
export const audioRegistry: AudioPlayerRegistry = new AudioPlayerRegistry((request) =>
  livePlayerFactory(request),
);
