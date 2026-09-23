/**
 * 录播回放时间窗口与分段边界推导（技术方案 §3.3，纯函数）。
 *
 * 时间锚点取文件 `info.startedAt`（场次实际开始），**不是** `createdAt`——
 * 实测 `createdAt` 是该分段落盘（≈分段结束）时刻；同场次多分段共享同一
 * `recordingId` / `info.startedAt` / `info.endedAt`，各分段实际覆盖区间需按
 * `createdAt` 升序由兄弟文件推导（`segmentBoundsForFile`）。
 * 窗口以分段起点为原点按 10 分钟切分，把事件墙上时钟映射为相对录播偏移。
 */

import type { RecordingFile } from "../types";

/** 单窗口时长（10 分钟）。12h 的「单次查询区间」上限只存在于 api.ts（审核次要13）。 */
export const WINDOW_MS = 600_000;

/** 目标文件（分段）实际覆盖区间；`endMs` 无法确定时为 `NaN`。 */
export interface SegmentBounds {
  startMs: number;
  endMs: number;
  /** true 表示 `info.startedAt` 缺失、回退 `createdAt` 口径（近似）。 */
  fallback: boolean;
}

function parseMs(value: string | undefined | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 推导目标文件（分段）覆盖的时间区间：
 * - 首段起点 = `info.startedAt`；
 * - 其余段起点 = **前一段** `createdAt`（绝不用目标文件自身 `createdAt` 作锚点）；
 * - 非末段终点 = 本段 `createdAt`；末段终点 = `info.endedAt`（缺失回退本段 `createdAt`）；
 * - `info.startedAt` 缺失时回退 `createdAt` 为起点（`fallback = true`），终点无法确定为 `NaN`。
 *
 * `target` 为文件名；找不到时抛 `RangeError`（调用方先回源 recordings 列表）。
 */
export function segmentBoundsForFile(files: RecordingFile[], target: string): SegmentBounds {
  const file = files.find((candidate) => candidate.name === target);
  if (!file) throw new RangeError(`recordings 列表中不存在文件：${target}`);

  const targetCreated = parseMs(file.createdAt);
  const infoStart = parseMs(file.info?.startedAt);
  const infoEnd = parseMs(file.info?.endedAt);
  const recordingId = file.info?.recordingId;
  const fallback = infoStart === null;
  const sessionStart = infoStart ?? targetCreated;

  const siblings = recordingId
    ? files
        .filter((candidate) => candidate.info?.recordingId === recordingId)
        .slice()
        .sort(
          (a, b) =>
            (parseMs(a.createdAt) ?? Number.POSITIVE_INFINITY) -
            (parseMs(b.createdAt) ?? Number.POSITIVE_INFINITY),
        )
    : [];
  const index = siblings.findIndex((candidate) => candidate.name === target);
  const isLast = index === -1 || index === siblings.length - 1;

  let startMs = sessionStart ?? Number.NaN;
  if (index > 0) startMs = parseMs(siblings[index - 1]?.createdAt) ?? sessionStart ?? Number.NaN;

  let endMs: number;
  if (!isLast) {
    endMs = targetCreated ?? Number.NaN;
  } else {
    endMs = infoEnd ?? targetCreated ?? Number.NaN;
  }
  // 终点不晚于起点（info 缺失回退 / 异常数据）→ 交由时长兜底
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
    endMs = Number.NaN;
  }

  return { startMs, endMs, fallback };
}

/** 偏移毫秒 → 窗口序号（负值 / 非法值钳到 0）。 */
export function windowIndexFor(offsetMs: number): number {
  if (!Number.isFinite(offsetMs) || offsetMs < 0) return 0;
  return Math.floor(offsetMs / WINDOW_MS);
}

/**
 * 窗口的绝对时间边界：
 * - 起点 `recordStartMs + index * WINDOW_MS`；
 * - 终点 `min(起点 + WINDOW_MS, recordEnd)`；`recordEnd` 未知时**不设绝对上限**，直接给完整
 *   10min 窗口——12h 是上游「单次查询区间」上限而非录制时长上限（审核次要2：否则未知终点 +
 *   录制 >12h 时 index ≥ 72 的窗口 endMs ≤ startMs，弹幕被静默拉空）；
 * - `recordEnd` 早于起点 → 空窗（`endMs <= startMs`，调用方跳过请求）。
 */
export function windowBounds(
  index: number,
  recordStartMs: number,
  recordEndMs?: number | null,
): { startMs: number; endMs: number } {
  const safeIndex = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  const startMs = recordStartMs + safeIndex * WINDOW_MS;
  const hasEnd = recordEndMs != null && Number.isFinite(recordEndMs) && recordEndMs > recordStartMs;
  const endMs = hasEnd
    ? Math.min(startMs + WINDOW_MS, recordEndMs as number)
    : startMs + WINDOW_MS;
  return { startMs, endMs };
}

/** 绝对毫秒 → ISO 字符串（replay 端点查询参数）。 */
export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** 事件墙上时钟 → 相对录播起点的偏移（毫秒）。 */
export function offsetMsFor(occurredAt: string, recordStart: string): number {
  return Date.parse(occurredAt) - Date.parse(recordStart);
}
