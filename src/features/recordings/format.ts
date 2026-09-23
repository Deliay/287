/** 录播模块展示格式化工具。 */

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** 字节数转人性化单位（1 KB = 1024 B，保留一位小数）。 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < UNITS.length - 1) {
    value /= 1024;
    index += 1;
  }
  return index === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${UNITS[index]}`;
}

/** ISO 时间转本地「YYYY-MM-DD HH:mm」。 */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 时长（`endedAt - startedAt`）转「X小时Y分」；不足 1 小时仅分钟，无法解析返回 null。 */
export function formatDuration(startIso: string | undefined, endIso: string | undefined): string | null {
  if (!startIso || !endIso) return null;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const totalMinutes = Math.floor((end - start) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}小时${minutes}分` : `${minutes}分`;
}

/** 毫秒偏移转「mm:ss」（事件列表相对时间）。 */
export function formatOffset(offsetSeconds: number): string {
  if (!Number.isFinite(offsetSeconds) || offsetSeconds < 0) return "00:00";
  const total = Math.floor(offsetSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
