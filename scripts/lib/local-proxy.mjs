/**
 * 本地验收反代（R10-a）：让本地验收在浏览器内零跨域可用。
 *
 * 背景（2026-09-24 实测）：两个服务 API 均为 origin 白名单 CORS，目前仅放行参考站
 * `https://sumire.live`；任何本地源（localhost:3000 等）直连都会被浏览器拦截。
 * 本模块以**同源/自控源**方式转发全部跨域流量：
 *   - JSON 三接口：/recordings/api/b/live/**、/events/api/live-events/**
 *   - FLV 媒体：/recordings/api/b/live/{roomId}/recordings/{file}、.../live-stream/audio
 *     —— **透传 Range 且流式转发**（未缓冲 seek 的字节偏移续播与听直播长连接都依赖它）。
 *
 * 约束：站点为 `output: "export"` 静态导出，Next rewrites/proxy 不可用（见 static-exports 文档），
 * 故必须走独立本地进程；生产构建不注入任何代理基址，线上仍为浏览器直连（R10-b）。
 */

import http from "node:http";
import https from "node:https";

/** 本地反代默认端口。 */
export const DEFAULT_PROXY_PORT = 8788;
/** 录播服务生产上游。 */
export const RECORDINGS_ORIGIN = "https://recordings.vtuber.fffdan.com";
/** 弹幕（直播事件）服务生产上游。 */
export const EVENTS_ORIGIN = "https://api.sumire.live";
/** 本地路径前缀 → 录播服务。 */
export const RECORDINGS_PREFIX = "/recordings";
/** 本地路径前缀 → 弹幕服务。 */
export const EVENTS_PREFIX = "/events";

/** 请求头黑名单（hop-by-hop + 由代理重算的头），其余（含 Range）原样透传。 */
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

/** 上游响应头白名单（媒体/JSON 语义头必须回传，Range 响应依赖 content-range）。 */
const RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  // 与请求侧 accept-encoding 透传对称：压缩响应必须原样回传该头，否则客户端按明文解码必炸（审核 R11-a）
  "content-encoding",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control",
  "content-disposition",
];

/**
 * 解析代理运行配置：端口与两个上游 origin（默认即生产源，测试/联调可覆盖）。
 */
export function parseProxyEnv(env = process.env) {
  const rawPort = Number(env.LOCAL_PROXY_PORT);
  const port = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : DEFAULT_PROXY_PORT;
  return {
    port,
    recordingsOrigin: env.RECORDINGS_UPSTREAM_ORIGIN || RECORDINGS_ORIGIN,
    eventsOrigin: env.EVENTS_UPSTREAM_ORIGIN || EVENTS_ORIGIN,
  };
}

/**
 * 注入到 `NEXT_PUBLIC_*` 的本地基址（绝对 http 地址；api.ts 的 joinUrl 对其同样适用）。
 */
export function publicBases(port = DEFAULT_PROXY_PORT) {
  return {
    recordings: `http://127.0.0.1:${port}${RECORDINGS_PREFIX}`,
    events: `http://127.0.0.1:${port}${EVENTS_PREFIX}`,
  };
}

function matchPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * 路径映射（纯函数，单元可测）：
 * - `/recordings/**` → 录播服务（前缀剥离，保留 query）
 * - `/events/**` → 弹幕服务（同上）
 * - 其余前缀 / 含 `..` 的路径穿越 → null（拒绝转发）
 */
export function resolveUpstream(pathWithQuery, { recordingsOrigin, eventsOrigin }) {
  // indexOf 一次性切分：query 中再含字面 ? 也不截断（审核 R11-c①）
  const raw = String(pathWithQuery);
  const queryIndex = raw.indexOf("?");
  const rawPath = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
  const query = queryIndex >= 0 ? raw.slice(queryIndex + 1) : "";
  if (rawPath.includes("..")) return null;

  let origin = null;
  let rest = null;
  if (matchPrefix(rawPath, RECORDINGS_PREFIX)) {
    origin = recordingsOrigin;
    rest = rawPath.slice(RECORDINGS_PREFIX.length);
  } else if (matchPrefix(rawPath, EVENTS_PREFIX)) {
    origin = eventsOrigin;
    rest = rawPath.slice(EVENTS_PREFIX.length);
  } else {
    return null;
  }

  if (!rest) rest = "/";
  if (!rest.startsWith("/")) rest = `/${rest}`;
  return { origin, path: query ? `${rest}?${query}` : rest };
}

/**
 * 转发请求头：透传 `range`（未缓冲 seek 关键）等业务头，剔除 hop-by-hop。
 */
export function forwardHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = String(key).toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (value === undefined) continue;
    out[lower] = value;
  }
  return out;
}

/** 上游响应头白名单（本地代理自身补 CORS 头）。 */
export function pickResponseHeaders(headers = {}) {
  const out = {};
  for (const key of RESPONSE_HEADERS) {
    const value = headers[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * 本地代理的 CORS 头：本地源视为「自控源」，任意来源可读（allow-origin *），
 * 预检回显站点实际请求头（Range 属非简单头，必走预检），并 expose media 头供 fetch 读取。
 */
export function corsHeaders(requestHeaders = {}) {
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "Range, Content-Type, Accept, Origin, X-Requested-With",
    "access-control-expose-headers":
      "Content-Length, Content-Range, Content-Encoding, Accept-Ranges, Content-Type, ETag, Last-Modified",
    "access-control-max-age": "86400",
  };
  const requested =
    requestHeaders["access-control-request-headers"] ?? requestHeaders["Access-Control-Request-Headers"];
  if (requested) headers["access-control-allow-headers"] = String(requested);
  return headers;
}

function handleRequest(req, res, cfg) {
  const url = req.url || "/";
  const cors = corsHeaders(req.headers);

  // 健康检查（验收探活）
  if (url === "/__proxy/health") {
    res.writeHead(200, { ...cors, "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, recordings: cfg.recordingsOrigin, events: cfg.eventsOrigin }));
    return;
  }

  // 预检
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { ...cors, allow: "GET, HEAD, OPTIONS" });
    res.end("local proxy: method not allowed");
    return;
  }

  const target = resolveUpstream(url, cfg);
  if (!target) {
    res.writeHead(404, { ...cors, "content-type": "text/plain; charset=utf-8" });
    res.end("local proxy: unknown path");
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(target.origin + target.path);
  } catch {
    res.writeHead(502, { ...cors, "content-type": "text/plain; charset=utf-8" });
    res.end("local proxy: bad upstream origin");
    return;
  }

  const transport = targetUrl.protocol === "http:" ? http : https;
  const upstreamReq = transport.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || undefined,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: req.method,
      headers: forwardHeaders(req.headers),
    },
    (upstreamRes) => {
      // 流式转发：不缓冲整段（媒体 Range / 直播长连接依赖）
      res.writeHead(upstreamRes.statusCode || 502, {
        ...pickResponseHeaders(upstreamRes.headers),
        ...cors,
      });
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", (error) => {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "ERROR";
    if (!res.headersSent) {
      res.writeHead(502, { ...cors, "content-type": "text/plain; charset=utf-8" });
    }
    res.end(`local proxy: upstream ${code}`);
  });

  // 请求体（GET/HEAD 无体）同样透传，保持管道语义
  req.pipe(upstreamReq);
}

/**
 * 启动本地反代（默认只监听 127.0.0.1；port=0 用于测试取随机端口）。
 * 返回 `{ port, close() }`。
 */
export function startProxy(options = {}) {
  const cfg = { ...parseProxyEnv(), ...options };
  const server = http.createServer((req, res) => handleRequest(req, res, cfg));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : cfg.port;
      resolve({
        port,
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
