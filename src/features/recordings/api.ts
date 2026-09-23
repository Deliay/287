/**
 * 录播服务 / 弹幕服务请求封装（技术方案 §4.1）。
 *
 * 站点为静态导出、无服务端，浏览器直连两个外部接口；基址取构建期
 * `NEXT_PUBLIC_*` 环境变量，缺失时回退生产默认值。
 * 所有失败（网络错误 / 非 2xx / 结构不符）统一归一化为 `ApiError`，不静默降级。
 */

import type {
  LiveEvent,
  LiveEventsResponse,
  RecordingStatusResponse,
  RoomRecordingsResponse,
} from "./types";

/** 录播服务默认基址（生产）。 */
export const DEFAULT_RECORDINGS_BASE_URL = "https://recordings.vtuber.fffdan.com";
/** 弹幕（直播事件）服务默认基址（生产）。 */
export const DEFAULT_API_BASE_URL = "https://api.sumire.live";

export const RECORDINGS_BASE_URL =
  process.env.NEXT_PUBLIC_RECORDINGS_BASE_URL || DEFAULT_RECORDINGS_BASE_URL;
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;

/** 录播/弹幕请求错误类别：网络失败 / HTTP 非 2xx / 响应结构不符。 */
export type ApiErrorKind = "network" | "http" | "structure";

/** 统一 API 错误：调用方按 `kind` 决定重试文案，绝不静默吞掉。 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly url?: string;

  constructor(kind: ApiErrorKind, message: string, options: { status?: number; url?: string; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ApiError";
    this.kind = kind;
    this.status = options.status;
    this.url = options.url;
  }
}

/** 基址与路径归一拼接（消除末尾/开头斜杠差异）。 */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 拉取 JSON 并做三段式校验：HTTP 状态 → JSON 解析 → 调用方结构守卫。 */
async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    throw new ApiError("network", `网络请求失败：${url}`, { url, cause });
  }
  if (!response.ok) {
    throw new ApiError("http", `HTTP ${response.status}：${url}`, { status: response.status, url });
  }
  try {
    return (await response.json()) as unknown;
  } catch (cause) {
    throw new ApiError("structure", `响应不是合法 JSON：${url}`, { url, cause });
  }
}

function structureError(url: string, detail: string): ApiError {
  return new ApiError("structure", `响应结构不符（${detail}）：${url}`, { url });
}

function parseStatusItem(raw: unknown): RecordingStatusResponse["items"][number] | null {
  if (!isRecord(raw)) return null;
  const { mid, roomId, state, sessionTitle, files, updatedAt, streamer } = raw;
  if (typeof mid !== "number" || typeof roomId !== "number") return null;
  if (state !== "recording" && state !== "not_live") return null;
  if (!Array.isArray(files) || !files.every((file) => typeof file === "string")) return null;
  if (typeof updatedAt !== "string") return null;
  if (!isRecord(streamer) || typeof streamer.name !== "string") return null;
  if (sessionTitle !== null && typeof sessionTitle !== "string") return null;
  return { mid, roomId, state, sessionTitle, files, updatedAt, streamer: { name: streamer.name } };
}

function parseFileInfo(raw: unknown): Record<string, unknown> | null {
  return isRecord(raw) ? raw : null;
}

function parseRecordingFile(raw: unknown): RoomRecordingsResponse["files"][number] | null {
  if (!isRecord(raw)) return null;
  const { name, size, createdAt, info } = raw;
  if (typeof name !== "string") return null;
  if (typeof size !== "number" || typeof createdAt !== "string") return null;
  if (info === undefined || info === null) return { name, size, createdAt };
  const record = parseFileInfo(info);
  if (
    !record ||
    typeof record.recordingId !== "string" ||
    typeof record.title !== "string" ||
    typeof record.mid !== "number" ||
    typeof record.startedAt !== "string" ||
    typeof record.endedAt !== "string"
  ) {
    return null;
  }
  return {
    name,
    size,
    createdAt,
    info: {
      recordingId: record.recordingId,
      title: record.title,
      mid: record.mid,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
    },
  };
}

function parseLiveEvent(raw: unknown): LiveEvent | null {
  if (!isRecord(raw)) return null;
  const { eventId, type, occurredAt, sender, content, emote, price, gift, guard } = raw;
  if (typeof eventId !== "string") return null;
  if (type !== "danmaku" && type !== "super_chat" && type !== "gift" && type !== "guard_buy") return null;
  if (typeof occurredAt !== "string") return null;
  if (!isRecord(sender)) return null;
  const { uid, name, face, medal, guardLevel } = sender;
  if (typeof uid !== "number" || typeof name !== "string" || typeof face !== "string") return null;
  if (guardLevel !== null && typeof guardLevel !== "number") return null;
  let parsedMedal: { name: string; level: number; color: string } | null = null;
  if (medal !== null && medal !== undefined) {
    if (
      !isRecord(medal) ||
      typeof medal.name !== "string" ||
      typeof medal.level !== "number" ||
      typeof medal.color !== "string"
    ) {
      return null;
    }
    parsedMedal = { name: medal.name, level: medal.level, color: medal.color };
  }
  const event: LiveEvent = {
    eventId,
    type,
    occurredAt,
    sender: { uid, name, face, medal: parsedMedal, guardLevel: guardLevel ?? null },
  };
  if (typeof content === "string") event.content = content;
  if (
    isRecord(emote) &&
    typeof emote.url === "string" &&
    typeof emote.name === "string" &&
    typeof emote.width === "number" &&
    typeof emote.height === "number"
  ) {
    event.emote = { url: emote.url, name: emote.name, width: emote.width, height: emote.height };
  }
  if (typeof price === "number") event.price = price;
  if (isRecord(gift)) {
    if (typeof gift.name === "string" && typeof gift.count === "number" && typeof gift.iconUrl === "string") {
      event.gift = { name: gift.name, count: gift.count, iconUrl: gift.iconUrl };
    }
  }
  if (isRecord(guard)) {
    if (typeof guard.level === "number" && typeof guard.name === "string" && typeof guard.count === "number") {
      event.guard = { level: guard.level, name: guard.name, count: guard.count };
    }
  }
  return event;
}

/** 当前四家直播间的录制状态列表。 */
export async function fetchRecordingStatus(): Promise<RecordingStatusResponse> {
  const url = joinUrl(RECORDINGS_BASE_URL, "/api/b/live/recording-status");
  const data = await requestJson(url);
  if (!isRecord(data) || !Array.isArray(data.items)) throw structureError(url, "缺少 items");
  const items = data.items.map(parseStatusItem);
  if (items.some((item) => item === null)) throw structureError(url, "items 字段不合法");
  return { items: items as RecordingStatusResponse["items"] };
}

/** 某直播间的录播文件列表。 */
export async function fetchRoomRecordings(roomId: number): Promise<RoomRecordingsResponse> {
  const url = joinUrl(RECORDINGS_BASE_URL, `/api/b/live/${roomId}/recordings`);
  const data = await requestJson(url);
  if (!isRecord(data) || !Array.isArray(data.files)) throw structureError(url, "缺少 files");
  const files = data.files.map(parseRecordingFile);
  if (files.some((file) => file === null)) throw structureError(url, "files 字段不合法");
  return { files: files as RoomRecordingsResponse["files"] };
}

export interface FetchLiveEventsParams {
  roomId: number;
  start: string;
  end: string;
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}

/**
 * 按时间区间检索回放直播事件（弹幕等）。
 * 上游约束：单次区间 ≤ 12h、单页 ≤ 100 条，窗口切分由调用方负责。
 */
export async function fetchLiveEvents(params: FetchLiveEventsParams): Promise<LiveEventsResponse> {
  const search = new URLSearchParams();
  search.set("roomId", String(params.roomId));
  search.set("start", params.start);
  search.set("end", params.end);
  search.set("page", String(params.page));
  search.set("pageSize", String(params.pageSize));
  const url = `${joinUrl(API_BASE_URL, "/api/live-events/replay")}?${search.toString()}`;
  const data = await requestJson(url, params.signal ? { signal: params.signal } : undefined);
  if (!isRecord(data) || !Array.isArray(data.items)) throw structureError(url, "缺少 items");
  const items = data.items.map(parseLiveEvent);
  if (items.some((item) => item === null)) throw structureError(url, "items 字段不合法");
  const total = typeof data.total === "number" ? data.total : items.length;
  return {
    total,
    page: typeof data.page === "number" ? data.page : params.page,
    pageSize: typeof data.pageSize === "number" ? data.pageSize : params.pageSize,
    items: items as LiveEvent[],
  };
}

/** 直播实时音频流地址（FLV 长连接）。 */
export function liveAudioUrl(roomId: number): string {
  return joinUrl(RECORDINGS_BASE_URL, `/api/b/live/${roomId}/live-stream/audio`);
}

/** 录播文件（FLV）地址，文件名经 encodeURIComponent 编码。 */
export function recordingFileUrl(roomId: number, fileName: string): string {
  return joinUrl(
    RECORDINGS_BASE_URL,
    `/api/b/live/${roomId}/recordings/${encodeURIComponent(fileName)}`,
  );
}

/** 回放页站内地址（查询串携带 roomId 与 file）。 */
export function recordingReplayHref(roomId: number, fileName: string): string {
  return `/recordings/replay?roomId=${encodeURIComponent(String(roomId))}&file=${encodeURIComponent(fileName)}`;
}
