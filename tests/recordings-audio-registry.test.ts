import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAudioPlayerRegistry,
  MAX_AUDIO_LANES,
  type LivePlayer,
  type LivePlayerFactory,
} from "@/features/recordings/live-audio/audio-player-registry";

interface FakePlayer extends LivePlayer {
  url: string;
  media: HTMLVideoElement;
  volume: number;
  destroyed: boolean;
  emitReady(): void;
  emitError(): void;
}

function makeFactory() {
  const created: FakePlayer[] = [];
  const factory: LivePlayerFactory = ({ url, media, volume, onReady, onError }) => {
    const player: FakePlayer = {
      url,
      media,
      volume,
      destroyed: false,
      setVolume(next: number) {
        player.volume = next;
        media.volume = next;
      },
      destroy() {
        player.destroyed = true;
      },
      emitReady() {
        onReady();
      },
      emitError() {
        onError();
      },
    };
    created.push(player);
    return player;
  };
  return { factory, created };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("多路音频注册表（T3 / AC-3）", () => {
  it("依次 play 四个 roomId：快照含 4 路且状态互不影响", () => {
    const { factory, created } = makeFactory();
    const registry = createAudioPlayerRegistry(factory);

    [1, 2, 3, 4].forEach((roomId) => expect(registry.play(roomId)).toBe(true));
    expect(registry.getLanesSnapshot()).toHaveLength(4);
    expect(registry.getLanesSnapshot().map((lane) => lane.roomId)).toEqual([1, 2, 3, 4]);
    expect(registry.getLanesSnapshot().every((lane) => lane.state === "loading")).toBe(true);

    created[1]?.emitReady();
    const states = registry.getLanesSnapshot().map((lane) => lane.state);
    expect(states).toEqual(["loading", "playing", "loading", "loading"]);

    created[1]?.emitError();
    expect(registry.getLanesSnapshot().map((lane) => lane.state)).toEqual([
      "loading",
      "error",
      "loading",
      "loading",
    ]);
  });

  it("play 同 roomId 两次幂等（不重复创建 player）", () => {
    const { factory, created } = makeFactory();
    const registry = createAudioPlayerRegistry(factory);

    registry.play(7);
    registry.play(7);
    expect(created).toHaveLength(1);
    expect(registry.getLanesSnapshot()).toHaveLength(1);
  });

  it("第 5 路 play 被拒绝（上限 4 路）", () => {
    const { factory, created } = makeFactory();
    const registry = createAudioPlayerRegistry(factory);

    [1, 2, 3, 4].forEach((roomId) => registry.play(roomId));
    expect(registry.play(5)).toBe(false);
    expect(registry.getLanesSnapshot()).toHaveLength(MAX_AUDIO_LANES);
    expect(created).toHaveLength(4);
  });

  it("stop 单路后其余路仍在；stopAll 清空", () => {
    const { factory, created } = makeFactory();
    const registry = createAudioPlayerRegistry(factory);
    [1, 2, 3, 4].forEach((roomId) => registry.play(roomId));

    registry.stop(2);
    expect(registry.getLanesSnapshot().map((lane) => lane.roomId)).toEqual([1, 3, 4]);
    expect(created[1]?.destroyed).toBe(true);
    expect(created[0]?.destroyed).toBe(false);

    registry.stopAll();
    expect(registry.getLanesSnapshot()).toHaveLength(0);
    expect(created.every((player) => player.destroyed)).toBe(true);
  });

  it("单路 error 仅标记该 lane；retry 重建该路回到 loading", () => {
    const { factory, created } = makeFactory();
    const registry = createAudioPlayerRegistry(factory);
    registry.play(1);
    registry.play(2);
    created[0]?.emitReady();
    created[1]?.emitReady();

    created[0]?.emitError();
    expect(registry.getLanesSnapshot().map((lane) => lane.state)).toEqual(["error", "playing"]);
    expect(created[1]?.destroyed).toBe(false);

    expect(registry.retry(1)).toBe(true);
    expect(registry.getLanesSnapshot().map((lane) => lane.state)).toEqual(["loading", "playing"]);
    expect(created).toHaveLength(3);
    expect(created[0]?.destroyed).toBe(true);
    expect(registry.retry(99)).toBe(false);
  });

  it("setVolume 独立作用于各路；subscribeLanes 在状态变更时触发、快照只读且稳定", () => {
    const { factory, created } = makeFactory();
    const registry = createAudioPlayerRegistry(factory);

    const listener = vi.fn();
    const unsubscribe = registry.subscribeLanes(listener);
    registry.play(1);
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(1);

    registry.setVolume(1, 0.4);
    expect(registry.getLanesSnapshot()[0]?.volume).toBe(0.4);
    expect(created[0]?.volume).toBe(0.4);

    const snapshot = registry.getLanesSnapshot();
    expect(registry.getLanesSnapshot()).toBe(snapshot); // 未变更时保持同一引用
    expect(Object.isFrozen(snapshot)).toBe(true);

    created[0]?.emitReady();
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);

    unsubscribe();
    const before = listener.mock.calls.length;
    registry.stopAll();
    expect(listener).toHaveBeenCalledTimes(before);
  });

  it("媒体元素按路创建并可枚举（供悬浮组件宿主挂载）", () => {
    const { factory } = makeFactory();
    const registry = createAudioPlayerRegistry(factory);
    registry.play(11);
    registry.play(12);

    const elements = registry.getMediaElements();
    expect(elements).toHaveLength(2);
    expect(elements[0]?.roomId).toBe(11);
    expect(elements[0]?.element.tagName).toBe("VIDEO");
    registry.stop(11);
    expect(registry.getMediaElements().map((entry) => entry.roomId)).toEqual([12]);
  });

  it("次要4 onReady 早于异步 settle 时该路仍进入 playing（不卡加载中）", async () => {
    const factory: LivePlayerFactory = (args) => {
      // 模拟 mpegts 动态 import：就绪事件先于 Promise settle
      args.onReady();
      return Promise.resolve({ setVolume: vi.fn(), destroy: vi.fn() });
    };
    const registry = createAudioPlayerRegistry(factory);

    expect(registry.play(55)).toBe(true);
    expect(registry.getLanesSnapshot()[0]?.state).toBe("loading");
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(registry.getLanesSnapshot()[0]?.state).toBe("playing");
  });

  it("R12-b MSE 不可用 → 该路进入不可重试的降级态（unsupported）+ 降级文案由 UI 呈现", async () => {
    const factory: LivePlayerFactory = () =>
      Promise.reject(Object.assign(new Error("当前浏览器不支持 MSE"), { code: "MSE_UNSUPPORTED" }));
    const registry = createAudioPlayerRegistry(factory);

    expect(registry.play(7)).toBe(true);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(registry.getLanesSnapshot()[0]?.state).toBe("unsupported"); // 红：当前折算成可重试的 error
    expect(registry.retry(7)).toBe(false); // 降级态不可重试（重试无意义）
    expect(registry.getLanesSnapshot()[0]?.state).toBe("unsupported");
  });

  it("R12-d(1) onReady 先到 → onError → settle：终态必须 error（不得假「播放中」）", async () => {
    const holder: { cb?: { onReady: () => void; onError: () => void } } = {};
    let settle!: (value: LivePlayer | PromiseLike<LivePlayer>) => void;
    const factory: LivePlayerFactory = (args) => {
      holder.cb = args;
      return new Promise((resolve) => {
        settle = resolve;
      });
    };
    const registry = createAudioPlayerRegistry(factory);
    registry.play(8);

    holder.cb?.onReady(); // 就绪事件先于 settle（player 尚未挂上）
    holder.cb?.onError(); // 随后失败
    settle({ setVolume: vi.fn(), destroy: vi.fn() });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(registry.getLanesSnapshot()[0]?.state).toBe("error"); // 红：settle 见 readyPending 强改 playing
  });

  it("R12-d(2) retry 复位 readyPending：新 player 未就绪前不得显示 playing", async () => {
    let firstFactoryCall = true;
    const factory: LivePlayerFactory = (args) => {
      if (firstFactoryCall) {
        firstFactoryCall = false;
        args.onReady(); // 先到的就绪事件（落进 readyPending）
        return new Promise<never>(() => {}); // 永不 settle
      }
      // 新一代：不发 onReady 就直接交付 player（模拟「还没就绪」）
      return { setVolume: vi.fn(), destroy: vi.fn() };
    };
    const registry = createAudioPlayerRegistry(factory);
    registry.play(9);
    expect(registry.getLanesSnapshot()[0]?.state).toBe("loading");

    expect(registry.retry(9)).toBe(true);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(registry.getLanesSnapshot()[0]?.state).toBe("loading"); // 红：上一代 readyPending 残留 → playing
  });

  it("次要4/次要12 同步抛错的工厂标记该路 error，且不阻塞后续 play（由 lanes map 保证）", () => {
    let shouldThrow = true;
    const factory: LivePlayerFactory = () => {
      if (shouldThrow) throw new Error("boom");
      return { setVolume: vi.fn(), destroy: vi.fn() };
    };
    const registry = createAudioPlayerRegistry(factory);

    expect(registry.play(1)).toBe(true);
    expect(registry.getLanesSnapshot()[0]?.state).toBe("error");
    registry.stop(1);

    shouldThrow = false;
    expect(registry.play(2)).toBe(true);
    expect(registry.getLanesSnapshot()).toHaveLength(1);
    registry.stopAll();
  });
});
