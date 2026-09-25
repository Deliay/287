/**
 * 录播模块数据类型（技术方案 §4.1，字段与实测接口结构一致）。
 */

/** 直播/录制状态。 */
export type RecordingState = "recording" | "not_live";

/** `GET {REC_BASE}/api/b/live/recording-status` 单条记录。 */
export interface RecordingStatusItem {
  /** B 站 UID（与 `src/data/members.ts` 成员关联键）。 */
  mid: number;
  roomId: number;
  state: RecordingState;
  sessionTitle: string | null;
  files: string[];
  updatedAt: string;
  streamer: { name: string };
}

/** `GET {REC_BASE}/api/b/live/recording-status` 响应。 */
export interface RecordingStatusResponse {
  items: RecordingStatusItem[];
}

/**
 * 录播文件场次信息：同场次多分段共享 `recordingId` 与 `startedAt`/`endedAt`；
 * `createdAt` 是该分段落盘时刻（≈分段结束），**不是**录制开始（技术方案 §3.3）。
 */
export interface RecordingFileInfo {
  recordingId: string;
  title: string;
  mid: number;
  startedAt: string;
  endedAt: string;
}

/** 录播文件条目；`info` 缺失时上层回退文件名 / `createdAt`。 */
export interface RecordingFile {
  name: string;
  size: number;
  createdAt: string;
  info?: RecordingFileInfo;
}

/** `GET {REC_BASE}/api/b/live/{roomId}/recordings` 响应。 */
export interface RoomRecordingsResponse {
  files: RecordingFile[];
}

/**
 * 直播事件类型（弹幕 / 礼物 / 舰长 / SuperChat）。
 *
 * `gift_v2` 为上游 B 站信封类型：服务端归一化后**不会**出现在回放接口输出中
 * （需求 §7 调研结论），此处作为白名单字面量仅用于**解析层防御性兼容**——
 * `parseLiveEvent` 收到它时按 `gift` 归一，故 `LiveEvent.type` 的实际取值恒为四类。
 */
export type LiveEventType = "danmaku" | "super_chat" | "gift" | "guard_buy" | "gift_v2";

/** SuperChat 卡片配色（接口可选字段，缺失/非法时由渲染层回退默认金色系，设计 §1）。 */
export interface SuperChatColors {
  backgroundStart: string;
  backgroundEnd: string;
  fontColor: string;
}

/** `GET {API_BASE}/api/live-events/replay` 单条事件。 */
export interface LiveEvent {
  eventId: string;
  /** 解析后的真实类型；`gift_v2` 已归一为 `gift`（技术方案 §4.1）。 */
  type: LiveEventType;
  occurredAt: string;
  sender: {
    uid: number;
    name: string;
    face: string;
    medal: { name: string; level: number; color: string } | null;
    guardLevel: number | null;
  };
  content?: string;
  emote?: { url: string; name: string; width: number; height: number };
  price?: number;
  /** SuperChat 卡片配色（2026-09-25 实测已返回，前端类型新增）。 */
  scColors?: SuperChatColors;
  /** SuperChat 悬停秒数（实测已返回，前端类型新增；卡片展示不依赖）。 */
  time?: number;
  gift?: { name: string; count: number; iconUrl: string };
  guard?: { level: number; name: string; count: number };
}

/** `GET {API_BASE}/api/live-events/replay` 响应。 */
export interface LiveEventsResponse {
  total: number;
  page: number;
  pageSize: number;
  items: LiveEvent[];
}
