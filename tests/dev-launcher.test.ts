import { describe, expect, it, vi } from "vitest";
import {
  exitCodeFor,
  planLaunch,
  proxyStartupFailureMessage,
  waitForProxyHealth,
} from "../scripts/lib/dev-launcher.mjs";

describe("启动器决策（R11-b：不得带病继续）", () => {
  it("planLaunch：代理未就绪 → 不继续（fail-fast）；就绪 → 注入基址；显式关闭 → 直连", () => {
    // 红：当前启动器在反代失败时仍以注入基址继续运行 next dev
    expect(planLaunch({ useProxy: true, proxyReady: false })).toEqual({
      proceed: false,
      mode: "fail",
      reason: "local-proxy-not-ready",
    });
    expect(planLaunch({ useProxy: true, proxyReady: true })).toEqual({
      proceed: true,
      mode: "inject",
      reason: "ok",
    });
    expect(planLaunch({ useProxy: false, proxyReady: false })).toEqual({
      proceed: true,
      mode: "direct",
      reason: "proxy-disabled",
    });
  });

  it("proxyStartupFailureMessage 含端口与处置建议（端口占用 / 关闭代理）", () => {
    const message = proxyStartupFailureMessage(8788, "EADDRINUSE");
    expect(message).toContain("8788");
    expect(message).toContain("EADDRINUSE");
    expect(message).toContain("LOCAL_PROXY_PORT");
    expect(message).toContain("LOCAL_PROXY=0");
    expect(message).toContain("已中止启动"); // 明示 fail-fast，不带病继续
  });
});

describe("反代就绪探测（R11-b）", () => {
  it("health 返回 ok 即就绪（true），且不再继续轮询", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    await expect(
      waitForProxyHealth("http://127.0.0.1:8788", { timeoutMs: 500, intervalMs: 10, fetchFn }),
    ).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("R11-b 单次健康探测请求挂起时也必须按超时返回 false（不得无限等待带病继续）", async () => {
    const hanging = () => new Promise<{ ok: boolean }>(() => {}); // 永不 resolve（端口被哑进程占用的真实症状）
    const started = Date.now();
    const result = await waitForProxyHealth("http://127.0.0.1:8788", {
      timeoutMs: 120,
      intervalMs: 10,
      attemptTimeoutMs: 40,
      fetchFn: hanging,
    });
    expect(result).toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000); // 红：当前实现会在首个挂起的 fetch 上永久阻塞
  });

  it("持续失败/超时 → false（启动器据此 fail-fast）", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const started = Date.now();
    await expect(
      waitForProxyHealth("http://127.0.0.1:8788", { timeoutMs: 60, intervalMs: 10, fetchFn }),
    ).resolves.toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("exitCodeFor：code 优先；signal 映射为 128+n，未知信号/双空不静默为 0", () => {
    expect(exitCodeFor(0, null)).toBe(0);
    expect(exitCodeFor(3, "SIGTERM")).toBe(3);
    expect(exitCodeFor(null, "SIGTERM")).toBe(143);
    expect(exitCodeFor(null, "SIGINT")).toBe(130);
    expect(exitCodeFor(null, "SIGKILL")).toBe(1);
    expect(exitCodeFor(null, null)).toBe(1);
  });
});
