import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { LiveStatusGrid, useRecordingStatus } from "@/features/recordings/live-status-grid";
import { FloatingAudioPlayer } from "@/features/recordings/live-audio/floating-audio-player";
import {
  audioRegistry,
  setLivePlayerFactory,
  type LivePlayer,
  type LivePlayerFactory,
} from "@/features/recordings/live-audio/audio-player-registry";
import { renderWithTheme } from "./utils";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** 四位成员的录制状态：小松绿直播中，其余未开播 */
const statusSample = {
  items: [
    {
      mid: 1891335475,
      roomId: 1001,
      state: "recording",
      sessionTitle: "重生之我是钓鱼大师",
      files: ["a.flv"],
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
    {
      mid: 2138961136,
      roomId: 1003,
      state: "not_live",
      sessionTitle: null,
      files: [],
      updatedAt: "2026-09-23T14:57:41.605Z",
      streamer: { name: "羽啾chu2u" },
    },
    {
      mid: 1150976664,
      roomId: 1004,
      state: "recording",
      sessionTitle: "好空灵啊",
      files: ["b.flv"],
      updatedAt: "2026-09-23T14:58:16.339Z",
      streamer: { name: "枝堇Sumire" },
    },
  ],
};

let restoreFactory: (() => void) | null = null;

afterEach(() => {
  audioRegistry.stopAll();
  restoreFactory?.();
  restoreFactory = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
});

function fakePlayers() {
  const ready: Array<() => void> = [];
  const created: LivePlayer[] = [];
  const factory: LivePlayerFactory = ({ onReady }) => {
    const player: LivePlayer = { setVolume: vi.fn(), destroy: vi.fn() };
    created.push(player);
    ready.push(onReady);
    return player;
  };
  return { factory, ready, created };
}

describe("直播状态列表 LiveStatusGrid / useRecordingStatus（T6 / AC-2、AC-3 UI）", () => {
  it("四张卡片按成员顺序渲染，直播中/未开播徽标与直播标题正确", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(statusSample)));
    renderWithTheme(<LiveStatusGrid />);

    await waitFor(() => expect(screen.getByText("重生之我是钓鱼大师")).toBeInTheDocument());

    const names = screen.getAllByTestId(/^live-card-/).map((card) => card.getAttribute("data-testid"));
    expect(names).toEqual([
      "live-card-viridis",
      "live-card-komichi",
      "live-card-chu2u",
      "live-card-sumire",
    ]);
    expect(screen.getAllByText("直播中")).toHaveLength(2);
    expect(screen.getAllByText("未开播")).toHaveLength(2);
    expect(screen.getByText("好空灵啊")).toBeInTheDocument();
    // 未开播卡片不显示他人直播标题（成员名 h3 始终存在，故断言整卡文本）
    expect(screen.getByTestId("live-card-komichi").textContent).not.toContain("重生之我是钓鱼大师");
    expect(screen.getByTestId("live-card-komichi").textContent).not.toContain("好空灵啊");
    expect(screen.getAllByText(/^更新于/)).toHaveLength(4);
  });

  it("假定时器：30s 轮询一次；页面隐藏暂停，恢复可见立即刷新", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(statusSample));
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useRecordingStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    await act(async () => {
      fireEvent(document, new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("接口缺失某成员时该卡片兜底「未开播」", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ items: statusSample.items.slice(0, 1) })),
    );
    renderWithTheme(<LiveStatusGrid />);

    await waitFor(() => expect(screen.getAllByText("未开播")).toHaveLength(3));
    expect(screen.getAllByText("直播中")).toHaveLength(1);
    const komichi = screen.getByTestId("live-card-komichi");
    expect(komichi).toHaveTextContent("未开播");
    expect(komichi.querySelector("button")).toBeDisabled();
  });

  it("听直播按钮：直播中点击调用 play，收听中点击调用 stop", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(statusSample)));
    const { factory, ready } = fakePlayers();
    restoreFactory = setLivePlayerFactory(factory);

    renderWithTheme(<LiveStatusGrid />);
    await waitFor(() => expect(screen.getByText("重生之我是钓鱼大师")).toBeInTheDocument());

    const viridis = screen.getByTestId("live-card-viridis");
    const listen = viridis.querySelector("button") as HTMLButtonElement;
    expect(listen).toHaveTextContent("听直播");
    expect(listen).not.toBeDisabled();

    fireEvent.click(listen);
    expect(audioRegistry.getLanesSnapshot()).toHaveLength(1);
    expect(audioRegistry.getLanesSnapshot()[0]?.roomId).toBe(1001);
    expect(audioRegistry.getLanesSnapshot()[0]?.label).toBe("小松绿");

    act(() => {
      ready[0]?.();
    });
    const stopButton = screen.getByTestId("live-card-viridis").querySelector(
      "button",
    ) as HTMLButtonElement;
    expect(stopButton).toHaveTextContent("停止收听");

    fireEvent.click(stopButton);
    expect(audioRegistry.getLanesSnapshot()).toHaveLength(0);
    expect(
      screen.getByTestId("live-card-viridis").querySelector("button"),
    ).toHaveTextContent("听直播");
  });

  it("接口失败显示错误文案与重试，不白屏；重试成功后恢复卡片", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValue(jsonResponse(statusSample));
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<LiveStatusGrid />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument(),
    );
    expect(screen.getByText(/直播状态获取失败/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByText("重生之我是钓鱼大师")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("单路收听失败仅该卡片显示重试入口", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(statusSample)));
    const created: LivePlayer[] = [];
    const errors: Array<() => void> = [];
    restoreFactory = setLivePlayerFactory(({ onError }) => {
      const player: LivePlayer = { setVolume: vi.fn(), destroy: vi.fn() };
      created.push(player);
      errors.push(onError);
      return player;
    });

    renderWithTheme(<LiveStatusGrid />);
    await waitFor(() => expect(screen.getByText("重生之我是钓鱼大师")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("live-card-viridis").querySelector("button") as HTMLElement);
    act(() => {
      errors[0]?.();
    });
    expect(screen.getByRole("button", { name: /重试小松绿/ })).toBeInTheDocument();
    expect(screen.getByTestId("live-card-sumire").querySelector("button")).toHaveTextContent("听直播");
  });

  it("R12-b/R13-b/R13-c 无 MSE 降级交互口径：卡片纯文案（按真实可访问名断言），悬浮保留逐路✕+全部停止、无音量滑杆、无重试", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(statusSample)));
    restoreFactory = setLivePlayerFactory(() =>
      Promise.reject(Object.assign(new Error("当前浏览器不支持 MSE"), { code: "MSE_UNSUPPORTED" })),
    );
    renderWithTheme(
      <>
        <LiveStatusGrid />
        <FloatingAudioPlayer />
      </>,
    );
    await waitFor(() => expect(screen.getByText("重生之我是钓鱼大师")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("live-card-viridis").querySelector("button") as HTMLElement);
    await waitFor(() =>
      expect(screen.getAllByText(/当前浏览器无法播放/).length).toBeGreaterThan(0),
    );

    const card = screen.getByTestId("live-card-viridis");
    const floating = screen.getByTestId("floating-audio-player");
    // 状态卡片与悬浮组件**各自**同步呈现降级文案（PRD §5 兼容性，审核 R12-b）
    expect(card.textContent).toContain("当前浏览器无法播放");
    expect(floating.textContent).toContain("当前浏览器无法播放");

    // 卡片作用域：纯文案 span，无听/停/重试入口——按**真实可访问名**断言
    // （旧断言 /停止收听/ 匹配不到 aria-label「停止小松绿」，恒真，审核 R13-b）
    expect(within(card).queryByRole("button", { name: /^听/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /^停止/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /重试/ })).not.toBeInTheDocument();

    // 悬浮作用域唯一口径（审核 R13-c）：保留逐路 ✕ 停止（该路唯一移除入口）与「全部停止」
    expect(within(floating).queryByRole("button", { name: /^停止/ })).toBeInTheDocument();
    expect(within(floating).getByRole("button", { name: "全部停止" })).toBeInTheDocument();
    // unsupported 路无 player → 移除无意义的音量滑杆（红：当前仍渲染 range）
    expect(within(floating).queryByRole("slider")).not.toBeInTheDocument();
    expect(within(floating).queryByRole("button", { name: /重试/ })).not.toBeInTheDocument();
  });

  it("次要5 并发竞态：旧响应不得覆盖新数据（轮询/重试/visibility 叠加）", async () => {
    const oldItem = {
      mid: 1891335475,
      roomId: 1001,
      state: "recording",
      sessionTitle: "旧标题",
      files: [],
      updatedAt: "2026-09-23T14:58:15.876Z",
      streamer: { name: "小松绿Viridis" },
    };
    const newItem = { ...oldItem, sessionTitle: "新标题" };

    // 由对象持有：闭包内赋值，避免 TS 把变量收窄成 never
    const holder: { resolve: ((response: Response) => void) | null } = { resolve: null };
    const first = new Promise<Response>((resolve) => {
      holder.resolve = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockImplementation(() => Promise.resolve(jsonResponse({ items: [newItem] })));
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<LiveStatusGrid />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // 首拉挂起

    // 第二次请求（恢复可见立即刷新）先返回
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByText("新标题")).toBeInTheDocument());

    // 旧响应迟到 → 不得覆盖新数据
    holder.resolve?.(jsonResponse({ items: [oldItem] }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("旧标题")).not.toBeInTheDocument();
    expect(screen.getByText("新标题")).toBeInTheDocument();
  });
});
