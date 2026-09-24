import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { LiveStatusGrid } from "@/features/recordings/live-status-grid";
import { FloatingAudioPlayer } from "@/features/recordings/live-audio/floating-audio-player";
import {
  MSE_DEGRADE_TEXT,
  audioRegistry,
} from "@/features/recordings/live-audio/audio-player-registry";
import { renderWithTheme } from "./utils";

/** mpegts 替身：模拟无 MSE 的浏览器（isSupported() === false），记录 createPlayer 是否被调用 */
const mocks = vi.hoisted(() => ({
  createPlayer: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    attachMediaElement: vi.fn(),
    load: vi.fn(),
    play: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock("mpegts.js", () => ({
  default: {
    isSupported: () => false,
    createPlayer: mocks.createPlayer,
    Events: { MEDIA_INFO: "media_info", ERROR: "error" },
  },
}));

/** 四位成员录制状态：小松绿直播中，其余未开播（与 live-status 样本一致的最小形态） */
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

afterEach(() => {
  audioRegistry.stopAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("第十一轮审核返工：R13（生产路径 MSE 探测）", () => {
  it("R13-a 生产路径：无 MSE 时 defaultLivePlayerFactory 探测并进入 unsupported（createPlayer 不被调用），卡片与悬浮呈现降级文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(statusSample), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    renderWithTheme(
      <>
        <LiveStatusGrid />
        <FloatingAudioPlayer />
      </>,
    );
    await waitFor(() => expect(screen.getByText("重生之我是钓鱼大师")).toBeInTheDocument());

    // 不注入工厂：走模块级 audioRegistry → defaultLivePlayerFactory 真实生产路径
    fireEvent.click(screen.getByTestId("live-card-viridis").querySelector("button") as HTMLElement);

    // 红：当前工厂无 isSupported 探测 → 落入 createPlayer（无 MSE 时真实环境同步 TypeError）→ 永停 loading
    await waitFor(() =>
      expect(audioRegistry.getLanesSnapshot().find((lane) => lane.roomId === 1001)?.state).toBe(
        "unsupported",
      ),
    );
    expect(mocks.createPlayer).not.toHaveBeenCalled();
    expect(screen.getByTestId("live-card-viridis").textContent).toContain(MSE_DEGRADE_TEXT);
    expect(screen.getByTestId("floating-audio-player").textContent).toContain(MSE_DEGRADE_TEXT);
  });
});
