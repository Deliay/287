/** `scripts/lib/local-proxy.mjs` 的类型声明（供 tsc 消费；运行时实现见同名 .mjs，审核 R10-a）。 */

/** 本地反代默认端口。 */
export const DEFAULT_PROXY_PORT: number;
/** 录播服务生产上游。 */
export const RECORDINGS_ORIGIN: string;
/** 弹幕（直播事件）服务生产上游。 */
export const EVENTS_ORIGIN: string;
/** 本地路径前缀 → 录播服务。 */
export const RECORDINGS_PREFIX: string;
/** 本地路径前缀 → 弹幕服务。 */
export const EVENTS_PREFIX: string;

export interface ProxyConfig {
  port: number;
  recordingsOrigin: string;
  eventsOrigin: string;
}

export interface UpstreamTarget {
  origin: string;
  path: string;
}

export interface RunningProxy {
  port: number;
  origin: string;
  close(): Promise<void>;
}

type HeaderBag = Record<string, string | string[] | undefined>;

/** 解析代理运行配置：端口与两个上游 origin（默认即生产源）。 */
export function parseProxyEnv(env?: Record<string, string | undefined>): ProxyConfig;

/** 注入到 `NEXT_PUBLIC_*` 的本地基址（绝对 http 地址）。 */
export function publicBases(port?: number): { recordings: string; events: string };

/** 路径映射：`/recordings/**` → 录播服务、`/events/**` → 弹幕服务；未知前缀/路径穿越返回 null。 */
export function resolveUpstream(
  pathWithQuery: string,
  cfg: Pick<ProxyConfig, "recordingsOrigin" | "eventsOrigin">,
): UpstreamTarget | null;

/** 转发请求头：透传 Range 等业务头，剔除 hop-by-hop。 */
export function forwardHeaders(headers?: HeaderBag): Record<string, string | string[]>;

/** 上游响应头白名单。 */
export function pickResponseHeaders(headers?: HeaderBag): Record<string, string | string[]>;

/** 本地代理的 CORS 头（预检回显站点实际请求头）。 */
export function corsHeaders(requestHeaders?: HeaderBag): Record<string, string>;

/** 启动本地反代（默认仅监听 127.0.0.1；`port = 0` 取随机端口）。 */
export function startProxy(options?: Partial<ProxyConfig>): Promise<RunningProxy>;
