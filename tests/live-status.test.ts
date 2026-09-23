import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type LiveStatusModule = typeof import("@/lib/live-status");

/** 每个用例重新加载模块，拿到全新的模块级缓存（AC-5 各用例互不串扰） */
async function loadLiveStatus(): Promise<LiveStatusModule> {
  vi.resetModules();
  return import("@/lib/live-status");
}

/** fetch 响应桩：仅 live-status 依赖的 ok / json 字段 */
function stubResponse(
  body: unknown,
  { ok = true, status = 200 } = {},
): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("直播状态拉取与缓存 live-status", () => {
  it("开播响应（live:true + title）解析为开播态，请求成员的 liveStatusUrl（AC-2）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      stubResponse({ ok: true, status: { live: true, title: "今晚杂谈" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mod = await loadLiveStatus();

    await expect(mod.fetchLiveStatus("viridis")).resolves.toEqual({
      living: true,
      title: "今晚杂谈",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.sumire.live/api/live/viridis/status",
    );
  });

  it("未开播响应（live:false）解析为未开播态", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      stubResponse({ ok: true, status: { live: false } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mod = await loadLiveStatus();

    await expect(mod.fetchLiveStatus("komichi")).resolves.toEqual({
      living: false,
      title: null,
    });
  });

  it("网络错误 / 非 2xx / 畸形 JSON / 字段缺失 / 结构不符一律降级为未开播且不抛出（AC-4）", async () => {
    const failureModes: Array<() => Promise<Response>> = [
      () => Promise.reject(new Error("network down")),
      () =>
        Promise.resolve(
          stubResponse({ error: "oops" }, { ok: false, status: 500 }),
        ),
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError("Unexpected token <")),
        } as unknown as Response),
      () => Promise.resolve(stubResponse({ ok: true, status: {} })),
      // 结构不符：没有 status 包装层
      () => Promise.resolve(stubResponse({ live: true, title: "x" })),
      // 结构不符：live 为真但缺 title，整体降级
      () => Promise.resolve(stubResponse({ ok: true, status: { live: true } })),
    ];

    for (const makeResponse of failureModes) {
      const fetchMock = vi.fn(makeResponse);
      vi.stubGlobal("fetch", fetchMock);
      const mod = await loadLiveStatus();
      await expect(mod.fetchLiveStatus("chu2u")).resolves.toEqual({
        living: false,
        title: null,
      });
    }
  });

  it("同 memberId 连续两次调用只发一次请求，两次结果一致（AC-5 单次请求）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      stubResponse({ ok: true, status: { live: true, title: "同一份" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mod = await loadLiveStatus();

    const first = await mod.fetchLiveStatus("chu2u");
    const second = await mod.fetchLiveStatus("chu2u");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("不同 memberId 各自独立请求", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(stubResponse({ ok: true, status: { live: false } }));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await loadLiveStatus();

    await mod.fetchLiveStatus("viridis");
    await mod.fetchLiveStatus("komichi");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.sumire.live/api/live/viridis/status",
      "https://api.sumire.live/api/live/komichi/status",
    ]);
  });

  it("按环境拼接请求地址：开发态走相对路径（dev 代理），非开发态直连接口域名", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const devFetch = vi
      .fn()
      .mockResolvedValue(stubResponse({ ok: true, status: { live: false } }));
    vi.stubGlobal("fetch", devFetch);
    const devMod = await loadLiveStatus();
    await devMod.fetchLiveStatus("sumire");
    expect(devFetch.mock.calls[0][0]).toBe("/api/live/status");

    vi.stubEnv("NODE_ENV", "production");
    const prodFetch = vi
      .fn()
      .mockResolvedValue(stubResponse({ ok: true, status: { live: false } }));
    vi.stubGlobal("fetch", prodFetch);
    const prodMod = await loadLiveStatus();
    await prodMod.fetchLiveStatus("sumire");
    expect(prodFetch.mock.calls[0][0]).toBe(
      "https://api.sumire.live/api/live/status",
    );
  });

  it("useLiveStatus 初始为 null（加载中），resolve 后更新为状态", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      stubResponse({ ok: true, status: { live: true, title: "标题" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mod = await loadLiveStatus();

    const { result } = renderHook(() => mod.useLiveStatus("viridis"));
    expect(result.current.status).toBeNull();

    await waitFor(() =>
      expect(result.current.status).toEqual({ living: true, title: "标题" }),
    );
  });
});
