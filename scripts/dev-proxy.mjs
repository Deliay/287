#!/usr/bin/env node
/**
 * 本地反代独立启动入口（R10-a）：`pnpm proxy`。
 *
 * 输出注入 `NEXT_PUBLIC_*` 所需的本地基址；配合 `scripts/dev-with-proxy.mjs`
 * （`pnpm dev` 会自动拉起本进程并注入基址）使用。
 */

import { parseProxyEnv, publicBases, startProxy } from "./lib/local-proxy.mjs";

const config = parseProxyEnv(process.env);

try {
  const proxy = await startProxy(config);
  const bases = publicBases(proxy.port);
  console.log(`[local-proxy] listening on ${proxy.origin} (127.0.0.1)`);
  console.log(`[local-proxy] NEXT_PUBLIC_RECORDINGS_BASE_URL=${bases.recordings}`);
  console.log(`[local-proxy] NEXT_PUBLIC_API_BASE_URL=${bases.events}`);
  console.log(`[local-proxy] upstream: ${config.recordingsOrigin} | ${config.eventsOrigin}`);
  console.log(`[local-proxy] health: ${proxy.origin}/__proxy/health`);

  const shutdown = () => {
    void proxy.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  console.error(
    `[local-proxy] failed to listen on 127.0.0.1:${config.port}（端口占用？可设 LOCAL_PROXY_PORT 覆盖）`,
    error,
  );
  process.exit(1);
}
