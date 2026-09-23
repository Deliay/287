import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, screen } from "@testing-library/react";
import { FloatingAudioPlayer } from "@/features/recordings/live-audio/floating-audio-player";
import {
  audioRegistry,
  setLivePlayerFactory,
  type LivePlayer,
  type LivePlayerFactory,
} from "@/features/recordings/live-audio/audio-player-registry";
import { renderWithTheme } from "./utils";

const meta = { label: "小松绿", colorKey: "viridis" };

function fakeFactory() {
  const created: LivePlayer[] = [];
  const ready: Array<() => void> = [];
  const factory: LivePlayerFactory = ({ onReady }) => {
    const player: LivePlayer = {
      setVolume: vi.fn(),
      destroy: vi.fn(),
    };
    created.push(player);
    ready.push(onReady);
    return player;
  };
  return { factory, created, ready };
}

let restore: (() => void) | null = null;

afterEach(() => {
  audioRegistry.stopAll();
  restore?.();
  restore = null;
  vi.restoreAllMocks();
});

describe("悬浮播放组件 FloatingAudioPlayer（T4 / AC-8）", () => {
  it("0 路时不渲染；play 一路后出现", () => {
    const { factory, ready } = fakeFactory();
    restore = setLivePlayerFactory(factory);

    const { rerender } = renderWithTheme(<FloatingAudioPlayer />);
    expect(screen.queryByTestId("floating-audio-player")).not.toBeInTheDocument();

    act(() => {
      audioRegistry.play(101, meta);
      ready[0]?.();
    });
    rerender(<FloatingAudioPlayer />);
    expect(screen.getByTestId("floating-audio-player")).toBeInTheDocument();
    expect(screen.getByText("小松绿")).toBeInTheDocument();
  });

  it("展开态渲染每路成员名与状态；单路停止调用 stop，全部停止清空", () => {
    const { factory, ready } = fakeFactory();
    restore = setLivePlayerFactory(factory);

    renderWithTheme(<FloatingAudioPlayer />);
    act(() => {
      audioRegistry.play(101, meta);
      audioRegistry.play(102, { label: "枝堇", colorKey: "sumire" });
      ready[0]?.();
    });

    expect(screen.getByText("小松绿")).toBeInTheDocument();
    expect(screen.getByText("枝堇")).toBeInTheDocument();
    expect(screen.getByText("播放中")).toBeInTheDocument();
    expect(screen.getByText("加载中…")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /停止小松绿/ })[0] as HTMLElement);
    expect(audioRegistry.getLanesSnapshot().map((lane) => lane.roomId)).toEqual([102]);

    fireEvent.click(screen.getByRole("button", { name: "全部停止" }));
    expect(audioRegistry.getLanesSnapshot()).toHaveLength(0);
  });

  it("收起/展开切换不改变注册表状态（播放不受影响）", () => {
    const { factory, ready } = fakeFactory();
    restore = setLivePlayerFactory(factory);

    renderWithTheme(<FloatingAudioPlayer />);
    act(() => {
      audioRegistry.play(101, meta);
      ready[0]?.();
    });

    const before = audioRegistry.getLanesSnapshot();
    fireEvent.click(screen.getByRole("button", { name: /收起/ }));
    expect(screen.queryByText("小松绿")).not.toBeInTheDocument();
    expect(screen.getByText(/在听 1 路/)).toBeInTheDocument();
    expect(audioRegistry.getLanesSnapshot()).toBe(before);

    fireEvent.click(screen.getByRole("button", { name: /展开/ }));
    expect(screen.getByText("小松绿")).toBeInTheDocument();
    expect(audioRegistry.getLanesSnapshot()).toBe(before);
    expect(screen.getByText("播放中")).toBeInTheDocument();
  });

  it("组件挂载于 root layout 且持有媒体元素宿主；路由子树卸载后注册表快照不变", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("<FloatingAudioPlayer />");
    expect(layout).toContain('from "@/features/recordings/live-audio/floating-audio-player"');

    const { factory } = fakeFactory();
    restore = setLivePlayerFactory(factory);

    const { rerender } = renderWithTheme(
      <>
        <FloatingAudioPlayer />
        <div data-testid="route-subtree">录制页</div>
      </>,
    );
    act(() => {
      audioRegistry.play(101, meta);
    });
    const snapshot = audioRegistry.getLanesSnapshot();
    // 模拟路由切换：仅子树卸载，悬浮组件（root layout 内）仍在
    rerender(
      <>
        <FloatingAudioPlayer />
      </>,
    );
    expect(screen.queryByTestId("route-subtree")).not.toBeInTheDocument();
    expect(screen.getByTestId("floating-audio-player")).toBeInTheDocument();
    expect(audioRegistry.getLanesSnapshot()).toBe(snapshot);

    // 媒体元素宿主内挂着该路 <video>（跨页不断流的载体）
    const host = screen.getByTestId("floating-audio-host");
    const video = host.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video?.getAttribute("data-lane-media")).toBe("true");
  });

  it("次要4 stop/stopAll 后宿主不残留孤儿 <video> 节点", async () => {
    const { factory } = fakeFactory();
    restore = setLivePlayerFactory(factory);

    const { rerender } = renderWithTheme(<FloatingAudioPlayer />);
    act(() => {
      audioRegistry.play(101, meta);
    });
    rerender(<FloatingAudioPlayer />);
    const host = screen.getByTestId("floating-audio-host");
    expect(host.querySelectorAll("video")).toHaveLength(1);

    act(() => {
      audioRegistry.stop(101);
    });
    rerender(<FloatingAudioPlayer />);
    expect(host.querySelectorAll("video")).toHaveLength(0);

    // 反复收听/停止不累积
    act(() => {
      audioRegistry.play(101, meta);
      audioRegistry.play(102, { label: "枝堇", colorKey: "sumire" });
      audioRegistry.stopAll();
    });
    rerender(<FloatingAudioPlayer />);
    expect(host.querySelectorAll("video")).toHaveLength(0);
  });
});
