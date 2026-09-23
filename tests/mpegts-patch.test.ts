import { afterEach, describe, expect, it, vi } from "vitest";
import mpegts from "mpegts.js";

/**
 * T0 回归用例：pnpm `patchedDependencies` 补丁必须生效。
 * 补丁把 mpegts.js 的入口替换为 `dist/mpegts-byte-offset-seek.js`，
 * 为 `createPlayer` 返回的实例挂上 `seekToByteOffset` / `setBufferLimits`
 * （技术方案 §3.3：未缓冲 seek 与 50MB 缓冲预算的前置能力）。
 */
describe("mpegts.js 补丁（字节偏移 seek / 缓冲上限）", () => {
  it("createPlayer 返回的实例带 seekToByteOffset 与 setBufferLimits", () => {
    const player = mpegts.createPlayer({ type: "flv", isLive: true, url: "http://example.invalid/live.flv" }) as unknown as {
      seekToByteOffset?: unknown;
      setBufferLimits?: unknown;
      destroy(): void;
    };
    expect(typeof player.seekToByteOffset).toBe("function");
    expect(typeof player.setBufferLimits).toBe("function");
    player.destroy();
  });

  it("补丁导出 __sumireApplyByteOffsetSeek 供防死锁逻辑单测", () => {
    const patched = mpegts as unknown as { __sumireApplyByteOffsetSeek?: unknown };
    expect(typeof patched.__sumireApplyByteOffsetSeek).toBe("function");
  });
});

type GuardFn = (player: unknown, fileposition: number, milliseconds: number) => void;

async function loadGuard(): Promise<GuardFn> {
  const g = globalThis as unknown as { self?: unknown; window?: unknown };
  g.self ??= globalThis;
  g.window ??= globalThis;
  const mod = (await import("mpegts.js")).default as unknown as {
    __sumireApplyByteOffsetSeek: GuardFn;
  };
  return mod.__sumireApplyByteOffsetSeek;
}

function makeEmitter(offThrows = false) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    on: (event: string, listener: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off: (event: string, listener: () => void) => {
      if (offThrows) throw new Error("off after destroy");
      listeners.get(event)?.delete(listener);
    },
    emit: (event: string) => {
      for (const listener of [...(listeners.get(event) ?? [])]) listener();
    },
  };
}

function makeEngine(options: { offThrows?: boolean; media?: Record<string, unknown> } = {}) {
  const emitter = makeEmitter(options.offThrows ?? false);
  const controller = {
    _loadSegment: vi.fn(),
    _internalAbort: vi.fn(),
    _remuxer: { seek: vi.fn(), insertDiscontinuity: vi.fn() },
    _pendingResolveSeekPoint: null as number | null,
  };
  const config: Record<string, unknown> = { lazyLoad: true, lazyLoadMaxDuration: 50 };
  const engine = {
    _config: config,
    _transmuxer: { on: emitter.on, off: emitter.off, _controller: controller },
    _mse_controller: { flush: vi.fn() },
    _seeking_handler: { directSeek: vi.fn() },
    _loading_controller: { resumeTransmuxer: vi.fn() },
    _media_element: options.media ?? { currentTime: 0 },
  };
  return { engine, controller, config, emitter };
}

describe("mpegts 补丁健壮性（审核次要9）", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("guard finish 在 transmuxer.off 抛错（destroy 后）时仍恢复 lazyLoad 并释放注册表", async () => {
    const guard = await loadGuard();
    const { engine, config, emitter } = makeEngine({ offThrows: true });

    guard({ _player_engine: engine }, 1234, 60_000);
    expect(config.lazyLoad).toBe(false);
    expect(() => emitter.emit("recommend_seekpoint")).not.toThrow();
    expect(config.lazyLoad).toBe(true); // 已恢复

    // 注册表必须释放：下一次 seek 能重新建立 guard（泄漏则复用 finished 的旧 guard → 红）
    guard({ _player_engine: engine }, 4321, 90_000);
    expect(config.lazyLoad).toBe(false);
  });

  it("落位对齐只修正小幅 PTS 偏移，不把 currentTime 夹回旧区间起点", async () => {
    vi.useFakeTimers();
    const guard = await loadGuard();

    // 旧区间 [60,100] 仍在，新落点 50：clamp 不得把 currentTime 夹到 60
    const mediaA = { currentTime: 50, buffered: { length: 1, start: () => 60, end: () => 100 } };
    const a = makeEngine({ media: mediaA });
    guard({ _player_engine: a.engine }, 5_000, 50_000);
    vi.advanceTimersByTime(300);
    expect(mediaA.currentTime).toBe(50);

    // 真实 PTS/CTS 偏移（59.5 → 区间起点 60）：应被修正
    const mediaB = { currentTime: 59.5, buffered: { length: 1, start: () => 60, end: () => 100 } };
    const b = makeEngine({ media: mediaB });
    guard({ _player_engine: b.engine }, 6_000, 60_000);
    vi.advanceTimersByTime(300);
    expect(mediaB.currentTime).toBe(60);
  });
});
