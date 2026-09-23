import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KEYFRAME_SCAN_SECONDS,
  SEEK_TIMEOUT_MESSAGE,
  MAX_KEYFRAME_SCAN_BYTES,
  MAX_WINDOW_READ_BYTES,
  SEEK_WATCHDOG_MS,
  SEEK_WINDOW_BYTES,
  SeekWatchdog,
  computeScanBytes,
  estimateByteOffset,
  findNextTagBoundary,
  findVideoKeyframeBoundary,
  isTimeBuffered,
  performSeek,
  seekUnbuffered,
} from "@/features/recordings/replay/seek";
import {
  computeBufferConfig,
  destroyReplay,
  isPlaybackSupported,
  setMpegtsLoader,
  startReplay,
  type MpegtsLike,
} from "@/features/recordings/replay/flv-player";

/** 构造合法 FLV tag：header(11) + data(dataSize) + PrevTagSize(4)。 */
function buildTag(type: 8 | 9 | 18, dataSize: number, timestampMs: number, dataFill = 0): Uint8Array {
  const tag = new Uint8Array(11 + dataSize + 4);
  tag[0] = type;
  tag[1] = (dataSize >> 16) & 0xff;
  tag[2] = (dataSize >> 8) & 0xff;
  tag[3] = dataSize & 0xff;
  const low24 = timestampMs & 0xffffff;
  tag[4] = (low24 >> 16) & 0xff;
  tag[5] = (low24 >> 8) & 0xff;
  tag[6] = low24 & 0xff;
  tag[7] = (timestampMs >>> 24) & 0xff;
  for (let i = 0; i < dataSize; i++) tag[11 + i] = dataFill;
  const prev = 11 + dataSize;
  tag[11 + dataSize] = (prev >>> 24) & 0xff;
  tag[12 + dataSize] = (prev >>> 16) & 0xff;
  tag[13 + dataSize] = (prev >>> 8) & 0xff;
  tag[14 + dataSize] = prev & 0xff;
  return tag;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function windowResponse(bytes: Uint8Array, status = 206, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function makeVideo(options: { currentTime?: number; ranges?: Array<[number, number]> } = {}) {
  const ranges = options.ranges ?? [];
  return {
    currentTime: options.currentTime ?? 0,
    buffered: {
      length: ranges.length,
      start: (index: number) => ranges[index][0],
      end: (index: number) => ranges[index][1],
    } as unknown as TimeRanges,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("seek：码率折算与 FLV tag 扫描（T11 / AC-6）", () => {
  it("estimateByteOffset 按 size/duration 线性折算并钳制", () => {
    expect(estimateByteOffset(0, 100_000, 1_000_000)).toBe(0);
    expect(estimateByteOffset(50_000, 100_000, 1_000_000)).toBe(500_000);
    expect(estimateByteOffset(100_000, 100_000, 1_000_000)).toBe(999_999);
    expect(estimateByteOffset(1_000, 0, 1_000_000)).toBe(0);
    expect(estimateByteOffset(Number.NaN, 100_000, 1_000_000)).toBe(0);
  });

  it("computeScanBytes 按码率覆盖 10s 并钳制上下限", () => {
    expect(computeScanBytes(0)).toBe(SEEK_WINDOW_BYTES);
    expect(computeScanBytes(1_000)).toBe(SEEK_WINDOW_BYTES);
    expect(computeScanBytes(4_000_000)).toBe(Math.floor((4_000_000 / 8) * KEYFRAME_SCAN_SECONDS));
    expect(computeScanBytes(8_000_000)).toBe(MAX_KEYFRAME_SCAN_BYTES);
  });

  it("扫描跳过噪声与 PrevTagSize 不合法的假 tag，命中视频关键帧边界", () => {
    const fake = new Uint8Array([9, 0, 0, 200, 0, 0, 0, 0, 0, 0, 0]); // PrevTagSize 校验失败
    const window = concat(
      new Uint8Array([1, 2, 3]),
      fake,
      buildTag(8, 20, 10_000),
      buildTag(9, 20, 10_040, 0x20), // frameType=2（非关键帧）
      buildTag(9, 20, 10_080, 0x10), // frameType=1（关键帧）
    );

    const keyframe = findVideoKeyframeBoundary(window, 1_000_000);
    expect(keyframe).toEqual({
      fileposition: 1_000_000 + 3 + fake.length + 35 + 35,
      milliseconds: 10_080,
    });
    // 任意合法 tag 边界：应跳过假 tag、命中音频 tag
    expect(findNextTagBoundary(window, 0)).toEqual({ fileposition: 3 + fake.length, milliseconds: 10_000 });
    // 纯噪声窗口无边界
    const noise = new Uint8Array(512);
    noise.fill(0x01);
    expect(findVideoKeyframeBoundary(noise, 0)).toBeNull();
    expect(findNextTagBoundary(noise, 0)).toBeNull();
  });

  it("未缓冲 seek：按码率折算偏移发出正确 Range 头并对齐关键帧", async () => {
    const window = concat(new Uint8Array([0, 0, 0]), buildTag(9, 30, 60_000, 0x10));
    const fetchMock = vi.fn().mockResolvedValue(windowResponse(window));
    vi.stubGlobal("fetch", fetchMock);
    const seekToByteOffset = vi.fn();

    const outcome = await seekUnbuffered({
      url: "https://rec.example.com/a.flv",
      targetSeconds: 60,
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset,
    });

    expect(outcome.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, { headers: { Range: string } }];
    expect(init.headers.Range).toBe(`bytes=500000-${500000 + SEEK_WINDOW_BYTES - 1}`);
    expect(seekToByteOffset).toHaveBeenCalledWith(500_003, 60_000);
  });

  it("非 206 响应放弃未缓冲 seek（不整文件 buffer、不触达播放器）", async () => {
    const cancel = vi.fn(async () => {});
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: { cancel },
        arrayBuffer,
      }),
    );
    const seekToByteOffset = vi.fn();
    const outcome = await seekUnbuffered({
      url: "https://rec.example.com/a.flv",
      targetSeconds: 10,
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("range-unsupported");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(seekToByteOffset).not.toHaveBeenCalled();
  });

  it("窗口读取超出上限时取消读取（绝不无限读入）", async () => {
    const cancel = vi.fn(async () => {});
    const huge = new Uint8Array(MAX_WINDOW_READ_BYTES + 1);
    let step = 0;
    const reader = {
      read: vi.fn(async () => {
        step += 1;
        return step === 1 ? { done: false, value: huge } : { done: true, value: undefined };
      }),
      cancel,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 206,
        headers: { get: () => null },
        body: { getReader: () => reader },
      }),
    );
    const seekToByteOffset = vi.fn();
    const outcome = await seekUnbuffered({
      url: "https://rec.example.com/a.flv",
      targetSeconds: 10,
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset,
    });
    // 窗口内无可信边界 → 降级按估算偏移直试；补丁接受即视为发起成功（由看门狗兜底未恢复）
    expect(outcome.ok).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(seekToByteOffset).toHaveBeenCalledWith(83_333, 10_000);
  });

  it("次要5 降级直试被补丁拒绝时返回 patch-missing（而非固定失败）", async () => {
    const noise = new Uint8Array(4096);
    noise.fill(0x02);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(windowResponse(noise)),
    );
    const outcome = await seekUnbuffered({
      url: "https://rec.example.com/a.flv",
      targetSeconds: 30,
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset: () => false,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("patch-missing");
  });
});

describe("performSeek：缓冲内直跳 / 未缓冲编排 / 看门狗（T11、T13）", () => {
  it("目标时间在已缓冲区间 → 直接设 currentTime，不发 Range 请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const video = makeVideo({ currentTime: 5, ranges: [[0, 60]] });
    const seekToByteOffset = vi.fn();

    const ok = await performSeek({
      video,
      url: "https://rec.example.com/a.flv",
      targetSeconds: 30,
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset,
      onFailed: () => {},
    });

    expect(ok).toBe(true);
    expect(video.currentTime).toBe(30);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(seekToByteOffset).not.toHaveBeenCalled();
  });

  it("未缓冲 → 走字节偏移 seek 并进入 seek 中态", async () => {
    const window = concat(new Uint8Array([0, 0, 0]), buildTag(9, 30, 90_000, 0x10));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(windowResponse(window)));
    const seekToByteOffset = vi.fn();
    const onSeeking = vi.fn();
    const onFailed = vi.fn();
    const video = makeVideo({ currentTime: 5, ranges: [[0, 60]] });

    const ok = await performSeek({
      video,
      url: "https://rec.example.com/a.flv",
      targetSeconds: 90,
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset,
      onSeeking,
      onFailed,
    });

    expect(ok).toBe(true);
    expect(onSeeking).toHaveBeenCalled();
    expect(seekToByteOffset).toHaveBeenCalledWith(750_003, 90_000);
    expect(onFailed).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(5); // 未缓冲路径不写 currentTime（避免 50ms 校正死循环）
  });

  it("未缓冲 seek 失败（非 206）→ 错误回调上报", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => null }, body: { cancel: async () => {} } }),
    );
    const onFailed = vi.fn();
    const ok = await performSeek({
      video: makeVideo({ currentTime: 5, ranges: [[0, 60]] }),
      url: "https://rec.example.com/a.flv",
      targetSeconds: 90,
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset: vi.fn(),
      onFailed,
    });
    expect(ok).toBe(false);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed.mock.calls[0][0]).toContain("seek");
  });

  it("seek 后 15s 未恢复播放 → 看门狗超时显性报错", async () => {
    vi.useFakeTimers();
    const window = concat(new Uint8Array([0, 0, 0]), buildTag(9, 30, 60_000, 0x10));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(windowResponse(window)));
    const onFailed = vi.fn();

    const watchdog = new SeekWatchdog(() => onFailed(SEEK_TIMEOUT_MESSAGE));
    const ok = await performSeek({
      video: makeVideo({ currentTime: 5, ranges: [[0, 60]] }),
      url: "https://rec.example.com/a.flv",
      targetSeconds: 90,
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset: vi.fn(),
      onFailed,
      watchdog,
    });

    expect(ok).toBe(true);
    expect(onFailed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SEEK_WATCHDOG_MS - 1);
    expect(onFailed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed.mock.calls[0][0]).toContain("超时");

    // 续播发生后 disarm，不再误报
    watchdog.disarm();
    vi.advanceTimersByTime(SEEK_WATCHDOG_MS * 2);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("未注入自定义 watchdog 时，performSeek 默认看门狗使用生产中性超时文案（审核 R8-c）", async () => {
    vi.useFakeTimers();
    const window = concat(new Uint8Array([0, 0, 0]), buildTag(9, 30, 60_000, 0x10));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(windowResponse(window)));
    const onFailed = vi.fn();

    // 不传 watchdog → 走 seek.ts 生产默认看门狗
    const ok = await performSeek({
      video: makeVideo({ currentTime: 5, ranges: [[0, 60]] }),
      url: "https://rec.example.com/a.flv",
      targetSeconds: 90,
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset: vi.fn(),
      onFailed,
    });
    expect(ok).toBe(true);

    vi.advanceTimersByTime(SEEK_WATCHDOG_MS);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed.mock.calls[0][0]).toBe(SEEK_TIMEOUT_MESSAGE);
    expect(onFailed.mock.calls[0][0]).not.toContain("未恢复播放"); // 旧文案不得回归
  });

  it("次要5 失败文案区分原因：网络失败 ≠ 未支持 Range", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    const networkFailed = vi.fn();
    const networkOk = await performSeek({
      video: makeVideo({ currentTime: 5, ranges: [[0, 60]] }),
      url: "https://rec.example.com/a.flv",
      targetSeconds: 90,
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset: vi.fn(),
      onFailed: networkFailed,
    });
    expect(networkOk).toBe(false);
    expect(networkFailed).toHaveBeenCalledTimes(1);
    expect(networkFailed.mock.calls[0][0]).toContain("网络");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: { cancel: async () => {} },
      }),
    );
    const rangeFailed = vi.fn();
    const rangeOk = await performSeek({
      video: makeVideo({ currentTime: 5, ranges: [[0, 60]] }),
      url: "https://rec.example.com/a.flv",
      targetSeconds: 90,
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset: vi.fn(),
      onFailed: rangeFailed,
    });
    expect(rangeOk).toBe(false);
    expect(rangeFailed.mock.calls[0][0]).toContain("Range");
    expect(rangeFailed.mock.calls[0][0]).not.toContain("网络");
  });

  it("次要5 过期 seek（被后发起的 seek 取代）静默丢弃，不上报失败", async () => {
    const makeWindow = (timestamp: number) =>
      concat(new Uint8Array([0, 0, 0]), buildTag(9, 30, timestamp, 0x10));
    // 挂起的首个 Range 响应：由对象持有以便在断言前释放（闭包内赋值，避免 TS 收窄成 never）
    const holder: { release: (() => void) | null } = { release: null };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            holder.release = () => resolve(windowResponse(makeWindow(1_000)));
          }),
      )
      .mockImplementationOnce(() => Promise.resolve(windowResponse(makeWindow(90_000))));
    vi.stubGlobal("fetch", fetchMock);

    const staleFailed = vi.fn();
    const freshFailed = vi.fn();
    const first = performSeek({
      video: makeVideo({ currentTime: 5, ranges: [[0, 60]] }),
      url: "https://rec.example.com/a.flv",
      targetSeconds: 90, // 未缓冲 → 走 Range 探测（挂起）
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset: vi.fn(),
      onFailed: staleFailed,
    });
    const second = performSeek({
      video: makeVideo({ currentTime: 5, ranges: [[0, 60]] }),
      url: "https://rec.example.com/a.flv",
      targetSeconds: 110, // 未缓冲 → 后发起者取代前者
      durationSeconds: 120,
      fileSize: 1_000_000,
      seekToByteOffset: vi.fn(),
      onFailed: freshFailed,
    });

    const secondOk = await second;
    expect(secondOk).toBe(true);
    holder.release?.();
    const firstOk = await first;

    expect(firstOk).toBe(false);
    expect(staleFailed).not.toHaveBeenCalled();
    expect(freshFailed).not.toHaveBeenCalled();
  });

  it("isTimeBuffered 判定缓冲区间（含边界）", () => {
    const video = makeVideo({ ranges: [[0, 30], [60, 90]] });
    expect(isTimeBuffered(video, 0)).toBe(true);
    expect(isTimeBuffered(video, 29.9)).toBe(true);
    expect(isTimeBuffered(video, 30)).toBe(false);
    expect(isTimeBuffered(video, 60)).toBe(true);
    expect(isTimeBuffered(video, 95)).toBe(false);
    expect(isTimeBuffered({ buffered: null } as { buffered: null }, 1)).toBe(false);
  });
});

describe("flv-player：MSE 支持探测与缓冲预算（T11 / AC-5）", () => {
  it("MSE 不支持（isSupported false）→ 播放器不初始化并暴露降级状态", async () => {
    const createPlayer = vi.fn();
    const restore = setMpegtsLoader(() =>
      Promise.resolve({
        isSupported: () => false,
        createPlayer,
        Events: { MEDIA_INFO: "media_info", ERROR: "error" },
      } as unknown as MpegtsLike),
    );

    expect(await isPlaybackSupported()).toBe(false);
    const started = await startReplay({
      url: "https://rec.example.com/a.flv",
      media: document.createElement("video"),
      fileSize: 1_000_000,
      onError: () => {},
    });
    expect(started).toBe(false);
    expect(createPlayer).not.toHaveBeenCalled();
    restore();
  });

  it("MSE 支持时创建播放器并回传 handle（卸载可销毁）", async () => {
    const player = {
      attachMediaElement: vi.fn(),
      load: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      seekToByteOffset: vi.fn(),
      setBufferLimits: vi.fn(),
    };
    const restore = setMpegtsLoader(() =>
      Promise.resolve({
        isSupported: () => true,
        createPlayer: vi.fn(() => player),
        Events: { MEDIA_INFO: "media_info", ERROR: "error" },
      } as unknown as MpegtsLike),
    );

    const media = document.createElement("video");
    const started = await startReplay({
      url: "https://rec.example.com/a.flv",
      media,
      fileSize: 1_000_000,
      onError: () => {},
    });
    expect(started).toBe(true);
    expect(player.attachMediaElement).toHaveBeenCalledWith(media);
    expect(player.load).toHaveBeenCalled();
    expect(await isPlaybackSupported()).toBe(true);
    restore();
  });

  it("computeBufferConfig 把前瞻/回退折算进 50MB 字节预算（60/40）", () => {
    const config = computeBufferConfig(50_000_000, 100); // 4Mbps
    const bitrate = (50_000_000 * 8) / 100;
    const forwardBytes = (config.lazyLoadMaxDuration * bitrate) / 8;
    const backwardBytes = (config.autoCleanupMaxBackwardDuration * bitrate) / 8;
    expect(forwardBytes).toBeLessThanOrEqual(50 * 1024 * 1024 * 0.6 + 1);
    expect(backwardBytes).toBeLessThanOrEqual(50 * 1024 * 1024 * 0.4 + 1);
    expect(config.lazyLoadMaxDuration).toBeGreaterThan(0);
    expect(config.autoCleanupMaxBackwardDuration).toBeGreaterThan(0);
    // 时长未知时按保守高码率兜底，不为 0
    const fallback = computeBufferConfig(50_000_000, 0);
    expect(fallback.lazyLoadMaxDuration).toBeGreaterThan(0);
  });

  it("次要8 computeBufferConfig 启用 autoCleanupSourceBuffer（否则回退 40% 清理是死配置）", () => {
    expect(computeBufferConfig(50_000_000, 100).autoCleanupSourceBuffer).toBe(true);
    expect(computeBufferConfig(0, 0).autoCleanupSourceBuffer).toBe(true);
  });

  it("次要8 startReplay 并发：后发起者胜出，过期那次不再创建播放器", async () => {
    interface Deferred {
      promise: Promise<MpegtsLike>;
      resolve: (value: MpegtsLike) => void;
    }
    const makeDeferred = (): Deferred => {
      let resolve!: (value: MpegtsLike) => void;
      const promise = new Promise<MpegtsLike>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };
    const first = makeDeferred();
    const second = makeDeferred();
    let loadCall = 0;
    const restoreLoader = setMpegtsLoader(() => (loadCall++ === 0 ? first.promise : second.promise));

    const player = {
      attachMediaElement: vi.fn(),
      load: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      seekToByteOffset: vi.fn(),
      setBufferLimits: vi.fn(),
    };
    const createPlayer = vi.fn(() => player);
    const makeMpegts = (): MpegtsLike =>
      ({
        isSupported: () => true,
        createPlayer,
        Events: { MEDIA_INFO: "media_info", ERROR: "error" },
      }) as unknown as MpegtsLike;

    const media = document.createElement("video");
    const pendingA = startReplay({
      url: "https://rec.example.com/a.flv",
      media,
      fileSize: 1_000_000,
      onError: () => {},
    });
    const pendingB = startReplay({
      url: "https://rec.example.com/b.flv",
      media,
      fileSize: 1_000_000,
      onError: () => {},
    });

    second.resolve(makeMpegts());
    expect(await pendingB).toBe(true);
    first.resolve(makeMpegts());
    expect(await pendingA).toBe(false); // 过期创建被丢弃

    expect(createPlayer).toHaveBeenCalledTimes(1);
    restoreLoader();
    destroyReplay();
  });
});
