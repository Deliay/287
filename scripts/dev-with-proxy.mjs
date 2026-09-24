#!/usr/bin/env node
/**
 * 本地验收启动器（R10-a）：先起本地反代，再以**注入代理基址**的环境运行目标命令。
 *
 *   node scripts/dev-with-proxy.mjs next dev      # pnpm dev
 *   LOCAL_PROXY=0 node scripts/dev-with-proxy.mjs next dev   # 关闭代理（直连生产源）
 *
 * 注入仅作用于本进程及子进程（构建期 NEXT_PUBLIC_*），不写入任何仓库文件；
 * 生产 `pnpm build` / `pnpm preview` / `pnpm deploy` 不经过本脚本，基址保持生产直连默认值（R10-b）。
 */

import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseProxyEnv, publicBases } from "./lib/local-proxy.mjs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/dev-with-proxy.mjs <command> [args...]");
  process.exit(2);
}

const useProxy = process.env.LOCAL_PROXY !== "0";
const env = { ...process.env };
let proxyChild = null;

if (useProxy) {
  const config = parseProxyEnv(process.env);
  const bases = publicBases(config.port);
  env.NEXT_PUBLIC_RECORDINGS_BASE_URL = bases.recordings;
  env.NEXT_PUBLIC_API_BASE_URL = bases.events;

  const proxyScript = fileURLToPath(new URL("./dev-proxy.mjs", import.meta.url));
  proxyChild = spawn(process.execPath, [proxyScript], { stdio: "inherit", env });
  proxyChild.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[dev-with-proxy] local proxy exited with code ${code}`);
    }
  });
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

child.on("exit", (code, signal) => {
  if (proxyChild && proxyChild.exitCode === null) proxyChild.kill("SIGTERM");
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
