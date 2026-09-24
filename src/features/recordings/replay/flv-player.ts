/**
 * 回放播放器封装（技术方案 §3.1 / §3.3）：
 * mpegts.js 回放播放器为**页面内生命周期**（离开回放页即销毁，不进悬浮组件，需求 §FR-6），
 * 与「听直播」多路音频注册表互不影响；mpegts 以可注入 loader 加载，便于 MSE 支持探测与单测。
 */

type MpegtsModule = typeof import("mpegts.js");
type Mpegts = MpegtsModule["default"];
type MpegtsPlayer = ReturnType<Mpegts["createPlayer"]>;

/** 播放 buffer 字节预算上限（前瞻 + 回退合计，参考站经验值）。 */
export const BUFFER_BUDGET_BYTES = 50 * 1024 * 1024;
/** 前瞻缓冲占字节预算的比例（其余为回退）。 */
export const FORWARD_BUDGET_RATIO = 0.6;
/** 秒数上限（低码率下防止缓冲窗口过大）。 */
const MAX_BUFFER_SECONDS = 300;
/** 秒数下限（仅防零/负数）。 */
const MIN_BUFFER_SECONDS = 0.1;
/** 时长未知时的保守假定码率（bps）：取高值使初始窗口足够小。 */
const DEFAULT_BITRATE_BPS = 50_000_000;

export interface BufferConfig {
  /** 非 isLive 时 mpegts 默认**不**开启 SourceBuffer 自动清理 → 回退缓冲配置会成为死配置，
   *  必须显式置 true，50MB 字节预算（前瞻 60% + 回退 40%）才完整生效（技术方案 §3.3，审核次要8）。 */
  autoCleanupSourceBuffer: boolean;
  lazyLoadMaxDuration: number;
  lazyLoadRecoverDuration: number;
  autoCleanupMaxBackwardDuration: number;
  autoCleanupMinBackwardDuration: number;
}

function secondsForBudget(budgetBytes: number, bitrate: number): number {
  const raw = (budgetBytes * 8) / bitrate;
  const clamped = Math.min(Math.max(raw, 0), MAX_BUFFER_SECONDS);
  return Math.max(MIN_BUFFER_SECONDS, Math.floor(clamped * 10) / 10);
}

/**
 * 按 `size / duration` 估算码率，把 mpegts 的 lazyLoad / autoCleanup 缓冲窗口
 * 折算到确定性字节预算内（前瞻 60% / 回退 40%，合计 ≤ 50MB）。
 */
export function computeBufferConfig(fileSize: number, durationSeconds: number): BufferConfig {
  const validSize = Number.isFinite(fileSize) && fileSize > 0 ? fileSize : 0;
  const validDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const bitrate = validSize > 0 && validDuration > 0 ? (validSize * 8) / validDuration : DEFAULT_BITRATE_BPS;

  const forwardBytes = BUFFER_BUDGET_BYTES * FORWARD_BUDGET_RATIO;
  const backwardBytes = BUFFER_BUDGET_BYTES * (1 - FORWARD_BUDGET_RATIO);
  return {
    autoCleanupSourceBuffer: true,
    lazyLoadMaxDuration: secondsForBudget(forwardBytes, bitrate),
    lazyLoadRecoverDuration: secondsForBudget(forwardBytes / 6, bitrate),
    autoCleanupMaxBackwardDuration: secondsForBudget(backwardBytes, bitrate),
    autoCleanupMinBackwardDuration: Math.min(secondsForBudget(backwardBytes / 3, bitrate), secondsForBudget(backwardBytes, bitrate)),
  };
}

type MpegtsLike = Pick<Mpegts, "isSupported" | "createPlayer" | "Events">;
export type { MpegtsLike };

let mpegtsLoader: () => Promise<MpegtsLike> = () => import("mpegts.js").then((mod) => mod.default as MpegtsLike);

/** 替换 mpegts 加载器（依赖注入：单测 / 宿主定制），返回还原函数。 */
export function setMpegtsLoader(loader: () => Promise<MpegtsLike>): () => void {
  const previous = mpegtsLoader;
  mpegtsLoader = loader;
  return () => {
    mpegtsLoader = previous;
  };
}

async function loadMpegts(): Promise<MpegtsLike> {
  return mpegtsLoader();
}

/**
 * 浏览器是否支持 MSE 在线播放（iOS Safari 通常为 false → 降级提示）。
 * mpegts 资源加载失败（网络/CDN）会 **reject**，与「不支持」区分——
 * 调用方据此分别给「加载失败 + 重试」与设计 §2.5 降级文案（审核 R9-a，次要5 同构）。
 */
export async function isPlaybackSupported(): Promise<boolean> {
  const mpegts = await loadMpegts();
  return mpegts.isSupported();
}

interface PatchedPlayer extends MpegtsPlayer {
  seekToByteOffset?: (fileposition: number, milliseconds: number) => void;
  setBufferLimits?: (limits: Partial<BufferConfig>) => void;
}

let currentPlayer: PatchedPlayer | null = null;
let currentUrl: string | null = null;

export interface StartReplayArgs {
  url: string;
  media: HTMLVideoElement;
  /** 文件字节大小：按码率折算缓冲预算。 */
  fileSize: number;
  onError: () => void;
  /** 就绪后是否自动播放（回放页缺省不自动播放，规避自动播放拦截）。 */
  autoplay?: boolean;
  /** mpegts 资源加载失败（网络/CDN）回调：与「MSE 不支持」区分，供调用方给「加载失败+重试」（审核 R9-a）。 */
  onLoadError?: () => void;
}

/** start 代次：并发/被取代的 start 不得创建播放器（审核次要8，StrictMode 双 effect 与 URL 快切防泄漏）。 */
let startGeneration = 0;

/**
 * 启动回放播放（页面内单例）。返回 `false` 有**三种原因**（审核 R9-a，JSDoc 与实现对齐）：
 *  1. mpegts.js 资源加载失败（网络/CDN）→ 触发 `onLoadError`，调用方显示「加载失败 + 重试」；
 *  2. `isSupported() === false`（浏览器无 MSE）→ 调用方渲染设计 §2.5 降级文案；
 *  3. **被新的 start/destroy 取代（代次过期）→ 静默语义**：调用方必须丢弃该结果、不得据此改 UI
 *     （否则 StrictMode 双 effect / URL 快切下会把健康实例误判为降级，审核 R9-a）。
 */
export async function startReplay(args: StartReplayArgs): Promise<boolean> {
  destroyReplay(); // 先失效旧实例与所有在途 start
  const token = ++startGeneration;
  let mpegts: MpegtsLike;
  try {
    mpegts = await loadMpegts();
  } catch (error) {
    console.error("[recordings] mpegts.js 加载失败", error);
    args.onLoadError?.();
    return false;
  }
  // 加载期间已被新的 start/destroy 取代：不再创建（审核次要8）
  if (token !== startGeneration) return false;
  if (!mpegts.isSupported()) return false;

  const config = computeBufferConfig(args.fileSize, 0);
  const player = mpegts.createPlayer(
    { type: "flv", isLive: false, url: args.url },
    config,
  ) as PatchedPlayer;
  // 创建后再次校验：被取代则立即释放，避免旧 player 泄漏（审核次要8）
  if (token !== startGeneration) {
    try {
      player.destroy();
    } catch {
      // destroy 失败忽略
    }
    return false;
  }
  if (typeof player.seekToByteOffset !== "function") {
    // 补丁未生效：显性暴露，后续未缓冲 seek 走失败提示（严禁静默冻结）
    console.error("[recordings] mpegts.js 字节偏移续播补丁未生效：实例缺少 seekToByteOffset");
  }
  player.attachMediaElement(args.media);
  player.on(mpegts.Events.ERROR, args.onError);
  player.load();
  if (args.autoplay) {
    // play() 拒绝（自动播放策略等）必须收口：不得留 unhandled rejection（审核 次-1）
    void Promise.resolve(player.play()).catch((error: unknown) => {
      console.error("[recordings] replay play() rejected", error);
      args.onError();
    });
  }
  currentPlayer = player;
  currentUrl = args.url;
  return true;
}

/** 销毁回放播放器（幂等）；传 `url` 时仅当归属匹配才销毁。任何销毁意图都会使在途 start 失效。 */
export function destroyReplay(url?: string): void {
  startGeneration += 1;
  if (url !== undefined && currentUrl !== url) return;
  if (currentPlayer) {
    try {
      currentPlayer.destroy();
    } catch {
      // destroy 失败忽略
    }
  }
  currentPlayer = null;
  currentUrl = null;
}

/** 暂停回放。 */
export function pauseReplay(): void {
  currentPlayer?.pause();
}

/** 继续播放回放：`play()` 被拒绝时捕获并返回 false（调用方据此复位 playing 态，审核 次-1）。 */
export async function resumeReplay(): Promise<boolean> {
  if (!currentPlayer) return false;
  try {
    await currentPlayer.play();
    return true;
  } catch (error) {
    console.error("[recordings] replay resume play() rejected", error);
    return false;
  }
}

/** 从字节偏移续播（依赖补丁方法）；补丁缺失/异常时显性返回 false。 */
export function seekToByteOffset(fileposition: number, milliseconds: number): boolean {
  const player = currentPlayer;
  if (!player) {
    console.error("[recordings] seekToByteOffset: 当前无播放实例");
    return false;
  }
  const apply = player.seekToByteOffset;
  if (typeof apply !== "function") {
    console.error("[recordings] seekToByteOffset: mpegts.js 补丁未生效（实例缺少方法）");
    return false;
  }
  try {
    apply.call(player, fileposition, milliseconds);
    return true;
  } catch (error) {
    console.error("[recordings] seekToByteOffset: patched 方法内部结构不符，续播不可用", error);
    return false;
  }
}

/** 按已知时长重算缓冲上限并应用到当前播放器（依赖补丁 `setBufferLimits`）。 */
export function configureBufferForBitrate(fileSize: number, durationSeconds: number): boolean {
  const apply = currentPlayer?.setBufferLimits;
  if (typeof apply !== "function") return false;
  try {
    apply.call(currentPlayer, computeBufferConfig(fileSize, durationSeconds));
    return true;
  } catch (error) {
    console.error("[recordings] 应用缓冲上限失败", error);
    return false;
  }
}
