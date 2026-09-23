/**
 * 未缓冲 seek 编排（技术方案 §3.3）：
 * 码率线性估算 → Range 窗口探测 → FLV tag 边界对齐 → patched `seekToByteOffset` 续播 → 看门狗。
 *
 * FLV demuxer（mpegts.js）无 mid-stream resync 能力，续播起点必须是 FLV 文件头或 tag 边界，
 * 故调用补丁方法前须扫描对齐到可信 tag 边界；且**优先对齐视频关键帧 tag**
 * （`tagType=9` 且 `frameType=1`）——否则首个到达媒体段可能是音频，叠加 mpegts lazyLoad
 * 暂停判定会造成死锁（补丁层另有兜底）。实现整体移植参考站 Deliay/sumire 的成熟实现。
 */

/** 最小探测窗口：256KB。 */
export const SEEK_WINDOW_BYTES = 262_144;
/** 关键帧扫描的字节上限（按码率推算，封顶防止无限下载）。 */
export const MAX_KEYFRAME_SCAN_BYTES = 8 * 1024 * 1024;
/** 关键帧扫描覆盖的时长假设（覆盖常见 GOP；实测录播 GOP 约 8s）。 */
export const KEYFRAME_SCAN_SECONDS = 10;
/** 单次窗口读取硬上限：即使上游忽略 Range 也绝不读入超过该值。 */
export const MAX_WINDOW_READ_BYTES = MAX_KEYFRAME_SCAN_BYTES;
/** seek 后等待真实续播的看门狗超时（15s）。 */
export const SEEK_WATCHDOG_MS = 15_000;

const FLV_TAG_TYPES = new Set([8, 9, 18]);
const FLV_TAG_HEADER_BYTES = 11;
/** 单个 FLV tag 的可信上限（防止把噪声误判为超大 tag）。 */
const MAX_FLV_TAG_BYTES = 8 * 1024 * 1024;

/** FLV tag 边界。 */
export interface TagBoundary {
  fileposition: number;
  milliseconds: number;
}

/** 播放器续播回调：返回 `false` 表示未真正生效（补丁缺失 / 结构不符），需显性失败。 */
export type ApplySeek = (fileposition: number, milliseconds: number) => boolean | void;

/**
 * 未缓冲 seek 的失败原因（供上层区分文案）：
 * - `stale`：被后发起的 seek 取代 → 静默丢弃；
 * - `aborted`：本次 seek 已被终局作废（超时/失败/卸载，AbortSignal 触发）→ 静默丢弃，
 *   **绝不**再触碰媒体元素（审核 R6-a）。
 */
export type SeekFailureReason =
  | "invalid"
  | "network"
  | "stale"
  | "aborted"
  | "range-unsupported"
  | "window-oversized"
  | "scan-failed"
  | "patch-missing";

/** 未缓冲 seek 结果：失败时携带原因；成功时 `reason` 缺省。 */
export interface SeekOutcome {
  ok: boolean;
  reason?: SeekFailureReason;
}

/** 由文件大小与总时长线性估算目标时间的字节偏移（纯函数，非法输入返回 0，钳制到 `[0, fileSize-1]`）。 */
export function estimateByteOffset(targetMs: number, durationMs: number, fileSize: number): number {
  if (!Number.isFinite(targetMs) || !Number.isFinite(durationMs) || !Number.isFinite(fileSize)) return 0;
  if (durationMs <= 0 || fileSize <= 0) return 0;
  const raw = Math.floor((fileSize * Math.max(0, targetMs)) / durationMs);
  return Math.min(Math.max(raw, 0), fileSize - 1);
}

/** 按码率推算关键帧扫描窗口（纯函数）：覆盖 `KEYFRAME_SCAN_SECONDS`，钳制 `[SEEK_WINDOW_BYTES, MAX]`。 */
export function computeScanBytes(bitrateBps: number): number {
  const valid = Number.isFinite(bitrateBps) && bitrateBps > 0 ? bitrateBps : 0;
  const raw = Math.floor((valid / 8) * KEYFRAME_SCAN_SECONDS);
  return Math.min(Math.max(raw, SEEK_WINDOW_BYTES), MAX_KEYFRAME_SCAN_BYTES);
}

function readU24(window: Uint8Array, at: number): number {
  return (window[at] << 16) | (window[at + 1] << 8) | window[at + 2];
}

function readTagMillis(window: Uint8Array, at: number): number {
  return (window[at + 6] | (window[at + 5] << 8) | (window[at + 4] << 16) | (window[at + 7] << 24)) >>> 0;
}

/**
 * 候选 tag 三重校验：`tagType ∈ {8,9,18}`、`dataSize > 0`、
 * `PrevTagSize === 11 + dataSize`；数据尚不完整时返回 `null`（调用方一律跳过）。
 */
function validateTag(window: Uint8Array, at: number): { dataSize: number } | null {
  const type = window[at];
  if (!FLV_TAG_TYPES.has(type)) return null;
  const dataSize = readU24(window, at + 1);
  if (dataSize <= 0 || dataSize > MAX_FLV_TAG_BYTES) return null;
  const prevTagSizeAt = at + FLV_TAG_HEADER_BYTES + dataSize;
  if (prevTagSizeAt + 4 > window.length) return null;
  const prevTagSize =
    ((window[prevTagSizeAt] << 24) |
      (window[prevTagSizeAt + 1] << 16) |
      (window[prevTagSizeAt + 2] << 8) |
      window[prevTagSizeAt + 3]) >>>
    0;
  if (prevTagSize !== FLV_TAG_HEADER_BYTES + dataSize) return null;
  return { dataSize };
}

/** 扫描首个任意类型合法 tag 边界（纯函数）；`PrevTagSize` 不可校验的假 tag 一律跳过。 */
export function findNextTagBoundary(window: Uint8Array, baseOffset: number): TagBoundary | null {
  for (let i = 0; i + FLV_TAG_HEADER_BYTES <= window.length; i++) {
    const tag = validateTag(window, i);
    if (!tag) continue;
    return { fileposition: baseOffset + i, milliseconds: readTagMillis(window, i) };
  }
  return null;
}

/** 扫描首个**视频关键帧** tag 边界（`tagType=9` 且 `frameType=1`），纯函数。 */
export function findVideoKeyframeBoundary(window: Uint8Array, baseOffset: number): TagBoundary | null {
  for (let i = 0; i + FLV_TAG_HEADER_BYTES <= window.length; i++) {
    if (window[i] !== 9) continue;
    const tag = validateTag(window, i);
    if (!tag) continue;
    if (window[i + FLV_TAG_HEADER_BYTES] >> 4 !== 1) continue;
    return { fileposition: baseOffset + i, milliseconds: readTagMillis(window, i) };
  }
  return null;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 取消失败忽略
  }
}

/**
 * 有上限地流式读取并扫描窗口：边读边扫（对已收数据整体重扫，规避假 tag 阻塞），
 * 命中视频关键帧即取消剩余下载；无流能力时退回 `arrayBuffer()` 一次性扫描。
 */
async function readAndScanSeekWindow(
  response: Response,
  baseOffset: number,
  cap: number,
): Promise<{ keyframe: TagBoundary | null; fallback: TagBoundary | null } | null> {
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== "function") {
    try {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > cap) return null;
      const view = new Uint8Array(buffer);
      return {
        keyframe: findVideoKeyframeBoundary(view, baseOffset),
        fallback: findNextTagBoundary(view, baseOffset),
      };
    } catch {
      return null;
    }
  }

  const reader = body.getReader();
  const buffer = new Uint8Array(cap);
  let length = 0;
  let keyframe: TagBoundary | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = cap - length;
      if (value.byteLength >= remaining) {
        buffer.set(value.subarray(0, remaining), length);
        length += remaining;
        await reader.cancel().catch(() => undefined);
        break;
      }
      buffer.set(value, length);
      length += value.byteLength;
      keyframe = findVideoKeyframeBoundary(buffer.subarray(0, length), baseOffset);
      if (keyframe) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch {
    return null;
  }
  const view = buffer.subarray(0, length);
  return {
    keyframe: keyframe ?? findVideoKeyframeBoundary(view, baseOffset),
    fallback: findNextTagBoundary(view, baseOffset),
  };
}

export interface SeekUnbufferedArgs {
  url: string;
  targetSeconds: number;
  durationSeconds: number;
  fileSize: number;
  /** 依赖注入点（默认走 flv-player 的 patched `seekToByteOffset` 桥接）。 */
  seekToByteOffset?: ApplySeek;
  /** 依赖注入点（默认全局 fetch）。 */
  fetchFn?: typeof fetch;
  /**
   * 终局作废信号（审核 R6-a）：超时/失败/被新 seek 取代/卸载时由上层 abort。
   * 贯穿 Range 请求并在每个阶段边界（响应后/扫描后/apply 前）复查——
   * 迟到的成功响应一律不再触碰媒体元素。
   */
  signal?: AbortSignal;
}

/** seek 代次：并发 seek 以 last-wins 丢弃过期探测结果。 */
let seekGeneration = 0;

async function defaultApplySeek(fileposition: number, milliseconds: number): Promise<boolean | void> {
  const { seekToByteOffset } = await import("./flv-player");
  return seekToByteOffset(fileposition, milliseconds);
}

/**
 * 未缓冲 seek 编排：估算 → Range 窗口探测（流式扫描）→ 视频关键帧对齐 → 补丁续播。
 * 仅在 `206 Partial Content` 且窗口读取在上限内时继续；任何失败路径返回带原因的
 * `SeekOutcome`（`stale` 为被取代的过期探测，调用方须静默丢弃），不抛错、不静默冻结。
 */
export async function seekUnbuffered(args: SeekUnbufferedArgs): Promise<SeekOutcome> {
  const { url, targetSeconds, durationSeconds, fileSize, signal } = args;
  const applySeek = args.seekToByteOffset ?? ((f: number, ms: number) => defaultApplySeek(f, ms));
  const fetchFn = args.fetchFn ?? ((...input: Parameters<typeof fetch>) => fetch(...input));
  const generation = ++seekGeneration;
  const aborted = () => signal?.aborted === true;

  if (aborted()) return { ok: false, reason: "aborted" };
  if (!Number.isFinite(targetSeconds) || !Number.isFinite(durationSeconds)) return { ok: false, reason: "invalid" };
  if (durationSeconds <= 0 || fileSize <= 0) return { ok: false, reason: "invalid" };

  const targetMs = Math.min(Math.max(targetSeconds, 0), durationSeconds) * 1000;
  const estimated = estimateByteOffset(targetMs, durationSeconds * 1000, fileSize);
  const scanBytes = computeScanBytes((fileSize * 8) / durationSeconds);

  let response: Response;
  try {
    // AbortSignal 贯穿 Range 请求：终局作废即取消下载，不再空耗流量（审核 R6-a）
    response = await fetchFn(url, {
      headers: { Range: `bytes=${estimated}-${estimated + scanBytes - 1}` },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (aborted()) return { ok: false, reason: "aborted" };
    console.error("[recordings] seek: Range 窗口请求失败", error);
    return { ok: false, reason: "network" };
  }
  // 迟到响应：本 seek 已被终局作废 → 取消响应体，不进入扫描/apply（审核 R6-a）
  if (aborted()) {
    await cancelBody(response);
    return { ok: false, reason: "aborted" };
  }
  // 被后发起的 seek 取代：静默丢弃（调用方不得据此报错）
  if (generation !== seekGeneration) {
    await cancelBody(response);
    return { ok: false, reason: "stale" };
  }
  if (response.status !== 206) {
    console.error(`[recordings] seek: 上游未返回 206（实际 ${response.status}），放弃未缓冲 seek`);
    await cancelBody(response);
    return { ok: false, reason: "range-unsupported" };
  }

  // 解析 Content-Range 校正起始偏移（缺失回退估算值）
  const contentRange = response.headers.get("content-range");
  let baseOffset = estimated;
  if (contentRange) {
    const match = /bytes\s+(\d+)-(\d+)\//.exec(contentRange);
    if (match) {
      baseOffset = Number(match[1]);
      const end = Number(match[2]);
      if (Number.isFinite(end) && end - baseOffset + 1 > MAX_WINDOW_READ_BYTES) {
        console.error("[recordings] seek: Content-Range 超出窗口读取上限，放弃");
        await cancelBody(response);
        return { ok: false, reason: "window-oversized" };
      }
    }
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WINDOW_READ_BYTES) {
    console.error("[recordings] seek: Content-Length 超出窗口读取上限，放弃");
    await cancelBody(response);
    return { ok: false, reason: "window-oversized" };
  }

  const scanResult = await readAndScanSeekWindow(response, baseOffset, scanBytes);
  if (!scanResult) {
    console.error("[recordings] seek: 窗口读取失败或超上限");
    return { ok: false, reason: "scan-failed" };
  }
  if (generation !== seekGeneration) return { ok: false, reason: "stale" };
  // apply 前最后复查：扫描期间被终局作废 → 绝不触碰媒体元素（审核 R6-a 不变量1）
  if (aborted()) return { ok: false, reason: "aborted" };

  const boundary = scanResult.keyframe ?? scanResult.fallback;
  if (boundary) {
    try {
      const applied = await applySeek(boundary.fileposition, boundary.milliseconds);
      if (applied === false) {
        console.error("[recordings] seek: patched seekToByteOffset 未生效（补丁缺失或结构不符）");
        return { ok: false, reason: "patch-missing" };
      }
      return { ok: true };
    } catch (error) {
      console.error("[recordings] seek: patched seekToByteOffset 调用异常", error);
      return { ok: false, reason: "patch-missing" };
    }
  }

  // 扫描未命中可信边界：降级按估算偏移直试。补丁接受即视为**发起成功**（实际是否恢复
  // 由上层看门狗兜底），补丁拒绝才判定失败——绝不把「已跳转」误报成失败（审核次要5）。
  console.error("[recordings] seek: 窗口内未找到可信 tag 边界，降级为估算偏移直试");
  if (aborted()) return { ok: false, reason: "aborted" }; // 迟到响应同样不得降级直试（审核 R6-a）
  try {
    const applied = await applySeek(estimated, targetMs);
    if (applied === false) {
      console.error("[recordings] seek: 降级直试被补丁拒绝");
      return { ok: false, reason: "patch-missing" };
    }
    return { ok: true };
  } catch (error) {
    console.error("[recordings] seek: 降级直试异常", error);
    return { ok: false, reason: "patch-missing" };
  }
}

/** 媒体元素缓冲区快照的最小依赖（便于测试注入）。 */
export interface BufferedLike {
  buffered: TimeRanges | null;
}

/** 目标时间是否落在已缓冲区间内（左闭右开；已缓冲区间维持原生 `currentTime` 路径）。 */
export function isTimeBuffered(video: BufferedLike, time: number): boolean {
  try {
    const buffered = video.buffered;
    if (!buffered) return false;
    for (let i = 0; i < buffered.length; i++) {
      if (time >= buffered.start(i) && time < buffered.end(i)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** seek 看门狗：arm 后超时未 disarm 则触发超时回调（显性报错，禁止静默冻结）。
 *
 * 生命周期语义（审核 R5-1）：`disarm()` 是**终局解除**——之后 `arm()` 一律为空操作，
 * 杜绝「latch/代次先被消费、performSeek 迟到才 arm」产生孤儿定时器导致的 15s 误报；
 * 超时触发后同样进入终局态，迟到的成功不得再次武装。
 */
export class SeekWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly onTimeout: () => void,
    private readonly ms: number = SEEK_WATCHDOG_MS,
  ) {}

  arm(): void {
    // 幂等且严格自计时（审核 R6-a 顺带决策点）：已武装时不再重置 15s 计时，
    // 超时始终以「seekTo 发起」为起点，文案「未能在 15 秒内完成跳转」与真实计时一致；
    // 终局态（disarm/超时后）arm 一律为空操作，杜绝孤儿定时器。
    if (this.disposed || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.disposed = true; // 超时即终局：迟到的 arm 不得复活
      this.onTimeout();
    }, this.ms);
  }

  /** 终局解除：清表定时器并禁止再次 arm。 */
  disarm(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export interface PerformSeekArgs {
  /** 媒体元素（只需 `currentTime` 与 `buffered`）。 */
  video: (BufferedLike & { currentTime: number }) | null;
  url: string;
  targetSeconds: number;
  durationSeconds: number;
  fileSize: number;
  seekToByteOffset?: ApplySeek;
  fetchFn?: typeof fetch;
  /** 终局作废信号：贯穿到 `seekUnbuffered` 的 Range 请求与各阶段边界（审核 R6-a）。 */
  signal?: AbortSignal;
  /** 进入 seek 中态（UI 显示 spinner、锁定进度条）。 */
  onSeeking?: () => void;
  /** 失败回调（含超时），用于显性错误提示 + 重试。 */
  onFailed: (reason: string) => void;
  /** 本次 seek 已被终局作废（abort）时的静默回调：调用方据此收敛 UI，不报新错。 */
  onAborted?: () => void;
  /** 看门狗（可注入；缺省自建 15s）。续播发生后由调用方 `disarm()`。 */
  watchdog?: SeekWatchdog;
}

/** 失败原因 → 面向用户的文案（区分真实原因，禁止一律归咎 Range，审核次要5）。 */
const SEEK_FAILURE_MESSAGES: Record<Exclude<SeekFailureReason, "stale" | "aborted">, string> = {
  invalid: "seek 失败：播放器未就绪或参数无效",
  network: "seek 失败：Range 窗口请求失败（网络错误）",
  "range-unsupported": "seek 失败：上游未支持 Range 请求",
  "window-oversized": "seek 失败：探测窗口超出读取上限",
  "scan-failed": "seek 失败：窗口扫描失败（读取中断或超限）",
  "patch-missing": "seek 失败：mpegts 字节偏移补丁未生效",
};

/**
 * seek 统一入口（技术方案 §3.3 五步）：
 * 1. 已缓冲 → 直接 `currentTime`（不发 Range）；
 * 2. 未缓冲 → `seekUnbuffered` 字节偏移续播，成功后武装 15s 看门狗；
 * 3. 失败按原因上报 `onFailed`；`stale`（被取代）与 `aborted`（已终局作废）静默丢弃，
 *    `aborted` 另走 `onAborted` 让调用方收敛 UI（审核 P3-b / R6-a）。
 */
export async function performSeek(args: PerformSeekArgs): Promise<boolean> {
  const { video, targetSeconds, durationSeconds, fileSize, url, onFailed } = args;
  if (!video || !Number.isFinite(targetSeconds)) {
    onFailed(SEEK_FAILURE_MESSAGES.invalid);
    return false;
  }

  if (isTimeBuffered(video, targetSeconds)) {
    video.currentTime = targetSeconds;
    return true;
  }

  args.onSeeking?.();
  const outcome = await seekUnbuffered({
    url,
    targetSeconds,
    durationSeconds,
    fileSize,
    ...(args.seekToByteOffset ? { seekToByteOffset: args.seekToByteOffset } : {}),
    ...(args.fetchFn ? { fetchFn: args.fetchFn } : {}),
    ...(args.signal ? { signal: args.signal } : {}),
  });

  if (!outcome.ok) {
    if (outcome.reason === "stale") return false; // 被后发起 seek 取代：静默（审核 P3-b）
    if (outcome.reason === "aborted") {
      // 已终局作废（超时/失败/卸载）：不报新错，仅回调让调用方收敛 UI（审核 R6-a）
      args.onAborted?.();
      return false;
    }
    onFailed(SEEK_FAILURE_MESSAGES[outcome.reason ?? "invalid"]);
    return false;
  }

  const watchdog = args.watchdog ?? new SeekWatchdog(() => onFailed("seek 超时：未能在 15 秒内完成跳转"));
  watchdog.arm();
  return true;
}
