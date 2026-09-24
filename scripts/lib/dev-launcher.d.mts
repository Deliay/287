/** `scripts/lib/dev-launcher.mjs` 的类型声明（审核 R11-b）。 */

export interface LaunchPlan {
  proceed: boolean;
  mode: "inject" | "direct" | "fail";
  reason: "ok" | "proxy-disabled" | "local-proxy-not-ready";
}

export interface ProxyHealthOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** 单次探测请求上限（AbortSignal），防止哑端口让 fetch 永久挂起（R11-b）。 */
  attemptTimeoutMs?: number;
  fetchFn?: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean }>;
}

/** 探测本地反代健康端点：任一次 ok 即就绪；超时返回 false。 */
export function waitForProxyHealth(origin: string, options?: ProxyHealthOptions): Promise<boolean>;

/** 启动决策：反代未就绪一律 fail-fast（不得带病继续注入基址）。 */
export function planLaunch(input: { useProxy: boolean; proxyReady: boolean }): LaunchPlan;

/** 反代启动失败的处置建议文案。 */
export function proxyStartupFailureMessage(port: number, error?: string): string;

/** 子进程退出码归一：code 优先，signal 映射 128+n，未知/双空返回 1（不静默 0）。 */
export function exitCodeFor(
  code: number | null,
  signal: string | null,
  signals?: Record<string, number>,
): number;
