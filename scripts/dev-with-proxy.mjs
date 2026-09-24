#!/usr/bin/env node
/**
 * 本地验收启动器（R10-a；R11-b fail-fast）：先起本地反代并**等待其就绪**，
 * 再以注入代理基址的环境运行目标命令。
 *
 *   node scripts/dev-with-proxy.mjs next dev      # pnpm dev
 *   LOCAL_PROXY=0 node scripts/dev-with-proxy.mjs next dev   # 关闭代理（直连生产源）
 *
 * 反代未就绪（端口占用/启动异常/健康检查超时）→ **fail-fast**：打印处置建议并以非零码退出，
 * 绝不继续以失效的注入基址启动 next dev（否则浏览器全量网络失败而根因隐蔽，审核 R11-b）。
 *
 * 注入仅作用于本进程及子进程（构建期 NEXT_PUBLIC_*），不写入任何仓库文件；
 * 生产 `pnpm build` / `pnpm preview` / `pnpm deploy` 不经过本脚本，基址保持生产直连默认值（R10-b）。
 */

import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseProxyEnv, publicBases } from "./lib/local-proxy.mjs";
import { exitCodeFor, planLaunch, proxyStartupFailureMessage, waitForProxyHealth } from "./lib/dev-launcher.mjs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/dev-with-proxy.mjs <command> [args...]");
  process.exit(2);
}

const useProxy = process.env.LOCAL_PROXY !== "0";
const env = { ...process.env };
const config = parseProxyEnv(process.env);
let proxyChild = null;
let proxySpawnError = null;

if (useProxy) {
  const bases = publicBases(config.port);
  const proxyScript = fileURLToPath(new URL("./dev-proxy.mjs", import.meta.url));
  proxyChild = spawn(process.execPath, [proxyScript], { stdio: "inherit", env });
  proxyChild.on("error", (error) => {
    proxySpawnError = error;
  });

  const proxyOrigin = `http://127.0.0.1:${config.port}`;
  const proxyReady = await waitForProxyHealth(proxyOrigin, { timeoutMs: 5000, intervalMs: 100 });
  const plan = planLaunch({ useProxy: true, proxyReady });

  if (!plan.proceed) {
    // fail-fast：反代未就绪不得以失效基址继续（R11-b）
    if (proxyChild.exitCode === null && proxySpawnError === null) proxyChild.kill("SIGTERM");
    console.error(
      proxyStartupFailureMessage(config.port, proxySpawnError ? String(proxySpawnError.message ?? proxySpawnError) : undefined),
    );
    process.exit(1);
  }

  env.NEXT_PUBLIC_RECORDINGS_BASE_URL = bases.recordings;
  env.NEXT_PUBLIC_API_BASE_URL = bases.events;
  console.log("[dev-with-proxy] local proxy ready ✓");
  console.log(`[dev-with-proxy] NEXT_PUBLIC_RECORDINGS_BASE_URL=${bases.recordings}`);
  console.log(`[dev-with-proxy] NEXT_PUBLIC_API_BASE_URL=${bases.events}`);
} else {
  console.log("[dev-with-proxy] LOCAL_PROXY=0 → 不注入代理基址，前端直连生产源");
}

const [command, ...commandArgs] = args;
const child = spawn(command, commandArgs, { stdio: "inherit", env });

const forward = (signal) => {
  if (child.exitCode === null) child.kill(signal);
  if (proxyChild && proxyChild.exitCode === null) proxyChild.kill(signal);
};
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));

child.on("error", (error) => {
  console.error(`[dev-with-proxy] failed to start \`${command}\`: ${error.message}`);
  if (proxyChild && proxyChild.exitCode === null) proxyChild.kill("SIGTERM");
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (proxyChild && proxyChild.exitCode === null) proxyChild.kill("SIGTERM");
  // code 为 null（被信号终止）时按 signal 归一退出码，不静默（R11-b）
  process.exit(exitCodeFor(code, signal));
});
