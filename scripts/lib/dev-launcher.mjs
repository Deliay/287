/**
 * 启动器逻辑（可测单元，审核 R11-b）：反代就绪探测、启动决策与退出码归一。
 *
 * 核心不变量：**useProxy 开启时反代未就绪 → 不得继续启动目标命令**
 * （否则浏览器会以失效的注入基址全量网络失败，根因却在启动器）。
 */

/**
 * 探测本地反代健康端点：任一次 `ok` 即就绪；超时返回 false。
 *
 * 单次请求带 **attemptTimeoutMs** 上限（AbortController）——否则端口被哑进程占用时
 * fetch 会永久挂起，整体超时永远走不到，启动器将无限等待（审核 R11-b 实测症状）。
 * @param {string} origin 例如 http://127.0.0.1:8788
 * @param {{timeoutMs?: number, intervalMs?: number, attemptTimeoutMs?: number, fetchFn?: typeof fetch}} [options]
 * @returns {Promise<boolean>}
 */
export async function waitForProxyHealth(origin, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 100;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 1000;
  const fetchFn = options.fetchFn ?? fetch;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const controller = new AbortController();
    let attemptTimer;
    // 与定时器赛跑：即使 fetch 实现不理会 AbortSignal（哑端口/桩实现挂起），
    // 单次探测也会在 attemptTimeoutMs 内返回，整体超时判定永远能推进（审核 R11-b）
    const timeoutProbe = new Promise((resolve) => {
      attemptTimer = setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // abort 失败忽略
        }
        resolve(null);
      }, attemptTimeoutMs);
    });
    let response = null;
    try {
      response = await Promise.race([
        fetchFn(`${origin}/__proxy/health`, { signal: controller.signal }).catch(() => null),
        timeoutProbe,
      ]);
    } catch {
      response = null;
    } finally {
      clearTimeout(attemptTimer);
    }
    if (response && response.ok) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * 启动决策（纯函数）：
 * - useProxy 且反代未就绪 → `fail`（fail-fast，绝不带病继续注入基址）
 * - useProxy 且就绪 → `inject`（注入本地代理基址）
 * - 显式关闭代理 → `direct`（前端直连生产源）
 * @param {{useProxy: boolean, proxyReady: boolean}} input
 */
export function planLaunch({ useProxy, proxyReady }) {
  if (!useProxy) return { proceed: true, mode: "direct", reason: "proxy-disabled" };
  if (!proxyReady) return { proceed: false, mode: "fail", reason: "local-proxy-not-ready" };
  return { proceed: true, mode: "inject", reason: "ok" };
}

/**
 * 反代启动失败的可执行处置建议（fail-fast 输出）。
 * @param {number} port
 * @param {string | undefined} error
 */
export function proxyStartupFailureMessage(port, error) {
  const detail = error ? String(error) : "健康检查超时（未在期限内就绪）";
  return [
    `[dev-with-proxy] 本地反代启动失败（127.0.0.1:${port}）：${detail}`,
    "处置建议：",
    `  1) 端口被占用：LOCAL_PROXY_PORT=<其它端口> pnpm dev`,
    "  2) 不需要本地反代：LOCAL_PROXY=0 pnpm dev（前端直连生产源，需服务端 CORS 白名单）",
    "已中止启动：不会以失效的代理基址继续运行（避免浏览器全量网络失败而根因隐蔽）。",
  ].join("\n");
}

/**
 * 子进程退出码归一：code 优先；signal 映射 128+n（未知信号/双空不静默返回 0）。
 * @param {number | null} code
 * @param {NodeJS.Signals | null} signal
 * @param {Record<string, number>} [signals]
 */
export function exitCodeFor(code, signal, signals = { SIGINT: 2, SIGTERM: 15 }) {
  if (code !== null && code !== undefined) return code;
  const number = signal ? signals[signal] : undefined;
  return number !== undefined ? 128 + number : 1;
}
