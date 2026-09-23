import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { LiveEvent } from "@/features/recordings/types";
import {
  DanmakuOverlay,
  SEEK_JUMP_THRESHOLD_SECONDS,
  SEEK_REBUILD_SECONDS,
  assignLane,
  createDanmakuRenderer,
  danmakuOffsets,
  isSeekJump,
  laneHeightForWidth,
  selectDanmakusToEmit,
  type DanmakuScheduler,
} from "@/features/recordings/replay/danmaku-overlay";

const START_MS = Date.parse("2026-09-23T20:00:00.000Z");

function makeEvent(id: string, offsetSeconds: number, content = id): LiveEvent {
  return {
    eventId: id,
    type: "danmaku",
    occurredAt: new Date(START_MS + offsetSeconds * 1000).toISOString(),
    sender: { uid: 1, name: "观众", face: "", medal: null, guardLevel: null },
    content,
  };
}

function manualScheduler() {
  const frames: Array<(timestamp: number) => void> = [];
  let nextHandle = 1;
  const scheduler: DanmakuScheduler = {
    request(callback) {
      frames.push(callback);
      return nextHandle++;
    },
    cancel() {
      frames.length = 0;
    },
  };
  return {
    scheduler,
    /** 推进一帧并返回本帧绘制后的 fillText 文本列表 */
    runFrame(timestamp = 16): string[] {
      const callbacks = frames.splice(0, frames.length);
      for (const callback of callbacks) callback(timestamp);
      return fillTexts();
    },
  };
}

interface CtxStub {
  fillText: ReturnType<typeof vi.fn>;
  strokeText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

let ctx: CtxStub;

function fillTexts(): string[] {
  return (ctx.fillText.mock.calls as string[][]).map((call) => String(call[0]));
}

function renderOverlay(props: Partial<Parameters<typeof DanmakuOverlay>[0]> = {}) {
  return render(
    <DanmakuOverlay
      events={[]}
      recordStartMs={START_MS}
      currentTime={10}
      playing
      enabled
      {...props}
    />,
  );
}

beforeEach(() => {
  ctx = {
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 60 })),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("弹幕浮层 danmaku-overlay（T12 / AC-7）", () => {
  it("播放推进时仅发射 (prev, current] 区间事件（canvas fillText 断言）", () => {
    const { scheduler, runFrame } = manualScheduler();
    const events = [
      makeEvent("before", 9, "之前"),
      makeEvent("inside", 11, "区间内"),
      makeEvent("after", 15, "之后"),
    ];
    const { rerender } = renderOverlay({ events, currentTime: 10, scheduler });
    runFrame();

    rerender(
      <DanmakuOverlay events={events} recordStartMs={START_MS} currentTime={12} playing enabled scheduler={scheduler} />,
    );
    const drawn = runFrame();

    expect(drawn).toContain("区间内");
    expect(drawn).not.toContain("之前"); // 上一区间已发射过的不重发
    expect(drawn).not.toContain("之后"); // 尚未到达的不发射
  });

  it("seek 回退/前跳超过阈值 → 清空轨道并补发最近 4s 事件", () => {
    const { scheduler, runFrame } = manualScheduler();
    const events = [
      makeEvent("old", 11, "旧位置"),
      makeEvent("near", 98, "落点附近"),
      makeEvent("far", 80, "远处"),
    ];
    const { rerender } = renderOverlay({ events, currentTime: 12, scheduler });
    runFrame();

    rerender(
      <DanmakuOverlay events={events} recordStartMs={START_MS} currentTime={100} playing enabled scheduler={scheduler} />,
    );
    ctx.fillText.mockClear();
    const drawn = runFrame();

    expect(drawn).toContain("落点附近"); // (100-4, 100] 内补发
    expect(drawn).not.toContain("旧位置"); // 旧轨道已清空
    expect(drawn).not.toContain("远处"); // 超出补发窗口
    expect(isSeekJump(12, 100)).toBe(true);
    expect(isSeekJump(12, 12 + SEEK_JUMP_THRESHOLD_SECONDS)).toBe(false);
    expect(SEEK_REBUILD_SECONDS).toBe(4);
  });

  it("弹幕开关关闭时不发射（重新开启后按新区间恢复）", () => {
    const { scheduler, runFrame } = manualScheduler();
    const events = [makeEvent("off", 11, "关闭时"), makeEvent("on", 12.5, "恢复时")];
    const { rerender } = renderOverlay({ events, currentTime: 10, scheduler, enabled: false });
    runFrame();

    rerender(
      <DanmakuOverlay events={events} recordStartMs={START_MS} currentTime={12} playing enabled={false} scheduler={scheduler} />,
    );
    expect(runFrame()).toHaveLength(0);

    rerender(
      <DanmakuOverlay events={events} recordStartMs={START_MS} currentTime={13} playing enabled scheduler={scheduler} />,
    );
    const drawn = runFrame();
    expect(drawn).toContain("恢复时"); // 关闭期不发射，重新开启后按 (12→13] 恢复
    expect(drawn).not.toContain("关闭时"); // 关闭期间的区间事件不补发
  });

  it("轨道分配：同轨道弹幕不重叠（纯函数单测）", () => {
    expect(assignLane([], 1920)).toBe(0);
    // 轨道 0 有弹幕仍在画面右侧（含安全间距）→ 分到轨道 1
    expect(
      assignLane([{ lane: 0, x: 1900, width: 60, speed: 240 }], 1920),
    ).toBe(1);
    // 轨道 0 已完全进入画面（右缘离开画面 + 间距）→ 可复用
    expect(
      assignLane([{ lane: 0, x: 100, width: 60, speed: 240 }], 1920),
    ).toBe(0);
    // 所有轨道被占用 → 丢弃（null）
    const laneCount = 4;
    const occupied = Array.from({ length: laneCount }, (_, lane) => ({
      lane,
      x: 1900,
      width: 60,
      speed: 240,
    }));
    expect(assignLane(occupied, 1920, laneCount)).toBeNull();
  });

  it("次要7 isSeekJump 只认 |Δ|>2s 的跳变：小幅回退不算 seek", () => {
    expect(isSeekJump(12, 11.5)).toBe(false); // 当前实现把任意回退当 seek → 红
    expect(isSeekJump(12, 13.5)).toBe(false);
    expect(isSeekJump(12, 100)).toBe(true);
    expect(isSeekJump(100, 90)).toBe(true);
    expect(isSeekJump(12, 14.1)).toBe(true);
  });

  it("次要7 弹幕开关关闭即清屏（在飞弹幕不再显示）", () => {
    const { scheduler, runFrame } = manualScheduler();
    const events = [makeEvent("m1", 11, "在飞弹幕")];
    const { rerender } = renderOverlay({ events, currentTime: 10, scheduler });
    runFrame();

    rerender(
      <DanmakuOverlay events={events} recordStartMs={START_MS} currentTime={11} playing enabled scheduler={scheduler} />,
    );
    expect(runFrame()).toContain("在飞弹幕");

    rerender(
      <DanmakuOverlay
        events={events}
        recordStartMs={START_MS}
        currentTime={12}
        playing
        enabled={false}
        scheduler={scheduler}
      />,
    );
    ctx.fillText.mockClear();
    expect(runFrame()).toHaveLength(0); // 关闭后仍在画 → 红
  });

  function makeTrackedImage() {
    const created: Array<{ complete: boolean; naturalWidth: number; naturalHeight: number; src: string }> = [];
    class FakeImage {
      complete = false;
      naturalWidth = 0;
      naturalHeight = 0;
      crossOrigin: string | null = null;
      referrerPolicy: string | null = null;
      src = "";
      constructor() {
        created.push(this);
      }
    }
    vi.stubGlobal("Image", FakeImage);
    return created;
  }

  it("次要7 表情弹幕高度不超过轨道高（不与相邻轨道重叠）", () => {
    const images = makeTrackedImage();
    const { scheduler, runFrame } = manualScheduler();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 1920, configurable: true });
    Object.defineProperty(canvas, "clientHeight", { value: 1080, configurable: true });

    const renderer = createDanmakuRenderer(canvas, { scheduler });
    renderer.enqueue({ emoteUrl: "http://img.test/square-c7.png", emoteAlt: "耶" });
    runFrame();

    const image = images.at(-1) as unknown as { complete: boolean; naturalWidth: number; naturalHeight: number };
    image.complete = true;
    image.naturalWidth = 100;
    image.naturalHeight = 100;
    runFrame();

    const call = ctx.drawImage.mock.calls.at(-1) as unknown[];
    const height = call[4] as number;
    const laneHeight = laneHeightForWidth(1920);
    expect(height).toBeLessThanOrEqual(laneHeight);
    renderer.destroy();
  });

  it("次要7 表情图片加载后按实际尺寸重测宽度", () => {
    const images = makeTrackedImage();
    const { scheduler, runFrame } = manualScheduler();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 1920, configurable: true });
    Object.defineProperty(canvas, "clientHeight", { value: 1080, configurable: true });

    const renderer = createDanmakuRenderer(canvas, { scheduler });
    renderer.enqueue({ emoteUrl: "http://img.test/wide-c7.png", emoteAlt: "耶" });
    runFrame();

    const image = images.at(-1) as unknown as { complete: boolean; naturalWidth: number; naturalHeight: number };
    image.complete = true;
    image.naturalWidth = 400;
    image.naturalHeight = 100;
    runFrame();

    const call = ctx.drawImage.mock.calls.at(-1) as unknown[];
    const width = call[3] as number;
    // 宽度按 naturalWidth 与 4×字号取小：min(400, 4×32) = 128（未重测时仍为估宽 64 → 红）
    expect(width).toBe(128);
    renderer.destroy();
  });

  it("danmakuOffsets / selectDanmakusToEmit 只取 danmaku 类型并按区间过滤", () => {
    const events: LiveEvent[] = [
      makeEvent("a", 5),
      { ...makeEvent("gift", 6), type: "gift" },
      makeEvent("b", 10),
    ];
    const offsets = danmakuOffsets(events, START_MS);
    expect(offsets.map((item) => item.event.eventId)).toEqual(["a", "b"]);
    const selected = selectDanmakusToEmit(offsets, 4, 9);
    expect(selected.map((item) => item.event.eventId)).toEqual(["a"]);
  });

  it("createDanmakuRenderer 独立创建：enqueue 后按匀速左移并清屏", () => {
    const { scheduler, runFrame } = manualScheduler();
    const canvas = document.createElement("canvas");
    const renderer = createDanmakuRenderer(canvas, { scheduler });
    renderer.enqueue({ text: "你好" });
    const first = runFrame(16);
    expect(first).toContain("你好");
    const xBefore = (ctx.fillText.mock.calls.at(-1) as unknown[])[1] as number;
    renderer.setPaused(true);
    runFrame(1116);
    const xAfter = (ctx.fillText.mock.calls.at(-1) as unknown[])[1] as number;
    expect(xAfter).toBe(xBefore); // 暂停不移动
    renderer.clear();
    renderer.destroy();
    ctx.clearRect.mockClear();
    ctx.fillText.mockClear();
    expect(runFrame(2116)).toHaveLength(0);
  });

  it("R2 canvas 绘制缓冲与容器一致（含 DPR），并支持运行时 setMetrics", () => {
    const { scheduler } = manualScheduler();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(canvas, "clientHeight", { value: 450, configurable: true });
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });

    const renderer = createDanmakuRenderer(canvas, { scheduler });
    expect(canvas.width).toBe(1600); // 当前实现从不写 canvas.width → 恒为默认 300
    expect(canvas.height).toBe(900);
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);

    renderer.setMetrics(1200, 675, 1);
    expect(canvas.width).toBe(1200);
    expect(canvas.height).toBe(675);
    renderer.destroy();
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
  });

  it("R2 组件响应容器尺寸变化（ResizeObserver）更新绘制缓冲", () => {
    const observed: Array<{ target: Element; callback: ResizeObserverCallback }> = [];
    class MockResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {
        observed.push({ target: null as unknown as Element, callback });
      }
      observe(target: Element) {
        observed[0]!.target = target;
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    const { container } = renderOverlay();
    expect(observed).toHaveLength(1);

    const observer = observed[0]!;
    observer.callback(
      [{ contentRect: { width: 640, height: 360, x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 360 } }] as unknown as ResizeObserverEntry[],
      observer as unknown as ResizeObserver,
    );
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
  });
});
