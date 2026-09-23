import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import Page from "@/app/recordings/page";
import { renderWithTheme } from "./utils";

const { pathHolder } = vi.hoisted(() => ({ pathHolder: { current: "/recordings" } }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathHolder.current,
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("录播页组装（T8 / AC-2、AC-4）", () => {
  it("渲染「当前直播」「历史录播」两区块，首拉仅请求 recording-status 一个接口", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            mid: 1891335475,
            roomId: 1001,
            state: "not_live",
            sessionTitle: null,
            files: [],
            updatedAt: "2026-09-23T14:58:15.876Z",
            streamer: { name: "小松绿Viridis" },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<Page />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "当前直播" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "历史录播" })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^live-card-/)).toHaveLength(4);

    // 首屏只拉录制状态；录播列表进入视口才拉（AC-4）
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/b/live/recording-status");
  });

  it("页面 metadata 导出标题与描述", async () => {
    const mod = await import("@/app/recordings/page");
    expect(mod.metadata.title).toContain("录播");
    expect(typeof mod.metadata.description).toBe("string");
  });
});
