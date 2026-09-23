import { useEffect, useState } from "react";
import { members, type Member } from "@/data/members";

export interface LiveStatus {
  living: boolean;
  /** 开播时的直播标题；未开播或解析失败时为 null */
  title: string | null;
}

/** 未开播 / 任何失败场景的统一降级结果（绝不向组件层抛异常） */
const OFFLINE: LiveStatus = { living: false, title: null };

/** 线上直连的接口域名（287.live 已在 CORS 白名单）；开发态不拼 base，走 next dev 代理 */
const API_ORIGIN = "https://api.sumire.live";

/** 模块级缓存：同一成员页面生命周期内只请求一次，失败结果同样被缓存 */
const cache = new Map<string, Promise<LiveStatus>>();

/** 按环境拼接请求地址：开发态走相对路径（dev 代理），其余环境直连 */
function resolveUrl(member: Member): string {
  const base = process.env.NODE_ENV === "development" ? "" : API_ORIGIN;
  return `${base}${member.liveStatusUrl}`;
}

/** 请求超时（5s）；运行环境不支持 AbortSignal.timeout 时省略信号 */
function timeoutSignal(): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(5000);
  }
  return undefined;
}

/**
 * 防御性解析实测结构 { ok, status: { live, title } }：
 * 字段缺失或类型不符一律降级为未开播态。
 */
function parseStatus(payload: unknown): LiveStatus {
  if (typeof payload !== "object" || payload === null) {
    return OFFLINE;
  }
  const status = (payload as { status?: unknown }).status;
  if (typeof status !== "object" || status === null) {
    return OFFLINE;
  }
  const { live, title } = status as { live?: unknown; title?: unknown };
  // 取值无效（含空/纯空白标题）一律降级，避免渲染内容为空的开播链接
  if (live !== true || typeof title !== "string" || title.trim() === "") {
    return OFFLINE;
  }
  return { living: true, title };
}

/** 单次请求：网络错误、非 2xx、超时、畸形 JSON 全部降级为未开播态 */
async function requestStatus(url: string): Promise<LiveStatus> {
  try {
    const response = await fetch(url, { signal: timeoutSignal() });
    if (!response.ok) {
      return OFFLINE;
    }
    return parseStatus(await response.json());
  } catch {
    return OFFLINE;
  }
}

/** 按成员拉取直播状态；同 memberId 只发一次请求（AC-5） */
export function fetchLiveStatus(memberId: Member["id"]): Promise<LiveStatus> {
  const cached = cache.get(memberId);
  if (cached) {
    return cached;
  }
  const member = members.find((item) => item.id === memberId);
  const pending = member
    ? requestStatus(resolveUrl(member))
    : Promise.resolve(OFFLINE);
  cache.set(memberId, pending);
  return pending;
}

/** Client Hook：status 为 null 表示加载中 */
export function useLiveStatus(
  memberId: Member["id"],
): { status: LiveStatus | null } {
  const [status, setStatus] = useState<LiveStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetchLiveStatus(memberId).then((result) => {
      if (active) {
        setStatus(result);
      }
    });
    return () => {
      active = false;
    };
  }, [memberId]);

  return { status };
}
