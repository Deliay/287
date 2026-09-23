import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Page from "@/app/recordings/replay/page";
import {
  ReplayStage,
  type ReplayStageDeps,
} from "@/features/recordings/replay/replay-stage";
import type { LiveEvent, RecordingFile } from "@/features/recordings/types";
import { setMpegtsLoader, type MpegtsLike } from "@/features/recordings/replay/flv-player";
import { renderWithTheme } from "./utils";

const { paramsHolder } = vi.hoisted(() => ({ paramsHolder: { current: "" } }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(paramsHolder.current),
  usePathname: () => "/recordings/replay",
}));

const START_MS = Date.parse("2026-09-23T20:00:00.000Z");

const file: RecordingFile = {
  name: "游玩饥荒.flv",
  size: 1_000_000_000,
  createdAt: "2026-09-23T23:22:00.000Z",
  info: {
    recordingId: "rec-1",
    title: "游玩饥荒",
    mid: 1150976664,
    startedAt: "2026-09-23T20:00:00.000Z",
    endedAt: "2026-09-23T23:22:00.000Z",
  },
};

const bounds = { startMs: START_MS, endMs: START_MS + 3 * 3600 * 1000, fallback: false };

function makeEvent(id: string, offsetSeconds: number, content = id): LiveEvent {
  return {
    eventId: id,
    type: "danmaku",
    occurredAt: new Date(START_MS + offsetSeconds * 1000).toISOString(),
    sender: { uid: 1, name: "观众甲", face: "", medal: null, guardLevel: null },
    content,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeMpegts() {
  const player = {
    attachMediaElement: vi.fn(),
    load: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    seekToByteOffset: vi.fn(),
    setBufferLimits: vi.fn(),
  };
  const loader = () =>
    Promise.resolve({
      isSupported: () => true,
      createPlayer: vi.fn(() => player),
      Events: { MEDIA_INFO: "media_info", ERROR: "error" },
    } as unknown as MpegtsLike);
  return { player, loader };
}

function makeDeps(overrides: Partial<ReplayStageDeps> = {}): ReplayStageDeps {
  return {
    isPlaybackSupported: () => Promise.resolve(true),
    startReplay: vi.fn(() => Promise.resolve(true)),
    destroyReplay: vi.fn(),
    performSeek: vi.fn(() => Promise.resolve(true)),
    fetchEvents: vi.fn(() =>
      Promise.resolve({ total: 0, items: [] as LiveEvent[] }),
    ),
    ...overrides,
  };
}

let restoreLoader: (() => void) | null = null;

beforeEach(() => {
  paramsHolder.current = "";
});

afterEach(() => {
  restoreLoader?.();
  restoreLoader = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("回放页路由与页头（T13 / AC-5、AC-9 路由）", () => {
  it("缺少 roomId/file 参数 → 错误提示而非白屏", () => {
    paramsHolder.current = "roomId=abc";
    renderWithTheme(<Page />);
    expect(screen.getByTestId("replay-invalid")).toHaveTextContent("参数无效");
    expect(screen.getByRole("link", { name: /返回录播列表/ })).toHaveAttribute("href", "/recordings");
  });

  it("页头渲染录播标题（info.title 回源列表）与返回链接", async () => {
    paramsHolder.current = `roomId=1001&file=${encodeURIComponent(file.name)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/live-events/replay")) {
          return Promise.resolve(jsonResponse({ total: 0, page: 1, pageSize: 100, items: [] }));
        }
        return Promise.resolve(jsonResponse({ files: [file] }));
      }),
    );
    restoreLoader = setMpegtsLoader(fakeMpegts().loader);

    renderWithTheme(<Page />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "游玩饥荒" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /返回录播列表/ })).toHaveAttribute("href", "/recordings");
    expect(screen.getByText(/枝堇 Sumire/)).toBeInTheDocument();
    expect(screen.getByLabelText("录播视频")).toBeInTheDocument();
  });
});

describe("回放舞台 ReplayStage（T13 / AC-5、AC-6、AC-7）", () => {
  it("控件栏含播放/暂停、进度条、音量、倍速、全屏、弹幕开关", async () => {
    const deps = makeDeps();
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument());
    const group = screen.getByRole("group", { name: "播放控件" });
    expect(within(group).getByRole("slider", { name: "播放进度" })).toBeInTheDocument();
    expect(within(group).getByRole("slider", { name: "音量" })).toBeInTheDocument();
    expect(within(group).getByRole("combobox", { name: "倍速" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "全屏" })).toBeInTheDocument();
    const danmaku = within(group).getByRole("button", { name: /弹幕开关/ });
    expect(danmaku).toHaveAttribute("aria-pressed", "true");
    // 进度条含缓冲显示（已播放比例条）
    expect(screen.getByTestId("buffered-bar")).toBeInTheDocument();
  });

  it("事件列表随播放 offset 高亮当前条目，点击条目按锚点换算 seek", async () => {
    const events = [makeEvent("e1", 10, "第一条"), makeEvent("e2", 61, "第二条"), makeEvent("e3", 120, "第三条")];
    const fetchEvents = vi.fn(() => Promise.resolve({ total: events.length, items: events }));
    const performSeek = vi.fn(() => Promise.resolve(true));
    const deps = makeDeps({ fetchEvents, performSeek });

    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /第二条/ })).toBeInTheDocument());
    expect(fetchEvents).toHaveBeenCalled();

    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: 10_800, configurable: true });
    video.currentTime = 61;
    await act(async () => {
      fireEvent.timeUpdate(video);
    });

    const list = screen.getByTestId("event-list");
    const current = list.querySelector('[data-current="true"]');
    expect(current).toHaveTextContent("第二条");
    expect(current).not.toHaveTextContent("第三条");

    const entries = within(list).getAllByRole("button");
    fireEvent.click(entries[0] as HTMLElement);
    expect(performSeek).toHaveBeenCalledTimes(1);
    const seekArgs = (performSeek as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      targetSeconds: number;
      fileSize: number;
      url: string;
    };
    expect(seekArgs.targetSeconds).toBe(10); // occurredAt - info.startedAt（T9 锚点）
    expect(seekArgs.fileSize).toBe(file.size);
    expect(seekArgs.url).toContain(encodeURIComponent(file.name));
  });

  it("手动滚动停止自动跟随并出现「回到底部跟随」，点击恢复", async () => {
    const events = [makeEvent("e1", 10, "第一条"), makeEvent("e2", 61, "第二条")];
    const deps = makeDeps({ fetchEvents: () => Promise.resolve({ total: 2, items: events }) });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /第二条/ })).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: "回到底部跟随" })).not.toBeInTheDocument();
    fireEvent.scroll(screen.getByTestId("event-list"));
    expect(screen.getByRole("button", { name: "回到底部跟随" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "回到底部跟随" }));
    expect(screen.queryByRole("button", { name: "回到底部跟随" })).not.toBeInTheDocument();
  });

  it("MSE 降级：不支持时不初始化播放器并渲染降级文案", async () => {
    const deps = makeDeps({
      isPlaybackSupported: () => Promise.resolve(false),
      startReplay: vi.fn(() => Promise.resolve(true)),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);

    await waitFor(() => expect(screen.getByTestId("mse-degrade")).toBeInTheDocument());
    expect(screen.getByTestId("mse-degrade")).toHaveTextContent(
      "当前浏览器无法播放，请使用最新版 Chrome / Edge / Safari",
    );
    expect(deps.startReplay).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "播放控件" })).not.toBeInTheDocument();
  });

  it("页面卸载 → flv-player 销毁（不进悬浮组件，FR-6 边界）", async () => {
    const deps = makeDeps();
    const { unmount } = render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await waitFor(() => expect(deps.startReplay).toHaveBeenCalledTimes(1));
    const startArgs = (deps.startReplay as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      url: string;
      isLive?: boolean;
    };
    expect(startArgs.url).toContain("/recordings/");

    unmount();
    expect(deps.destroyReplay).toHaveBeenCalledTimes(1);
    expect(deps.destroyReplay).toHaveBeenCalledWith(startArgs.url);
  });

  it("seek 失败展示错误与重试（不白屏）", async () => {
    const performSeek = vi.fn(() => Promise.resolve(false));
    const deps = makeDeps({ performSeek });
    const events = [makeEvent("e1", 10, "第一条")];
    deps.fetchEvents = () => Promise.resolve({ total: 1, items: events });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /第一条/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /第一条/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("seek 失败"));
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
