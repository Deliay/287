import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { RecordingsSection, sortRecordings } from "@/features/recordings/recordings-section";
import { recordingFileUrl } from "@/features/recordings/api";
import { LiveStatusGrid } from "@/features/recordings/live-status-grid";
import type { RecordingStatusItem } from "@/features/recordings/types";
import { theme } from "@/theme";
import { GLYPH_RE, renderWithTheme } from "./utils";

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
  it("初始渲染不发出任何 recordings 请求（后加载，R14-1 点击前零请求）", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<RecordingsSection items={statusItems} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("recordings-group-viridis")).toBeInTheDocument();
  });

  it("点击分组头才请求对应房间；失败仅影响该分组并可重试（R14-1：进入视口不触发）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValue(jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }));
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<RecordingsSection items={statusItems} />);

    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
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

    renderWithTheme(<RecordingsSection items={statusItems} />);
    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
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

    renderWithTheme(<RecordingsSection items={statusItems} />);
    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
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

    renderWithTheme(<RecordingsSection items={statusItems} />);
    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.getByText("带空格")).toBeInTheDocument());

    const link = screen.getByTestId("recording-title").closest("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      `/recordings/replay?roomId=1001&file=${encodeURIComponent(fileName)}`,
    );
  });

  it("次要9 点击展开加载成功后分组转为展开态（aria-expanded / 箭头一致）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<RecordingsSection items={statusItems} />);
    expect(screen.getByTestId("recordings-group-viridis").querySelector("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
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

    // 用与 renderWithTheme 相同的包裹层渲染，保证 rerender 不会卸载重建分组（保留已请求状态）
    const renderTree = (items: RecordingStatusItem[], statusKind: "loading" | "ok") => (
      <MantineProvider theme={theme}>
        <RecordingsSection items={items} statusKind={statusKind} />
      </MantineProvider>
    );
    const { rerender } = rtlRender(renderTree([], "loading"));
    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
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

  it("R4 加载完成后可收起：列表隐藏且 aria-expanded=false，再展开复用数据不重新取数", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<RecordingsSection items={statusItems} />);
    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.getByText("游玩饥荒")).toBeInTheDocument());
    const header = screen.getByTestId("recordings-group-viridis").querySelector("button");
    expect(header).toHaveAttribute("aria-expanded", "true");

    // 收起：内容必须隐藏，ARIA 与可见性一致
    fireEvent.click(header as HTMLElement);
    expect(screen.queryByText("游玩饥荒")).not.toBeInTheDocument();
    expect(screen.getByTestId("recordings-group-viridis").querySelector("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    // 再展开：原数据回来且不重新取数
    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
    expect(screen.getByText("游玩饥荒")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("次要5 statusKind=error 时分组给出错误态，而非永远「等待直播状态」", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<RecordingsSection items={[]} statusKind="error" />);
    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
    await flushMicrotasks();

    expect(screen.getByText(/直播状态获取失败/)).toBeInTheDocument();
    expect(screen.queryByText(/等待直播状态/)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("次要5 状态卡片键盘可达：聚焦 + Enter 展开定位分组", async () => {
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

    renderWithTheme(
      <>
        <LiveStatusGrid />
        <RecordingsSection items={statusItems} />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("live-card-viridis")).toBeInTheDocument());

    const card = screen.getByTestId("live-card-viridis");
    expect(card).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(card, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByTestId("recordings-group-viridis").querySelector("button")).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );
  });

  it("次要6 点击展开与补跑 effect 双触发只取一次数（R14-1 后无视口触发面）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tree = (items: RecordingStatusItem[], statusKind: "loading" | "ok") => (
      <MantineProvider theme={theme}>
        <RecordingsSection items={items} statusKind={statusKind} />
      </MantineProvider>
    );
    const { rerender } = rtlRender(tree([], "loading"));
    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
    await flushMicrotasks(); // 点击展开 → 等待状态，未取数
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(tree(statusItems, "ok")); // 状态就绪 → 补跑（取数1 次）
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // R14-1 后唯一触发面为点击：加载完成后再收起/展开（两次点击）不得重复取数
    await waitFor(() => expect(screen.getByText("游玩饥荒")).toBeInTheDocument());
    const header = screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement;
    fireEvent.click(header);
    fireEvent.click(header);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("次要6 分组加载失败后，状态卡片再次定位会重试该分组", async () => {
    let recordingsAttempts = 0;
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("recording-status")) {
        return Promise.resolve(jsonResponse({ items: statusItems }));
      }
      recordingsAttempts += 1;
      if (recordingsAttempts === 1) {
        // 首次取该分组失败
        return Promise.resolve(new Response("boom", { status: 500 }));
      }
      return Promise.resolve(
        jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(
      <>
        <LiveStatusGrid />
        <RecordingsSection items={statusItems} />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("live-card-viridis")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
    await waitFor(() =>
      expect(screen.getByTestId("recordings-group-viridis").textContent).toContain("加载失败"),
    );

    fireEvent.click(screen.getByTestId("live-card-viridis"));
    // 断言收窄到分组列表（R14-2 后卡片标题可能回填同一文本，getByText 会命中多处）
    await waitFor(() =>
      expect(screen.getByTestId("recordings-viridis-list").textContent).toContain("游玩饥荒"),
    );
    const recordingsCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/b/live/1001/recordings"),
    );
    expect(recordingsCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("次要6 roomId 漂移后旧列表链接仍指向其数据来源房间", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tree = (items: RecordingStatusItem[]) => (
      <MantineProvider theme={theme}>
        <RecordingsSection items={items} />
      </MantineProvider>
    );
    const { rerender } = rtlRender(tree(statusItems));
    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.getByText("游玩饥荒")).toBeInTheDocument());
    const titleLink = () => screen.getByTestId("recording-title").closest("a") as HTMLAnchorElement;
    expect(titleLink().getAttribute("href")).toContain("roomId=1001");

    // 30s 轮询后房间号漂移：列表仍是 1001 的数据 → 链接不得被改成新房间
    const drifted = statusItems.map((item) =>
      item.mid === 1891335475 ? { ...item, roomId: 9999 } : item,
    );
    rerender(tree(drifted));
    expect(titleLink().getAttribute("href")).toContain("roomId=1001");
    expect(titleLink().getAttribute("href")).not.toContain("roomId=9999");
  });

  it("次要6 sortRecordings 对空串 startedAt 回退 createdAt 排序", () => {
    const files = [
      {
        name: "a",
        size: 1,
        createdAt: "2026-09-20T20:00:00.000Z",
        info: { recordingId: "r", title: "A", mid: 1, startedAt: "", endedAt: "" },
      },
      {
        name: "b",
        size: 1,
        createdAt: "2026-09-01T20:00:00.000Z",
        info: {
          recordingId: "r",
          title: "B",
          mid: 1,
          startedAt: "2026-09-15T20:00:00.000Z",
          endedAt: "2026-09-15T22:00:00.000Z",
        },
      },
    ];
    expect(sortRecordings(files).map((file) => file.name)).toEqual(["a", "b"]);
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
    // 断言收窄到分组列表（R14-2 后卡片标题回填「游玩饥荒」，getByText 会命中多处）
    await waitFor(() =>
      expect(screen.getByTestId("recordings-viridis-list").textContent).toContain("游玩饥荒"),
    );
  });

  it("R14-1 点击前零请求：挂载与进入视口均不发 recordings 请求，点击分组头才发对应房间请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    renderWithTheme(<RecordingsSection items={statusItems} />);
    // 模拟「进入视口」：旧实现在此即触发取数；R14-1 后实现不再创建观察器
    await act(async () => {
      for (const instance of [...MockIntersectionObserver.instances]) instance.trigger();
    });
    await flushMicrotasks();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/b/live/1001/recordings");
  });

  it("R14-5 分组头展开箭头为内联 SVG，不使用 Unicode 几何字形", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderWithTheme(<RecordingsSection items={statusItems} />);
    const header = screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement;
    expect(header.querySelector("svg")).not.toBeNull();
    expect(GLYPH_RE.test(header.textContent ?? "")).toBe(false);
  });

  it("R14-2② 未开播+sessionTitle 为 null+分组已点开缓存 → 卡片以缓存的最新一场 info.title 回填（零新增请求）", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("recording-status")) return Promise.resolve(jsonResponse({ items: statusItems }));
      return Promise.resolve(
        jsonResponse({ files: [makeFile("a.flv", "2026-09-20T20:00:00Z", { title: "四时小路的昨夜场" })] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(
      <>
        <LiveStatusGrid />
        <RecordingsSection items={statusItems} />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("live-card-komichi")).toBeInTheDocument());
    // 降级链③：缓存未建立时不展示标题行，且仅 1 次 status 请求
    expect(screen.getByTestId("live-card-komichi").querySelector("p")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 点开 komichi 分组 → 取数成功将最新一场 info.title 写入模块级缓存
    fireEvent.click(screen.getByTestId("recordings-group-komichi").querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.getByTestId("recordings-komichi-list")).toBeInTheDocument());

    // 降级链②：卡片回填缓存标题；标题来自缓存，不新增任何请求
    await waitFor(() =>
      expect(screen.getByTestId("live-card-komichi").textContent).toContain("四时小路的昨夜场"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("R14-2③ 未开播+null+无缓存 → 不展示标题行且零新增请求（降级链终点）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            mid: 1150976664,
            roomId: 1004,
            state: "not_live",
            sessionTitle: null,
            files: [],
            updatedAt: "2026-09-23T14:57:41.605Z",
            streamer: { name: "枝堇Sumire" },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<LiveStatusGrid />);
    await waitFor(() => expect(screen.getByTestId("live-card-sumire")).toBeInTheDocument());
    await flushMicrotasks();
    // 降级链③：无 sessionTitle 也无缓存（sumire 分组从未取数）→ 不渲染标题行
    expect(screen.getByTestId("live-card-sumire").querySelector("p")).toBeNull();
    // 不为标题新增任何请求（R14-1 前提）
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("R15-3 状态就绪补跑不强制展开用户已收起的分组（waiting 期间手动收起优先）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tree = (items: RecordingStatusItem[], statusKind: "loading" | "ok") => (
      <MantineProvider theme={theme}>
        <RecordingsSection items={items} statusKind={statusKind} />
      </MantineProvider>
    );
    const { rerender } = rtlRender(tree([], "loading"));
    const header = () =>
      screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement;

    fireEvent.click(header()); // 展开 → 等待直播状态（requestedRef 置位）
    await flushMicrotasks();
    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(header()); // 用户在等待期间手动收起（toggle 允许）
    expect(header()).toHaveAttribute("aria-expanded", "false");

    rerender(tree(statusItems, "ok")); // 状态就绪 → 补跑挂起的加载
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await flushMicrotasks();
    // 红：当前补跑复用 load() 首行无条件 setExpanded(true) → 分组被强制重新展开
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(fetchMock).toHaveBeenCalledTimes(1); // 静默加载，无重复取数
  });
});

describe("历史录播条目按钮组 播放/下载（T3 / AC-2 · FR-2 · 设计 §2.5）", () => {
  async function renderOneItem() {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ files: [makeFile("a.flv", "2026-09-23T20:00:00Z", { title: "游玩饥荒" })] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithTheme(<RecordingsSection items={statusItems} />);
    fireEvent.click(screen.getByTestId("recordings-group-viridis").querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.getByText("游玩饥荒")).toBeInTheDocument());
    const item = screen.getAllByTestId("recording-item")[0] as HTMLElement;
    return { fetchMock, item };
  }

  it("条目右侧渲染按钮组：主按钮「播放」href 与条目本体一致", async () => {
    const { item } = await renderOneItem();

    const titleLink = screen.getByTestId("recording-title").closest("a") as HTMLAnchorElement;
    const play = within(item).getByRole("link", { name: "播放" });
    expect(play.getAttribute("href")).toBe(titleLink.getAttribute("href"));
    expect(play.getAttribute("href")).toContain("/recordings/replay?roomId=1001&file=a.flv");
    // 下拉开关与「下载」在收起态不出现
    expect(within(item).getByRole("button", { name: /更多操作/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(item).queryByRole("link", { name: "下载" })).not.toBeInTheDocument();
  });

  it("点击下拉箭头展开菜单出现「下载」：href 指向 recordingFileUrl 且带 download（文件名一致）", async () => {
    const { item } = await renderOneItem();

    fireEvent.click(within(item).getByRole("button", { name: /更多操作/ }));
    const download = within(item).getByRole("link", { name: "下载" });
    expect(download.getAttribute("href")).toBe(recordingFileUrl(1001, "a.flv"));
    expect(download.getAttribute("download")).toBe("a.flv");
    expect(
      within(item).getByRole("button", { name: /更多操作/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("点击外部 / Esc 收起菜单；条目本体点击仍进回放页（不回归、零新增请求）", async () => {
    const { fetchMock, item } = await renderOneItem();
    const toggle = within(item).getByRole("button", { name: /更多操作/ });

    fireEvent.click(toggle);
    expect(within(item).queryByRole("link", { name: "下载" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(item).queryByRole("link", { name: "下载" })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    fireEvent.click(document.body);
    expect(within(item).queryByRole("link", { name: "下载" })).not.toBeInTheDocument();

    // 条目本体仍指向站内回放页，点击不触发任何取数（R14-1 不回归）
    const titleLink = screen.getByTestId("recording-title").closest("a") as HTMLAnchorElement;
    expect(titleLink.getAttribute("href")).toBe("/recordings/replay?roomId=1001&file=a.flv");
    fireEvent.click(titleLink);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("按钮组图标为内联 SVG、无 emoji/Unicode 字形（R14-5 口径）", async () => {
    const { item } = await renderOneItem();
    fireEvent.click(within(item).getByRole("button", { name: /更多操作/ }));

    const play = within(item).getByRole("link", { name: "播放" });
    const download = within(item).getByRole("link", { name: "下载" });
    const toggle = within(item).getByRole("button", { name: /更多操作/ });
    for (const node of [play, download, toggle]) {
      expect(node.querySelector("svg")).not.toBeNull();
    }
    expect(GLYPH_RE.test(item.textContent ?? "")).toBe(false);
  });
});

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
