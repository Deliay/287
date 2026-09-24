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
  RecordingFileInfo,
  RecordingStatusResponse,
  RoomRecordingsResponse,
} from "./types";

/** 录播服务默认基址（生产）。 */
const DEFAULT_RECORDINGS_BASE_URL = "https://recordings.vtuber.fffdan.com";
/** 弹幕（直播事件）服务默认基址（生产）。 */
const DEFAULT_API_BASE_URL = "https://api.sumire.live";

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
function joinUrl(base: string, path: string): string {
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

/**
 * 解析单条录制状态（审核次要1）：`mid`/`roomId`/`state` 为关联与判定的必要字段，
 * 缺失即跳过该条；`sessionTitle`、`streamer`、`files` 等按可缺省校验，不影响整响应。
 */
function parseStatusItem(raw: unknown): RecordingStatusResponse["items"][number] | null {
  if (!isRecord(raw)) return null;
  const { mid, roomId, state, sessionTitle, files, updatedAt, streamer } = raw;
  if (typeof mid !== "number" || typeof roomId !== "number") return null;
  // R15-2：state 为必要判定字段，缺失/非法即跳过本条——不再强转 recording（假直播态防护），与注释声明一致
  if (state !== "recording" && state !== "not_live") return null;
  return {
    mid,
    roomId,
    state,
    sessionTitle: typeof sessionTitle === "string" ? sessionTitle : null,
    files: Array.isArray(files) ? files.filter((file): file is string => typeof file === "string") : [],
    updatedAt: typeof updatedAt === "string" ? updatedAt : "",
    streamer: {
      name: isRecord(streamer) && typeof streamer.name === "string" ? streamer.name : "",
    },
  };
}

/**
 * 录播文件场次信息解析（审核次要1）：
 * `recordingId` 为分段推导的必要字段，缺失视为「无 info」（容忍，不打死整个响应）；
 * 其余字段按可缺省校验——录制进行中的文件常缺 `endedAt`。
 */
function parseFileInfo(raw: unknown): RecordingFileInfo | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.recordingId !== "string") return undefined;
  return {
    recordingId: raw.recordingId,
    title: typeof raw.title === "string" ? raw.title : "",
    mid: typeof raw.mid === "number" ? raw.mid : 0,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : "",
    endedAt: typeof raw.endedAt === "string" ? raw.endedAt : "",
  };
}

/** 解析单个录播文件；必要字段（name）缺失返回 null（跳过坏 item，审核次要1）。 */
function parseRecordingFile(raw: unknown): RoomRecordingsResponse["files"][number] | null {
  if (!isRecord(raw)) return null;
  const { name, size, createdAt, info } = raw;
  if (typeof name !== "string") return null;
  const parsedInfo = parseFileInfo(info);
  return {
    name,
    size: typeof size === "number" ? size : 0,
    createdAt: typeof createdAt === "string" ? createdAt : "",
    ...(parsedInfo ? { info: parsedInfo } : {}),
  };
}

/**
 * 解析单条直播事件（审核次要1）：`eventId`/`type`/`occurredAt` 为必要字段（缺失跳过坏 item），
 * `sender` 内字段与 `medal`/`emote`/`gift`/`guard` 等结构按可缺省校验，失败降级为缺省值。
 */
function parseLiveEvent(raw: unknown): LiveEvent | null {
  if (!isRecord(raw)) return null;
  const { eventId, type, occurredAt, sender, content, emote, price, gift, guard } = raw;
  if (typeof eventId !== "string") return null;
  if (type !== "danmaku" && type !== "super_chat" && type !== "gift" && type !== "guard_buy") return null;
  if (typeof occurredAt !== "string") return null;
  const rawSender = isRecord(sender) ? sender : {};
  const uid = typeof rawSender.uid === "number" ? rawSender.uid : 0;
  const name = typeof rawSender.name === "string" ? rawSender.name : "";
  const face = typeof rawSender.face === "string" ? rawSender.face : "";
  const guardLevel = typeof rawSender.guardLevel === "number" ? rawSender.guardLevel : null;
  const medal = parseMedal(rawSender.medal);
  const event: LiveEvent = {
    eventId,
    type,
    occurredAt,
    sender: { uid, name, face, medal, guardLevel },
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

/** 徽章信息结构校验：不符时降级为 null（不影响整条事件，审核次要1）。 */
function parseMedal(raw: unknown): { name: string; level: number; color: string } | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.name !== "string" || typeof raw.level !== "number" || typeof raw.color !== "string") {
    return null;
  }
  return { name: raw.name, level: raw.level, color: raw.color };
}

/** 当前四家直播间的录制状态列表。 */
export async function fetchRecordingStatus(): Promise<RecordingStatusResponse> {
  const url = joinUrl(RECORDINGS_BASE_URL, "/api/b/live/recording-status");
  const data = await requestJson(url);
  // 顶层结构缺失（无 items）仍视为结构错误；个别坏 item 跳过（审核次要1）
  if (!isRecord(data) || !Array.isArray(data.items)) throw structureError(url, "缺少 items");
  const items = data.items
    .map(parseStatusItem)
    .filter((item): item is RecordingStatusResponse["items"][number] => item !== null);
  return { items };
}

/** 某直播间的录播文件列表。 */
export async function fetchRoomRecordings(roomId: number): Promise<RoomRecordingsResponse> {
  const url = joinUrl(RECORDINGS_BASE_URL, `/api/b/live/${roomId}/recordings`);
  const data = await requestJson(url);
  if (!isRecord(data) || !Array.isArray(data.files)) throw structureError(url, "缺少 files");
  const files = data.files
    .map(parseRecordingFile)
    .filter((file): file is RoomRecordingsResponse["files"][number] => file !== null);
  return { files };
}

export interface FetchLiveEventsParams {
  roomId: number;
  start: string;
  end: string;
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}

/** 上游契约：单次查询区间上限 12 小时（ms）。 */
const MAX_QUERY_RANGE_MS = 12 * 60 * 60 * 1000;
/** 上游契约：单页条数上限 100。 */
const MAX_PAGE_SIZE = 100;

/**
 * 按时间区间检索回放直播事件（弹幕等）。
 * 上游契约：单次区间 ≤ 12h、单页 ≤ 100 条——调用方越界时在此**钳制**（审核次要10），
 * 窗口切分（10min）由调用方负责；`total` 缺失时返回 0 表示未知，翻页由页满启发式兜底。
 */
export async function fetchLiveEvents(params: FetchLiveEventsParams): Promise<LiveEventsResponse> {
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(Number.isFinite(params.pageSize) ? params.pageSize : MAX_PAGE_SIZE)),
  );
  const startMs = Date.parse(params.start);
  const parsedEnd = Date.parse(params.end);
  const endMs =
    Number.isFinite(startMs) && Number.isFinite(parsedEnd) && parsedEnd - startMs > MAX_QUERY_RANGE_MS
      ? startMs + MAX_QUERY_RANGE_MS
      : parsedEnd;

  const search = new URLSearchParams();
  search.set("roomId", String(params.roomId));
  search.set("start", params.start);
  search.set("end", Number.isFinite(endMs) ? new Date(endMs).toISOString() : params.end);
  search.set("page", String(params.page));
  search.set("pageSize", String(pageSize));
  const url = `${joinUrl(API_BASE_URL, "/api/live-events/replay")}?${search.toString()}`;
  const data = await requestJson(url, params.signal ? { signal: params.signal } : undefined);
  if (!isRecord(data) || !Array.isArray(data.items)) throw structureError(url, "缺少 items");
  const items = data.items
    .map(parseLiveEvent)
    .filter((item): item is LiveEvent => item !== null);
  // total 缺失（或非正数）→ 0 表示未知，避免「collected >= total」在首页即误判拉全
  const total = typeof data.total === "number" && data.total > 0 ? data.total : 0;
  return {
    total,
    page: typeof data.page === "number" ? data.page : params.page,
    pageSize,
    items,
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
