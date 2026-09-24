import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PROXY_PORT,
  EVENTS_ORIGIN,
  RECORDINGS_ORIGIN,
  corsHeaders,
  forwardHeaders,
  parseProxyEnv,
  publicBases,
  resolveUpstream,
  startProxy,
} from "../scripts/lib/local-proxy.mjs";
import { API_BASE_URL, RECORDINGS_BASE_URL } from "@/features/recordings/api";

const cfg = { recordingsOrigin: "https://rec.example", eventsOrigin: "https://evt.example" };

interface Closeable {
  close(): Promise<void>;
}

const closers: Closeable[] = [];

afterEach(async () => {
  while (closers.length > 0) {
    const item = closers.pop();
    await item?.close();
  }
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

describe("本地验收反代：路径映射与头部策略（R10-a 单元）", () => {
  it("路径映射：/recordings/** → 录播服务，/events/** → 弹幕服务，保留 query", () => {
    expect(resolveUpstream("/recordings/api/b/live/recording-status", cfg)).toEqual({
      origin: "https://rec.example",
      path: "/api/b/live/recording-status",
    });
    // FLV 录播文件与直播音频流（媒体代理覆盖点）
    expect(resolveUpstream("/recordings/api/b/live/9/recordings/a.flv", cfg)).toEqual({
      origin: "https://rec.example",
      path: "/api/b/live/9/recordings/a.flv",
    });
    expect(resolveUpstream("/recordings/api/b/live/9/live-stream/audio", cfg)).toEqual({
      origin: "https://rec.example",
      path: "/api/b/live/9/live-stream/audio",
    });
    expect(resolveUpstream("/events/api/live-events/replay?roomId=1&page=2", cfg)).toEqual({
      origin: "https://evt.example",
      path: "/api/live-events/replay?roomId=1&page=2",
    });
    // 未知前缀 / 路径穿越一律拒绝
    expect(resolveUpstream("/api/b/live/recording-status", cfg)).toBeNull();
    expect(resolveUpstream("/recordings/../etc/passwd", cfg)).toBeNull();
    expect(resolveUpstream("/events/..%2f..", cfg)).toBeNull();
  });

  it("Range 请求头透传，hop-by-hop 头（host/connection 等）剔除", () => {
    const forwarded = forwardHeaders({
      host: "localhost:3000",
      connection: "keep-alive",
      range: "bytes=100-199",
      accept: "*/*",
      "user-agent": "vitest",
      "accept-encoding": "gzip, br",
    });
    expect(forwarded.range).toBe("bytes=100-199"); // 未缓冲 seek 的字节偏移续播依赖它
    expect(forwarded.accept).toBe("*/*");
    expect(forwarded.host).toBeUndefined();
    expect(forwarded.connection).toBeUndefined();
  });

  it("CORS 响应头：allow-origin *，allow-headers 含 Range，expose-headers 含 Content-Range", () => {
    const base = corsHeaders({});
    expect(base["access-control-allow-origin"]).toBe("*");
    expect(String(base["access-control-allow-headers"]).toLowerCase()).toContain("range");
    expect(base["access-control-expose-headers"]).toContain("Content-Range");
    // 预检回显站点实际请求头
    const echoed = corsHeaders({ "access-control-request-headers": "range, x-custom" });
    expect(echoed["access-control-allow-headers"]).toBe("range, x-custom");
  });

  it("基址注入解析：默认端口与生产上游，可被环境变量覆盖；本地基址可直接注入 NEXT_PUBLIC_*", () => {
    expect(parseProxyEnv({})).toEqual({
      port: DEFAULT_PROXY_PORT,
      recordingsOrigin: RECORDINGS_ORIGIN,
      eventsOrigin: EVENTS_ORIGIN,
    });
    expect(parseProxyEnv({ LOCAL_PROXY_PORT: "9999" }).port).toBe(9999);
    expect(parseProxyEnv({ RECORDINGS_UPSTREAM_ORIGIN: "http://127.0.0.1:1" }).recordingsOrigin).toBe(
      "http://127.0.0.1:1",
    );

    const bases = publicBases(DEFAULT_PROXY_PORT);
    expect(bases.recordings).toBe(`http://127.0.0.1:${DEFAULT_PROXY_PORT}/recordings`);
    expect(bases.events).toBe(`http://127.0.0.1:${DEFAULT_PROXY_PORT}/events`);
    // 注入后的地址是绝对 http 基址，api.ts 的 joinUrl 拼接后仍指向本地代理（同源自控源）
    expect(`${bases.recordings}/api/b/live/recording-status`.startsWith("http://127.0.0.1:")).toBe(true);
  });
});

describe("本地验收反代：本地端到端（mock 上游，无外网）", () => {
  it("JSON/媒体均经代理：Range 透传、206 头回传、CORS 可读、body 完整（R10-a 硬性要求）", async () => {
    let seenRange: string | undefined;
    let seenRecordingsPath = "";
    let seenEventsPath = "";
    const upstream = createServer((req, res) => {
      if (req.url?.startsWith("/api/live-events/replay")) {
        seenEventsPath = req.url;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ total: 0, items: [] }));
        return;
      }
      seenRecordingsPath = req.url ?? "";
      seenRange = req.headers.range;
      if (seenRange) {
        res.writeHead(206, {
          "content-type": "video/x-flv",
          "content-range": "bytes 100-199/1000",
          "accept-ranges": "bytes",
          "content-length": "100",
        });
        // 分两段写出：验证代理为流式转发（不整段缓冲）
        res.write("A".repeat(50));
        setImmediate(() => res.end("B".repeat(50)));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const upstreamPort = await listen(upstream);
    closers.push({ close: () => new Promise((r) => upstream.close(() => r())) });

    const proxy = await startProxy({
      port: 0,
      recordingsOrigin: `http://127.0.0.1:${upstreamPort}`,
      eventsOrigin: `http://127.0.0.1:${upstreamPort}`,
    });
    closers.push(proxy);
    const base = `http://127.0.0.1:${proxy.port}`;

    // 1) 录制状态 JSON
    const status = await fetch(`${base}/recordings/api/b/live/recording-status`, {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(status.status).toBe(200);
    expect(seenRecordingsPath).toBe("/api/b/live/recording-status");
    expect(status.headers.get("access-control-allow-origin")).toBe("*");

    // 2) FLV 媒体：Range 透传 + 206 头 + CORS expose（未缓冲 seek 依赖）
    const media = await fetch(`${base}/recordings/api/b/live/9/recordings/a.flv`, {
      headers: { Range: "bytes=100-199", Origin: "http://localhost:3000" },
    });
    expect(media.status).toBe(206);
    expect(seenRange).toBe("bytes=100-199");
    expect(media.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(media.headers.get("content-type")).toBe("video/x-flv");
    expect(media.headers.get("access-control-allow-origin")).toBe("*");
    expect(await media.text()).toBe("A".repeat(50) + "B".repeat(50));

    // 3) 弹幕事件 JSON（不同上游前缀）
    const events = await fetch(`${base}/events/api/live-events/replay?roomId=9&page=1`);
    expect(events.status).toBe(200);
    expect(seenEventsPath).toBe("/api/live-events/replay?roomId=9&page=1");
    expect(await events.json()).toEqual({ total: 0, items: [] });

    // 4) OPTIONS 预检（带 Range 属非简单请求，本地浏览器必现）
    const preflight = await fetch(`${base}/recordings/api/b/live/9/recordings/a.flv`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "range",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("range");

    // 5) 未知路径 404（仍带 CORS，便于浏览器读错误）
    const missing = await fetch(`${base}/nope`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("access-control-allow-origin")).toBe("*");

    // 6) 健康检查（验收节点探活）
    const health = await fetch(`${base}/__proxy/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ ok: true });
  });
});

describe("线上直连保持（R10-b / R10-e③）", () => {
  it("未注入环境变量时源码基址仍为两个生产默认值（线上浏览器直连，不走本地代理）", () => {
    expect(RECORDINGS_BASE_URL).toBe("https://recordings.vtuber.fffdan.com");
    expect(API_BASE_URL).toBe("https://api.sumire.live");
    expect(RECORDINGS_BASE_URL).not.toContain("127.0.0.1");
    expect(API_BASE_URL).not.toContain("127.0.0.1");
  });

  // 构建产物存在时校验：生产产物不得混入本地代理基址（构建前必须先 pnpm build）
  it.skipIf(!existsSync(path.join(process.cwd(), "out", "recordings.html")))(
    "构建产物 out/ 中不含本地代理基址，且保持生产直连域名（R10-b / R10-e③）",
    () => {
      const outDir = path.join(process.cwd(), "out");
      const chunkDir = path.join(outDir, "_next", "static", "chunks");
      const htmlFiles = ["recordings.html", path.join("recordings", "replay.html"), "index.html"]
        .map((rel) => path.join(outDir, rel))
        .filter((file) => existsSync(file));
      const jsFiles = existsSync(chunkDir)
        ? (readdirSync(chunkDir, { recursive: true }) as string[])
            .filter((rel) => String(rel).endsWith(".js"))
            .map((rel) => path.join(chunkDir, String(rel)))
        : [];
      expect(htmlFiles.length + jsFiles.length).toBeGreaterThan(0);

      const html = htmlFiles.map((file) => readFileSync(file, "utf8")).join("\n");
      const js = jsFiles.map((file) => readFileSync(file, "utf8")).join("\n");
      const all = `${html}\n${js}`;

      // ① 本地代理基址不得进入生产产物
      expect(all).not.toContain("127.0.0.1:8788");
      expect(all).not.toContain("/recordings/api/b/live"); // 代理前缀
      // ② 生产直连域名被内联进客户端 bundle（NEXT_PUBLIC 默认值）
      expect(all).toContain("recordings.vtuber.fffdan.com");
      expect(all).toContain("api.sumire.live");
    },
  );
});
