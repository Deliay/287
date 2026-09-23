import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { RecordingsSection } from "@/features/recordings/recordings-section";
import { LiveStatusGrid } from "@/features/recordings/live-status-grid";
import type { RecordingStatusItem } from "@/features/recordings/types";
import { theme } from "@/theme";
import { renderWithTheme } from "./utils";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const statusItems: RecordingStatusItem[] = [
  {
    mid: 1891335475,
    roomId: 1001,
    state: "recording",
    sessionTitle: null,
    files: [],
    updatedAt: "2026-09-23T14:58:15.876Z",
    streamer: { name: "小松绿Viridis" },
  },
  {
    mid: 1512246445,
    roomId: 1002,
    state: "not_live",
    sessionTitle: null,
    files: [],
    updatedAt: "2026-09-23T14:57:41.605Z",
    streamer: { name: "四时小路Komichi" },
  },
];

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  private target: Element | null = null;
  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.target = target;
  }
  unobserve() {}
  disconnect() {}
  trigger(isIntersecting = true) {
    this.callback(
      [{ isIntersecting, target: this.target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  static reset() {
    MockIntersectionObserver.instances = [];
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  MockIntersectionObserver.reset();
});

function makeFile(name: string, startedAt: string, options: Partial<{ endedAt: string; title: string; size: number }> = {}) {
  return {
    name,
    size: options.size ?? 1024 * 1024 * 100,
    createdAt: options.endedAt ?? startedAt,
    ...(options.title === undefined
      ? {}
      : {
          info: {
            recordingId: "rec-1",
            title: options.title,
            mid: 1891335475,
            startedAt,
            endedAt: options.endedAt ?? startedAt,
          },
        }),
  };
}

describe("历史录播列表 RecordingsSection（T7 / AC-4）", () => {
  it("初始渲染不发出任何 recordings 请求（后加载）", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    renderWithTheme(<RecordingsSection items={statusItems} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(MockIntersectionObserver.instances).toHaveLength(4);
    expect(screen.getByTestId("recordings-group-viridis")).toBeInTheDocument();
  });

  it("分组进入视口才请求对应房间；失败仅影响该分组并可重试", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValue(jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    renderWithTheme(<RecordingsSection items={statusItems} />);

    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/b/live/1001/recordings");
    expect(await screen.findByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.getByText(/加载失败/)).toBeInTheDocument();

    // 其他分组未受影响（未请求、无错误）
    expect(screen.getByTestId("recordings-group-komichi").textContent).not.toContain("加载失败");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重试" }));
    });
    await waitFor(() => expect(screen.getByText("游玩饥荒")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });

  it("列表按 startedAt 倒序；info 缺失回退文件名", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        files: [
          makeFile("older.flv", "2026-09-01T20:00:00Z", { title: "较早的直播", endedAt: "2026-09-01T22:00:00Z" }),
          makeFile("newer.flv", "2026-09-20T20:00:00Z", { title: "较新的直播", endedAt: "2026-09-20T22:00:00Z" }),
          makeFile("no-info.flv", "2026-09-10T20:00:00Z"),
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    renderWithTheme(<RecordingsSection items={statusItems} />);
    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger();
    });
    await waitFor(() => expect(screen.getByText("较新的直播")).toBeInTheDocument());

    const titles = within(screen.getByTestId("recordings-viridis-list"))
      .getAllByTestId("recording-title")
      .map((node) => node.textContent);
    // info.startedAt 缺失的文件按 createdAt 参与同一倒序
    expect(titles).toEqual(["较新的直播", "no-info.flv", "较早的直播"]);
    // 时长来自 endedAt - startedAt
    expect(screen.getByTestId("recordings-viridis-list").textContent).toContain("2小时0分");
  });

  it("21 条数据分页：第 1 页 20 条 + 分页控件，翻页渲染第 21 条", async () => {
    const files = Array.from({ length: 21 }, (_, index) =>
      makeFile(`file-${index}.flv`, `2026-09-20T${String(23 - (index % 24)).padStart(2, "0")}:00:00Z`, {
        title: `第 ${index + 1} 场`,
        endedAt: `2026-09-21T0${index % 10}:00:00Z`,
      }),
    );
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ files }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    renderWithTheme(<RecordingsSection items={statusItems} />);
    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger();
    });
    await waitFor(() => expect(screen.getByText("第 1 场")).toBeInTheDocument());

    const list = screen.getByTestId("recordings-viridis-list");
    expect(within(list).getAllByTestId("recording-item")).toHaveLength(20);
    expect(screen.getByText(/第 1 \/ \d+ 页|1 \/ 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(screen.getByTestId("recordings-viridis-list").textContent).toContain("第 21 场"),
    );
    expect(
      within(screen.getByTestId("recordings-viridis-list")).getAllByTestId("recording-item"),
    ).toHaveLength(1);
  });

  it("条目链接 href 含正确 roomId 与编码后的文件名", async () => {
    const fileName = "[RAW][1001] 空格.flv";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ files: [makeFile(fileName, "2026-09-20T20:00:00Z", { title: "带空格" })] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    renderWithTheme(<RecordingsSection items={statusItems} />);
    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger();
    });
    await waitFor(() => expect(screen.getByText("带空格")).toBeInTheDocument());

    const link = within(screen.getByTestId("recordings-viridis-list")).getByRole("link");
    expect(link.getAttribute("href")).toBe(
      `/recordings/replay?roomId=1001&file=${encodeURIComponent(fileName)}`,
    );
  });

  it("次要9 视口触发加载成功后分组转为展开态（aria-expanded / 箭头一致）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    renderWithTheme(<RecordingsSection items={statusItems} />);
    expect(screen.getByTestId("recordings-group-viridis").querySelector("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger();
    });
    await waitFor(() => expect(screen.getByText("游玩饥荒")).toBeInTheDocument());
    expect(screen.getByTestId("recordings-group-viridis").querySelector("button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("次要9 recording-status 未就绪时不误判空态（先加载态，就绪后再取数）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    // 用与 renderWithTheme 相同的包裹层渲染，保证 rerender 不会卸载重建分组（保留已请求状态）
    const renderTree = (items: RecordingStatusItem[], statusKind: "loading" | "ok") => (
      <MantineProvider theme={theme}>
        <RecordingsSection items={items} statusKind={statusKind} />
      </MantineProvider>
    );
    const { rerender } = rtlRender(renderTree([], "loading"));
    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger();
    });
    await flushMicrotasks();
    expect(screen.queryByText("暂无录播")).not.toBeInTheDocument();
    expect(screen.getByText(/等待直播状态/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // 状态就绪后自动补取该分组
    rerender(renderTree(statusItems, "ok"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/b/live/1001/recordings");
    await waitFor(() => expect(screen.getByText("游玩饥荒")).toBeInTheDocument());
    expect(screen.queryByText("暂无录播")).not.toBeInTheDocument();
  });

  it("次要6 状态卡片点击（按钮以外区域）展开并定位对应录播分组", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("recording-status")) {
        return Promise.resolve(jsonResponse({ items: statusItems }));
      }
      return Promise.resolve(
        jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    renderWithTheme(
      <>
        <LiveStatusGrid />
        <RecordingsSection items={statusItems} />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("live-card-viridis")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("live-card-viridis"));
    await waitFor(() =>
      expect(screen.getByTestId("recordings-group-viridis").querySelector("button")).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/b/live/1001/recordings");
    expect(screen.getByText("游玩饥荒")).toBeInTheDocument();
  });
});

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
