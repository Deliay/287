import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Page from "@/app/recordings/replay/page";
import {
  ReplayStage,
  type ReplayStageDeps,
} from "@/features/recordings/replay/replay-stage";
import type { LiveEvent, RecordingFile } from "@/features/recordings/types";
import {
  isPlaybackSupported as realIsPlaybackSupported,
  setMpegtsLoader,
  startReplay as realStartReplay,
  destroyReplay as realDestroyReplay,
  type MpegtsLike,
} from "@/features/recordings/replay/flv-player";
import type { PerformSeekArgs } from "@/features/recordings/replay/seek";
import { performSeek as realPerformSeek } from "@/features/recordings/replay/seek";
import { audioRegistry } from "@/features/recordings/live-audio/audio-player-registry";
import styles from "@/features/recordings/replay/replay-stage.module.css";
import feedStyles from "@/features/recordings/replay/event-feed.module.css";
import { GLYPH_RE, renderWithTheme } from "./utils";

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

const bounds = { startMs: START_MS, endMs: START_MS + 3 * 3600 * 1000 };

function makeEvent(id: string, offsetSeconds: number, content = id): LiveEvent {
  return {
    eventId: id,
    type: "danmaku",
    occurredAt: new Date(START_MS + offsetSeconds * 1000).toISOString(),
    sender: { uid: 1, name: "观众甲", face: "", medal: null, guardLevel: null },
    content,
  };
}

function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

/** T4：Fullscreen API mock 的还原钩子（afterEach 统一调用）。 */
let restoreFullscreen: (() => void) | null = null;

interface FullscreenApiMock {
  requestFullscreen: ReturnType<typeof vi.fn>;
  exitFullscreen: ReturnType<typeof vi.fn>;
  /** 模拟浏览器原生退出（Esc）路径。 */
  escapeNatively(): void;
}

/**
 * mock Fullscreen API（jsdom 无实现）：注入 `Element.prototype.requestFullscreen`、
 * `document.exitFullscreen` 与 `document.fullscreenElement`，并在 afterEach 还原。
 * T4（切换/状态回正）与 T7（与网页全屏互斥）共用。
 */
function stubFullscreenApi(): FullscreenApiMock {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  const doc = document as unknown as Record<string, unknown>;
  const originalRequest = proto.requestFullscreen;
  const originalExit = doc.exitFullscreen;
  const originalDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
  let element: Element | null = null;

  const dispatch = () => document.dispatchEvent(new Event("fullscreenchange"));
  // 受测组件只会对回放舞台容器（video-column）发起全屏，按该事实源记录全屏元素，
  // 避免 `function(this)` 别名（@typescript-eslint/no-this-alias）
  const requestFullscreen = vi.fn(() => {
    element = document.querySelector('[data-testid="video-column"]');
    dispatch();
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(() => {
    element = null;
    dispatch();
    return Promise.resolve();
  });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => element });
  proto.requestFullscreen = requestFullscreen;
  doc.exitFullscreen = exitFullscreen;

  restoreFullscreen = () => {
    if (originalRequest === undefined) delete proto.requestFullscreen;
    else proto.requestFullscreen = originalRequest;
    if (originalExit === undefined) delete doc.exitFullscreen;
    else doc.exitFullscreen = originalExit;
    if (originalDescriptor) Object.defineProperty(document, "fullscreenElement", originalDescriptor);
    else delete doc.fullscreenElement;
    restoreFullscreen = null;
  };

  return {
    requestFullscreen,
    exitFullscreen,
    escapeNatively() {
      element = null;
      dispatch();
    },
  };
}

beforeEach(() => {
  paramsHolder.current = "";
});

afterEach(() => {
  restoreLoader?.();
  restoreLoader = null;
  restoreFullscreen?.();
  restoreFullscreen = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** 冲刷微任务（避免依赖 waitFor 的时钟推进） */
describe("FR-3 进度条 hover 时间预览（T6 / AC-3 · 设计 §2.2）", () => {
  /** jsdom 无布局：为元素注入几何尺寸，供「位置 → 时间」换算。 */
  function stubRect(element: HTMLElement, rect: Partial<DOMRect>) {
    const base: DOMRect = {
      x: 0,
      y: 0,
      width: 400,
      height: 20,
      top: 0,
      right: 400,
      bottom: 20,
      left: 0,
      toJSON: () => ({}),
    };
    element.getBoundingClientRect = () => ({ ...base, ...rect } as DOMRect);
  }

  async function renderWithDuration(durationSeconds = 10_800) {
    const performSeek = vi.fn(() => Promise.resolve(true));
    const deps = makeDeps({ performSeek });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();
    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: durationSeconds, configurable: true });
    fireEvent.timeUpdate(video);
    await flush();

    const progress = screen.getByRole("slider", { name: "播放进度" });
    const wrap = progress.parentElement as HTMLElement;
    stubRect(wrap, { left: 0, width: 400 });
    return { performSeek, progress, wrap };
  }

  it("鼠标 pointermove 显示跟随指针的时间预览，数值随位置实时更新", async () => {
    const { wrap } = await renderWithDuration();

    expect(screen.queryByTestId("progress-preview")).not.toBeInTheDocument();
    fireEvent.pointerMove(wrap, { pointerType: "mouse", clientX: 200 }); // 半程
    const preview = screen.getByTestId("progress-preview");
    expect(preview).toHaveTextContent("1:30:00"); // formatOffset(10800 / 2)
    expect(preview.closest("button, input, [role=slider]")).toBeNull(); // 悬浮预览，非控件本体

    fireEvent.pointerMove(wrap, { pointerType: "mouse", clientX: 100 }); // 1/4 处 → 实时更新
    expect(screen.getByTestId("progress-preview")).toHaveTextContent("45:00");
  });

  it("pointerleave 立即隐藏；touch 指针不显示预览（不影响现有拖动预览）", async () => {
    const { progress, wrap } = await renderWithDuration();

    fireEvent.pointerMove(wrap, { pointerType: "touch", clientX: 100 });
    expect(screen.queryByTestId("progress-preview")).not.toBeInTheDocument();

    fireEvent.pointerMove(wrap, { pointerType: "mouse", clientX: 100 });
    expect(screen.getByTestId("progress-preview")).toBeInTheDocument();
    fireEvent.pointerLeave(wrap);
    expect(screen.queryByTestId("progress-preview")).not.toBeInTheDocument();

    // touch 拖动预览（draft）不受影响：仍由 range 值展示
    fireEvent.change(progress, { target: { value: "60" } });
    expect((progress as HTMLInputElement).value).toBe("60");
  });

  it("预览气泡位置夹取：两端按边缘锚定（--preview-ratio 驱动 CSS clamp），中部随指针居中", async () => {
    const { wrap } = await renderWithDuration();

    fireEvent.pointerMove(wrap, { pointerType: "mouse", clientX: 0 });
    expect(screen.getByTestId("progress-preview").style.getPropertyValue("--preview-ratio")).toBe("0");

    fireEvent.pointerMove(wrap, { pointerType: "mouse", clientX: 400 });
    expect(screen.getByTestId("progress-preview").style.getPropertyValue("--preview-ratio")).toBe("1");

    fireEvent.pointerMove(wrap, { pointerType: "mouse", clientX: 200 });
    expect(screen.getByTestId("progress-preview").style.getPropertyValue("--preview-ratio")).toBe("0.5");

    // 位置夹取落在 CSS：气泡左右半宽被 clamp 在容器内，不被 .videoArea 的 overflow:hidden 裁切
    const css = readFileSync(
      path.join(process.cwd(), "src/features/recordings/replay/replay-stage.module.css"),
      "utf8",
    );
    const previewBody = ruleBody(css, "progressPreview");
    expect(previewBody).toMatch(/left:\s*clamp\(/);
    expect(previewBody).toMatch(/var\(--preview-ratio\)/);
  });

  it("拖动中优先显示 draft 值（与 hover 互斥），松开才提交 seek（P3(a) 不回归）", async () => {
    const { performSeek, progress, wrap } = await renderWithDuration();

    fireEvent.change(progress, { target: { value: "300" } });
    expect(screen.getByTestId("progress-preview")).toHaveTextContent("05:00");

    fireEvent.pointerMove(wrap, { pointerType: "mouse", clientX: 396 }); // hover 接近片尾
    expect(screen.getByTestId("progress-preview")).toHaveTextContent("05:00"); // draft 优先

    expect(performSeek).not.toHaveBeenCalled();
    fireEvent.pointerUp(progress);
    await flush();
    expect(performSeek).toHaveBeenCalledTimes(1);
  });
});

describe("FR-1 控件浮层化（T5 / AC-1 · 设计 §2.1）", () => {
  it("控件渲染在画面容器 videoArea 内部（DOM 父子），不再作为其兄弟占画面下方独立空间", async () => {
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={makeDeps()} />);
    await flush();

    const group = screen.getByRole("group", { name: "播放控件" });
    const videoArea = screen.getByTestId("video-area");
    expect(group.parentElement).toBe(videoArea);
    // 画面容器内还承载视频本体（浮层覆盖的是同一盒模型，非并列布局条）
    expect(videoArea).toContainElement(screen.getByLabelText("录播视频"));
  });

  it("暂停时控件常显：静止 3s 隐藏后暂停立即可见，恢复播放不立即隐藏", async () => {
    vi.useFakeTimers();
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={makeDeps()} />);
    await flush();

    const group = screen.getByRole("group", { name: "播放控件" });
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(group).toHaveAttribute("data-controls", "hidden");

    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    expect(group).toHaveAttribute("data-controls", "visible");

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(group).toHaveAttribute("data-controls", "visible"); // 恢复播放不得沿用暂停前的 idle 态
  });

  it("浮层 CSS：绝对定位覆盖画面底部 + 渐变遮罩 + 进度条独占浮层顶缘一行", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/features/recordings/replay/replay-stage.module.css"),
      "utf8",
    );
    const controlsBody = ruleBody(css, "controls");
    expect(controlsBody).toMatch(/position:\s*absolute/);
    expect(controlsBody).toMatch(/inset-inline:\s*0/);
    expect(controlsBody).toMatch(/bottom:\s*0/);
    // 渐变遮罩保证亮色画面上按钮可辨（FR-1 / 设计 §1）
    expect(controlsBody).toMatch(/linear-gradient\(\s*transparent,\s*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*\.?7\s*\)\s*\)/);
    expect(controlsBody).not.toMatch(/border:\s*1px solid/); // 不再是独立布局条的描边卡片
    // 进度条贴浮层顶缘、独占一行（其余控件折行收纳）
    const progressBody = ruleBody(css, "controls .progressWrap");
    expect(progressBody).toMatch(/flex:\s*1\s+0\s+100%/);
  });

  it("浮层形态下控件功能不回归：播放/进度/音量/倍速/弹幕开关/全屏齐备", async () => {
    const deps = makeDeps();
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument());
    const group = screen.getByRole("group", { name: "播放控件" });
    expect(group).toContainElement(within(group).getByRole("slider", { name: "播放进度" }));
    expect(group).toContainElement(within(group).getByRole("slider", { name: "音量" }));
    expect(group).toContainElement(within(group).getByRole("combobox", { name: "倍速" }));
    expect(group).toContainElement(within(group).getByRole("button", { name: "全屏" }));
    expect(group).toContainElement(within(group).getByRole("button", { name: /弹幕开关/ }));
  });
});

describe("FR-5 网页全屏 theater（T7 / AC-5 · 设计 §2.3）", () => {
  const CSS_PATH = path.join(
    process.cwd(),
    "src/features/recordings/replay/replay-stage.module.css",
  );

  function layoutElement(): HTMLElement {
    return document.querySelector(`.${styles.layout}`) as HTMLElement;
  }

  it("点击「网页全屏」切换 theater 布局 class 与 aria-pressed，再次点击恢复原布局", async () => {
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={makeDeps()} />);
    await flush();

    const button = screen.getByRole("button", { name: "网页全屏" });
    const layout = layoutElement();
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(layout).toHaveAttribute("data-theater", "false");
    expect(layout).not.toHaveClass(styles.theater);

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(layout).toHaveAttribute("data-theater", "true");
    expect(layout).toHaveClass(styles.theater);

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(layout).toHaveAttribute("data-theater", "false");
    expect(layout).not.toHaveClass(styles.theater);
  });

  it("theater 布局 CSS：舞台 fixed 满窗、右列表全高滚动、画面在左容器内居中且保持 16:9（非顶对齐）", () => {
    const css = readFileSync(CSS_PATH, "utf8");

    const theaterBody = ruleBody(css, "theater");
    expect(theaterBody).toMatch(/position:\s*fixed/);
    expect(theaterBody).toMatch(/inset:\s*0/);
    expect(theaterBody).toMatch(/z-index:\s*(1\d\d|2\d\d|3\d\d)/); // 层级高于页头（z-index:100）

    const columnBody = ruleBody(css, "theater .videoColumn");
    expect(columnBody).toMatch(/align-items:\s*center/);
    expect(columnBody).toMatch(/justify-content:\s*center/);

    const areaBody = ruleBody(css, "theater .videoArea");
    expect(areaBody).toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
    expect(areaBody).toMatch(/width:\s*min\(/); // 尽可能大且不溢出剩余空间
    expect(areaBody).toMatch(/margin:\s*auto|align-self:\s*center/); // 居中，非顶对齐

    const timelineBody = ruleBody(css, "theater .timeline");
    expect(timelineBody).toMatch(/max-height:\s*none/); // 右侧事件列表全高滚动
  });

  it("与浏览器全屏互斥：进入全屏暂退 theater 并记住，退出后恢复（theater → 全屏 → Esc）", async () => {
    const api = stubFullscreenApi();
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={makeDeps()} />);
    await flush();

    const layout = layoutElement();
    const theaterButton = screen.getByRole("button", { name: "网页全屏" });
    const group = screen.getByRole("group", { name: "播放控件" });

    fireEvent.click(theaterButton);
    expect(layout).toHaveAttribute("data-theater", "true");

    // 进入浏览器全屏 → theater 暂退（单一事实源 document.fullscreenElement）
    fireEvent.click(within(group).getByRole("button", { name: "全屏" }));
    expect(layout).toHaveAttribute("data-theater", "false");
    expect(theaterButton).toHaveAttribute("aria-pressed", "false");

    // Esc 退出浏览器全屏 → 恢复进入前状态
    act(() => {
      api.escapeNatively();
    });
    await flush();
    expect(layout).toHaveAttribute("data-theater", "true");

    // 未开启 theater 时进出全屏：退出后不得凭空开启
    fireEvent.click(theaterButton);
    expect(layout).toHaveAttribute("data-theater", "false");
    fireEvent.click(within(group).getByRole("button", { name: "全屏" }));
    act(() => {
      api.escapeNatively();
    });
    await flush();
    expect(layout).toHaveAttribute("data-theater", "false");
  });

  it("theater 期间锁定底层页面滚动，退出后恢复（含卸载恢复，避免背景滚动漂移）", async () => {
    const { unmount } = render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={makeDeps()} />);
    await flush();
    const theaterButton = screen.getByRole("button", { name: "网页全屏" });

    expect(document.body.style.overflow).toBe("");
    fireEvent.click(theaterButton);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(theaterButton);
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(theaterButton); // 保持开启直至卸载
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("移动端断点不出现网页全屏入口（按钮 CSS 隐藏，与音量滑杆同口径 · 设计 §2.3）", () => {
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={makeDeps()} />);
    const button = screen.getByRole("button", { name: "网页全屏" });
    expect(button).toHaveClass(styles.theaterButton);

    const css = readFileSync(CSS_PATH, "utf8");
    const mobileRules =
      css.match(/@media[^{]*max-width:\s*47\.99em[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(mobileRules).toMatch(/\.theaterButton\s*\{[^}]*display:\s*none/);
  });
});

describe("FR-4 全屏切换修复（T4 / AC-4 · 设计 §2.3）", () => {
  async function renderStage() {
    const deps = makeDeps();
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();
    const group = screen.getByRole("group", { name: "播放控件" });
    return { group };
  }

  it("全屏按钮为切换：未全屏点击 requestFullscreen，已全屏点击 exitFullscreen", async () => {
    const api = stubFullscreenApi();
    const { group } = await renderStage();

    fireEvent.click(within(group).getByRole("button", { name: "全屏" }));
    expect(api.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(api.exitFullscreen).not.toHaveBeenCalled();

    fireEvent.click(within(group).getByRole("button", { name: "退出全屏" }));
    expect(api.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("状态同步：进入全屏后图标/aria-pressed 切换；Esc 原生退出后恢复「进入全屏」态", async () => {
    const api = stubFullscreenApi();
    const { group } = await renderStage();
    const button = within(group).getByRole("button", { name: "全屏" });
    const iconOf = () =>
      Array.from(button.querySelectorAll("path"))
        .map((path) => path.getAttribute("d"))
        .join("|");
    const expandIcon = iconOf();
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button); // 进入全屏（mock 同步派发 fullscreenchange）
    const exitButton = within(group).getByRole("button", { name: "退出全屏" });
    expect(exitButton).toHaveAttribute("aria-pressed", "true");
    expect(iconOf()).not.toBe(expandIcon); // 图标随状态切换（非同一图形）
    expect(exitButton.querySelector("svg")).not.toBeNull();

    // Esc 等浏览器原生退出路径：状态回正，不残留错误状态
    act(() => {
      api.escapeNatively();
    });
    await flush();
    const restored = within(group).getByRole("button", { name: "全屏" });
    expect(restored).toHaveAttribute("aria-pressed", "false");
    expect(iconOf()).toBe(expandIcon);
  });

  it("R14-5 全屏按钮切换后仍为内联 SVG，无 emoji/Unicode 字形", async () => {
    stubFullscreenApi();
    const { group } = await renderStage();
    fireEvent.click(within(group).getByRole("button", { name: "全屏" }));
    const button = within(group).getByRole("button", { name: "退出全屏" });
    expect(button.querySelector("svg")).not.toBeNull();
    expect(GLYPH_RE.test(button.textContent ?? "")).toBe(false);
  });
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 从 CSS 源码取出某条规则的声明体（结构断言共用，同 live-badge 用例口径） */
function ruleBody(css: string, selector: string): string {
  return css.match(new RegExp(`\\.${selector}\\b[^{}]*\\{([^{}]*)\\}`))?.[1] ?? "";
}

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
    // 进度条含缓冲显示：buffered-bar 为「已缓冲」多段容器，played-bar 才是「已播放」（审核 R9-b）
    expect(screen.getByTestId("buffered-bar")).toBeInTheDocument();
    expect(screen.getByTestId("played-bar")).toBeInTheDocument();
  });

  it("R14-4 返回入口独占一行（标题行上方，PC/移动端一致）；返回箭头 SVG 化（R14-5 同批）", () => {
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={makeDeps()} />);
    const back = screen.getByRole("link", { name: /返回录播列表/ });
    const title = screen.getByRole("heading", { level: 1 });
    const backRow = back.parentElement;
    expect(backRow).not.toBeNull();
    // 返回行容器只含返回入口、不包含标题（红：当前 back 与 headings 同处 pageHeader）
    expect(backRow).not.toContainElement(title);
    expect(backRow?.querySelectorAll("a, h1, p")).toHaveLength(1);
    // 标题行是返回行的兄弟容器（同页头内，且位于其下方）
    expect(backRow?.parentElement).toContainElement(title.parentElement as HTMLElement);
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // R14-5：返回箭头为内联 SVG，文本无 ← 字形
    expect(back.querySelector("svg")).not.toBeNull();
    expect(GLYPH_RE.test(back.textContent ?? "")).toBe(false);
  });

  it("R14-5 播放控件按钮为内联 SVG 且无 emoji/Unicode 字形（播放/暂停、静音、全屏必测，控件栏整体无字形）", async () => {
    const deps = makeDeps();
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument());
    const group = screen.getByRole("group", { name: "播放控件" });
    for (const name of ["播放", "静音", "全屏"]) {
      const button = within(group).getByRole("button", { name });
      expect(button.querySelector("svg")).not.toBeNull();
      expect(GLYPH_RE.test(button.textContent ?? "")).toBe(false);
    }
    // 同批收敛：音量前缀字形（🔊）等也不复存在 → 控件栏整体无字形
    expect(GLYPH_RE.test(group.textContent ?? "")).toBe(false);
  });

  it("R15-5 跨窗未缓冲 seek 期间旧播放 timeupdate 不切窗：目标窗首拉不被自家中止（无双拉）", async () => {
    const fetchEvents = vi.fn((params: { start: string; signal?: AbortSignal }) => {
      void params; // 仅类型需要：请求保持挂起（在途），用例按 start 归窗断言
      return new Promise<{ total: number; items: LiveEvent[] }>(() => {});
    });
    const performSeek = vi.fn(() => new Promise<boolean>(() => {})); // seek 全程在途
    const deps = makeDeps({ fetchEvents, performSeek });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);

    const callsForWindow = (index: number) =>
      fetchEvents.mock.calls.filter(
        (call) => Date.parse(call[0].start) === START_MS + index * 600_000,
      );

    // 挂载已发起窗口拉取（焦点窗 + 相邻窗预取不计其详，按 start 归窗断言）
    await waitFor(() => expect(fetchEvents.mock.calls.length).toBeGreaterThan(0));

    // 跨窗 seek：进度条拖到 1500s（窗口2 = floor(1_500_000/600_000)）并松手 → 目标窗首拉发起
    const progress = screen.getByRole("slider", { name: "播放进度" }) as HTMLInputElement;
    fireEvent.change(progress, { target: { value: "1500" } });
    fireEvent.pointerUp(progress);
    await waitFor(() => expect(callsForWindow(2)).toHaveLength(1));
    const targetParams = callsForWindow(2)[0][0];
    const totalBefore = fetchEvents.mock.calls.length;

    // 扫描期间旧播放 timeupdate 回写旧位置（0s → 窗口0）
    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    fireEvent.timeUpdate(video);
    await flush();

    // 红：当前窗口 effect 按旧位置切回窗口0 → focusWindow(0) 中止目标窗在途首拉（落位后重拉=双拉）
    expect(targetParams.signal?.aborted).toBe(false);
    expect(fetchEvents.mock.calls.length).toBe(totalBefore); // 也不产生重拉
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

  it("页面卸载 → flv-player 销毁，且回放不进入悬浮音频注册表（FR-6 边界）", async () => {
    const deps = makeDeps();
    const { unmount } = render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await waitFor(() => expect(deps.startReplay).toHaveBeenCalledTimes(1));
    const startArgs = (deps.startReplay as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      url: string;
    };
    expect(startArgs.url).toContain("/recordings/");
    // 回放只在页面内起播：不得占用「听直播」多路注册表（FR-6 悬浮组件仅承载听直播）
    expect(audioRegistry.getLanesSnapshot()).toHaveLength(0);

    unmount();
    expect(deps.destroyReplay).toHaveBeenCalledTimes(1);
    expect(deps.destroyReplay).toHaveBeenCalledWith(startArgs.url);
    expect(audioRegistry.getLanesSnapshot()).toHaveLength(0);
    // 注：不在此断言悬浮组件 DOM——本用例树内本就没有 FloatingAudioPlayer，恒真断言已按 R9-d 删除
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

describe("代码审核返工：P1–P4 与次要项", () => {
  it("P1 seek 成功恢复后看门狗可靠解除：15s 后不误报超时", async () => {
    vi.useFakeTimers();
    const events = [makeEvent("e1", 61, "目标事件")];
    const performSeek = vi.fn(async (args: PerformSeekArgs) => {
      // 模拟真实 performSeek 成功后武装看门狗
      args.watchdog?.arm();
      return true;
    });
    const deps = makeDeps({
      performSeek,
      fetchEvents: () => Promise.resolve({ total: 1, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: /目标事件/ }));
    await flush();
    expect(performSeek).toHaveBeenCalledTimes(1);

    // 续播恢复：currentTime 到达 seek 目标
    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    video.currentTime = 61;
    fireEvent.timeUpdate(video);
    await flush();

    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("P2 进度条显示真实缓冲区间（已缓冲 ≠ 已播放），已播放条用成员色", async () => {
    const deps = makeDeps();
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: 10_800, configurable: true });
    Object.defineProperty(video, "buffered", {
      value: { length: 1, start: () => 0, end: () => 600 },
      configurable: true,
    });
    video.currentTime = 60;
    fireEvent.timeUpdate(video);
    await flush();

    // 已缓冲 600s / 总 10800s ≈ 5.56%（与 played-bar 的已播放比例各自独立断言，不得混用）
    const bufferedBar = screen.getByTestId("buffered-bar");
    const segments = bufferedBar.querySelectorAll('[data-testid="buffered-segment"]');
    expect(segments).toHaveLength(1);
    expect(parseFloat((segments[0] as HTMLElement).style.width)).toBeCloseTo((600 / 10_800) * 100, 1);
    // 已播放 60s / 10800s ≈ 0.56%，且为成员色（file.info.mid → sumire）
    const playedBar = screen.getByTestId("played-bar");
    expect(parseFloat(playedBar.style.width)).toBeCloseTo((60 / 10_800) * 100, 1);
    expect(playedBar.style.backgroundColor).toContain("sumire");
  });

  it("次要10 缓冲条按区间多段渲染（不以最大 end 单段高估）", async () => {
    const deps = makeDeps();
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: 60, configurable: true });
    Object.defineProperty(video, "buffered", {
      value: {
        length: 2,
        start: (index: number) => (index === 0 ? 0 : 20),
        end: (index: number) => (index === 0 ? 10 : 30),
      },
      configurable: true,
    });
    fireEvent.timeUpdate(video);
    await flush();

    const bar = screen.getByTestId("buffered-bar");
    const segments = Array.from(bar.querySelectorAll('[data-testid="buffered-segment"]')) as HTMLElement[];
    expect(segments).toHaveLength(2);
    expect(parseFloat(segments[0].style.width)).toBeCloseTo((10 / 60) * 100, 1);
    expect(parseFloat(segments[0].style.left ?? "0%")).toBeCloseTo(0, 1);
    expect(parseFloat(segments[1].style.width)).toBeCloseTo((10 / 60) * 100, 1);
    expect(parseFloat(segments[1].style.left ?? "0%")).toBeCloseTo((20 / 60) * 100, 1);
    // 不得以 max(end)=30s 单段高估：任何单段宽度都必须小于整段缓冲上限（30/60=50%）
    for (const segment of segments) {
      expect(parseFloat(segment.style.width)).toBeLessThan((30 / 60) * 100);
    }
  });

  it("P3(a) 进度条拖动中仅预览，松开后才触发 seek", async () => {
    const performSeek = vi.fn(() => Promise.resolve(true));
    const deps = makeDeps({ performSeek });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    const progress = screen.getByRole("slider", { name: "播放进度" }) as HTMLInputElement;
    fireEvent.change(progress, { target: { value: "300" } });
    expect(performSeek).not.toHaveBeenCalled();
    expect(progress.value).toBe("300"); // 拖动中展示预览位置

    fireEvent.pointerUp(progress);
    await flush();
    expect(performSeek).toHaveBeenCalledTimes(1);
    const args = (performSeek as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      targetSeconds: number;
    };
    expect(args.targetSeconds).toBe(300);
  });

  it("P3(b) 过期 seek 的失败回调被丢弃：最终 seek 成功后不残留错误浮层", async () => {
    const pending: Array<{ args: PerformSeekArgs; resolve: (ok: boolean) => void }> = [];
    const performSeek = vi.fn(
      (args: PerformSeekArgs) =>
        new Promise<boolean>((resolve) => {
          pending.push({ args, resolve });
        }),
    );
    const events = [makeEvent("e1", 10, "第一条"), makeEvent("e2", 61, "第二条")];
    const deps = makeDeps({
      performSeek,
      fetchEvents: () => Promise.resolve({ total: 2, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /第二条/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /第一条/ }));
    fireEvent.click(screen.getByRole("button", { name: /第二条/ }));
    await flush();
    expect(pending).toHaveLength(2);

    // 过期的第 1 次 seek 迟到失败
    pending[0].args.onFailed("seek 失败：上游未支持 Range 请求");
    pending[0].resolve(false);
    await flush();

    // 最终 seek（第 2 次）成功
    pending[1].resolve(true);
    await flush();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("P3(c) seek 请求途中 timeupdate 不解除 seek 中态（spinner 持续、进度锁定）", async () => {
    const performSeek = vi.fn(() => new Promise<boolean>(() => {}));
    const events = [makeEvent("e1", 61, "第一条")];
    const deps = makeDeps({
      performSeek,
      fetchEvents: () => Promise.resolve({ total: 1, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /第一条/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /第一条/ }));
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();

    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    fireEvent.timeUpdate(video);
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "播放进度" })).toBeDisabled();
  });

  it("P4 事件列表按窗口化渲染：仅渲染当前及相邻窗口的事件", async () => {
    const near = [10, 61, 120].map((offset, index) => makeEvent(`near-${index}`, offset, `近处${index}`));
    const far = Array.from({ length: 30 }, (_, index) =>
      makeEvent(`far-${index}`, 1_500 + index * 10, `远处${index}`),
    );
    const deps = makeDeps({
      fetchEvents: () => Promise.resolve({ total: near.length + far.length, items: [...near, ...far] }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /近处0/ })).toBeInTheDocument());

    const list = screen.getByTestId("event-list");
    // 当前窗口（0–20min）内 3 条；远处 30 条（>2 个窗口）不得渲染
    expect(within(list).getAllByRole("button")).toHaveLength(3);
  });

  it("R1(1) seek 途中旧播放推进不解除中态；落位（容差外）经 seeked 解除看门狗，15s 后不误报", async () => {
    vi.useFakeTimers();
    const events = [makeEvent("e1", 61, "目标事件")];
    // 模拟真实 performSeek：Range 扫描结束后（异步）才 arm 看门狗
    const performSeek = vi.fn(
      (args: PerformSeekArgs) =>
        new Promise<boolean>((resolve) => {
          window.setTimeout(() => {
            args.watchdog?.arm();
            resolve(true);
          }, 100);
        }),
    );
    const deps = makeDeps({
      performSeek,
      fetchEvents: () => Promise.resolve({ total: 1, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    fireEvent.click(screen.getByRole("button", { name: /目标事件/ }));
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();

    // seek 途中旧播放持续推进（未到目标 61s）→ 中态不得解除
    video.currentTime = 0.3;
    fireEvent.timeUpdate(video);
    video.currentTime = 0.6;
    fireEvent.timeUpdate(video);
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200); // 扫描完成 → arm
    });
    await flush();

    // 落位（容差外：补丁按关键帧时间戳落位，与目标差 >1s）→ seeked 事件驱动解除
    video.currentTime = 55;
    fireEvent.seeked(video);
    await flush();
    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R1(2) 落位点与目标差 >1s（关键帧对齐常态）时续播后 15s 不误报", async () => {
    vi.useFakeTimers();
    const events = [makeEvent("e1", 61, "目标事件")];
    const performSeek = vi.fn(
      (args: PerformSeekArgs) =>
        new Promise<boolean>((resolve) => {
          window.setTimeout(() => {
            args.watchdog?.arm();
            resolve(true);
          }, 100);
        }),
    );
    const deps = makeDeps({
      performSeek,
      fetchEvents: () => Promise.resolve({ total: 1, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    fireEvent.click(screen.getByRole("button", { name: /目标事件/ }));
    await flush();

    // 途中推进一次（当前实现会在此误清 latch）
    video.currentTime = 0.4;
    fireEvent.timeUpdate(video);
    act(() => {
      vi.advanceTimersByTime(200); // 扫描完成 → arm
    });
    await flush();

    // 落位在 55s：与目标 61s 差 6s（>1s 容差，关键帧对齐常态）
    video.currentTime = 55;
    fireEvent.timeUpdate(video);
    await flush();

    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("次要7 移动端音量仅静音切换：静音按钮可切换静音/恢复", async () => {
    const deps = makeDeps();
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    const group = screen.getByRole("group", { name: "播放控件" });
    const volume = within(group).getByRole("slider", { name: "音量" }) as HTMLInputElement;
    expect(volume.value).toBe("1");
    fireEvent.click(within(group).getByRole("button", { name: "静音" }));
    expect(volume.value).toBe("0");
    fireEvent.click(within(group).getByRole("button", { name: "取消静音" }));
    expect(volume.value).toBe("1");
  });

  it("次要7 控件栏静止 3s 真正隐藏，移动鼠标/触摸重现", async () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    const column = screen.getByTestId("video-column");
    const group = screen.getByRole("group", { name: "播放控件" });
    expect(group).toHaveAttribute("data-controls", "visible");

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(group).toHaveAttribute("data-controls", "hidden");

    fireEvent.touchStart(column);
    expect(group).toHaveAttribute("data-controls", "visible");
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    fireEvent.mouseMove(column);
    expect(group).toHaveAttribute("data-controls", "visible");
  });
});

describe("第七轮审核返工：R9（startReplay 失败语义区分 + 过期结果丢弃）", () => {
  it("R9-a(1) start 在途被取代：过期 false 不得出现降级 UI，新实例不被销毁", async () => {
    const playerB = {
      attachMediaElement: vi.fn(),
      load: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      seekToByteOffset: vi.fn(),
      setBufferLimits: vi.fn(),
    };
    const createPlayer = vi.fn(() => playerB);
    const healthy: MpegtsLike = {
      isSupported: () => true,
      createPlayer,
      Events: { MEDIA_INFO: "media_info", ERROR: "error" },
    } as unknown as MpegtsLike;

    let loaderCall = 0;
    const first = deferredPromise<MpegtsLike>();
    restoreLoader = setMpegtsLoader(() =>
      loaderCall++ === 0 ? first.promise : Promise.resolve(healthy),
    );

    const deps = makeDeps({
      startReplay: realStartReplay, // 真实实现：被取代的 start 返回 false（代次纪律）
      destroyReplay: realDestroyReplay,
      isPlaybackSupported: () => Promise.resolve(true),
    });
    const file2: RecordingFile = { ...file, name: "游玩饥荒-第二段.flv" };

    const { rerender } = render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush(); // start#1 在途（等待 loader#1）

    // 文件/url 变化 → effect 重跑（cleanup 作废 start#1），start#2 起播成功
    rerender(<ReplayStage roomId={1001} file={file2} bounds={bounds} deps={deps} />);
    await flush();
    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("mse-degrade")).not.toBeInTheDocument();

    // 过期的 start#1 此时才 resolve(false)（token 已过期）
    act(() => {
      first.resolve(healthy);
    });
    await flush();
    await flush();

    expect(screen.queryByTestId("mse-degrade")).not.toBeInTheDocument(); // 红：过期 false 触发假降级
    expect(playerB.destroy).not.toHaveBeenCalled(); // 红：降级重跑 effect 又销毁健康实例

    // 卸载清理真实单例状态
    rerender(<></>);
    await flush();
  });

  it("R9-a(2) mpegts 加载失败：文案 ≠ MSE 降级文案，且提供重试", async () => {
    restoreLoader = setMpegtsLoader(() => Promise.reject(new Error("cdn down")));
    const deps = makeDeps({
      isPlaybackSupported: realIsPlaybackSupported, // 真实实现经由注入的失败 loader
      startReplay: realStartReplay,
      destroyReplay: realDestroyReplay,
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();
    await flush();

    // 网络加载失败 ≠ 浏览器不支持：不得渲染 §2.5 的 MSE 降级文案（审核 次要5 同构）
    expect(screen.queryByTestId("mse-degrade")).not.toBeInTheDocument(); // 红：当前被折算成假降级
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("加载失败");
    expect(alert).not.toHaveTextContent("当前浏览器无法播放");
    expect(within(alert).getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});

describe("R8 收尾：事件列表信息流（T8 改写 · FR-6 / AC-6 · 原 entryLabel 拍平文本用例退役）", () => {
  it("事件列表按信息流渲染 SC / 礼物 / 舰长卡片，保留时间戳与 seek", async () => {
    const events: LiveEvent[] = [
      {
        eventId: "sc-1",
        type: "super_chat",
        occurredAt: new Date(START_MS + 10_000).toISOString(),
        sender: { uid: 1, name: "打赏者", face: "", medal: null, guardLevel: null },
        content: "加油",
        price: 50,
        scColors: { backgroundStart: "#7a5b12", backgroundEnd: "#463309", fontColor: "#ffe6a6" },
      },
      {
        eventId: "gift-1",
        type: "gift",
        occurredAt: new Date(START_MS + 20_000).toISOString(),
        sender: { uid: 2, name: "送礼者", face: "", medal: null, guardLevel: null },
        price: 0.1,
        gift: { name: "人气票", count: 1, iconUrl: "https://example.invalid/gift.png" },
      },
      {
        eventId: "guard-1",
        type: "guard_buy",
        occurredAt: new Date(START_MS + 30_000).toISOString(),
        sender: { uid: 3, name: "上舰者", face: "", medal: null, guardLevel: 3 },
        price: 198,
        guard: { level: 3, name: "舰长", count: 1 },
      },
    ];
    const deps = makeDeps({ fetchEvents: () => Promise.resolve({ total: 3, items: events }) });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /打赏者/ })).toBeInTheDocument());
    const list = screen.getByTestId("event-list");

    const sc = within(list).getByRole("button", { name: /打赏者/ });
    expect(sc.textContent).toContain("00:10"); // 时间戳保留
    expect(sc.textContent).toContain("加油");
    expect(sc.textContent).toContain("¥50.00");
    const scCard = sc.querySelector(`.${feedStyles.scCard}`) as HTMLElement;
    expect(scCard).not.toBeNull();
    // scColors 内联渐变（jsdom 将 #RRGGBB 规范化为 rgb()）
    expect(scCard.style.backgroundImage).toMatch(/#7a5b12|rgb\(\s*122,\s*91,\s*18\s*\)/i);

    const gift = within(list).getByRole("button", { name: /送礼者/ });
    expect(gift.textContent).toContain("人气票 ×1");
    expect(gift.textContent).toContain("¥0.10");

    const guard = within(list).getByRole("button", { name: /上舰者/ });
    expect(guard.textContent).toContain("开通了 舰长 ×1");
    expect(guard.textContent).toContain("¥198.00");

    // 拍平前缀（entryLabel）不再出现——信息流替代纯文本
    expect(list.textContent).not.toContain("SC 打赏者：加油");
    expect(list.textContent).not.toContain("礼物 送礼者：");
  });
});

describe("第三轮审核返工：R5（看门狗全程覆盖 + 续播判定绑定真实落位）", () => {
  /** 模拟真实 performSeek：Range 探测飞行 100ms 后（网络阶段完成）才 arm + resolve */
  function armOnResolveAfter(delayMs = 100) {
    return vi.fn(
      (args: PerformSeekArgs) =>
        new Promise<boolean>((resolve) => {
          window.setTimeout(() => {
            args.watchdog?.arm();
            resolve(true);
          }, delayMs);
        }),
    );
  }

  it("R5(1) 旧播放已在目标 ±1s 邻域发起 seek：飞行期 spinner 与进度锁定不解除", async () => {
    vi.useFakeTimers();
    const events = [makeEvent("e1", 55, "目标事件")]; // 目标 55s
    const performSeek = armOnResolveAfter();
    const deps = makeDeps({
      performSeek,
      fetchEvents: () => Promise.resolve({ total: 1, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    // 旧播放恰好停在目标邻域内（缓冲边缘/相邻事件 seek/进度微调皆为常态）
    video.currentTime = 55.6;
    fireEvent.timeUpdate(video);

    fireEvent.click(screen.getByRole("button", { name: /目标事件/ }));
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();

    // 飞行期（performSeek 未返回）旧播放继续推进，仍在目标邻域内 → 不得被 nearTarget 提前消费
    video.currentTime = 55.9;
    fireEvent.timeUpdate(video);
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "播放进度" })).toBeDisabled();

    // performSeek 生效后落位 → 才解除
    act(() => {
      vi.advanceTimersByTime(200);
    });
    await flush();
    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R5(2) 飞行期残留 seeked 不消费 latch：不产生孤儿看门狗，恢复后 15s 无误报", async () => {
    vi.useFakeTimers();
    const events = [makeEvent("e1", 61, "目标事件")];
    const performSeek = armOnResolveAfter();
    const deps = makeDeps({
      performSeek,
      fetchEvents: () => Promise.resolve({ total: 1, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    video.currentTime = 10;
    fireEvent.click(screen.getByRole("button", { name: /目标事件/ }));
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();

    // 飞行期：上一次 seek 的补丁 clamp（scheduleSeekAlignment）残留触发的 seeked
    fireEvent.seeked(video);
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200); // performSeek 成功 → applied + arm
    });
    await flush();

    // 真实恢复：落位 60s（跳变）
    video.currentTime = 60;
    fireEvent.timeUpdate(video);
    await flush();
    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R5(3) Range fetch 挂起：15s 内给出超时错误与重试入口，不永久 spinner", async () => {
    vi.useFakeTimers();
    const events = [makeEvent("e1", 61, "目标事件")];
    const performSeek = vi.fn(() => new Promise<boolean>(() => {})); // 网络阶段永不返回
    const deps = makeDeps({
      performSeek,
      fetchEvents: () => Promise.resolve({ total: 1, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: /目标事件/ }));
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();

    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("seek 超时");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});

describe("第四轮审核返工：R6（超时作废在途 seek / seeked 归属窗口）", () => {
  /** 模拟慢速 Range：响应要等测试手动放行（弱网 9GB 录播扫描窗下载 >15s 的真实场景） */
  function makePendingRangeResponse() {
    const holder: { release: ((value: Response) => void) | null } = { release: null };
    const fetchFn = (() =>
      new Promise<Response>((resolve) => {
        holder.release = resolve;
      })) as unknown as typeof fetch;
    const emptyRange: Response = {
      ok: true,
      status: 206,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
    return { fetchFn, release: () => holder.release?.(emptyRange) };
  }

  it("R5(4) 超时作废在途 seek：迟到 Range 不执行补丁跳转，失败保持显性错误与重试", async () => {
    vi.useFakeTimers();
    const events = [makeEvent("e1", 61, "目标事件")];
    const pendingRange = makePendingRangeResponse();
    const seekSpy = vi.fn();
    const performSeekImpl = vi.fn((args: PerformSeekArgs) =>
      realPerformSeek({
        ...args,
        fetchFn: pendingRange.fetchFn,
        seekToByteOffset: seekSpy,
      }),
    );
    const deps = makeDeps({
      performSeek: performSeekImpl,
      fetchEvents: () => Promise.resolve({ total: 1, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    // 播放中发起 seek（实现不以 paused 为判据，故无需构造该属性，审核 次-3③）
    fireEvent.click(screen.getByRole("button", { name: /目标事件/ }));
    await flush();

    // T=15s：看门狗超时 → 作废在途 seek（abort）+ 显性报错
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("seek 超时");

    // T=20s+：Range 响应才迟到 → 已作废，不得再触碰媒体元素
    act(() => {
      pendingRange.release();
    });
    await flush();

    expect(seekSpy).not.toHaveBeenCalled(); // 未执行补丁跳转（审核 R6-a 不变量1）
    // 终局仍须显性失败（审核 R7-b）：错误与重试持续可见，不以 paused 吞错
    expect(screen.getByRole("alert")).toHaveTextContent("seek 超时");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument();
  });

  it("R6-c 残留 clamp 的 seeked 不消费本次 latch；真实落位（落点=apply 采样）经位置归属即时收敛", async () => {
    vi.useFakeTimers();
    const events = [makeEvent("e1", 61, "第一次"), makeEvent("e2", 120, "第二次")];
    let videoEl: HTMLVideoElement | null = null;
    // 模拟真实 apply：补丁 directSeek 同步把 currentTime 置到落点（与目标可偏离）
    const performSeek = vi.fn(async (args: PerformSeekArgs) => {
      args.watchdog?.arm();
      if (videoEl) videoEl.currentTime = args.targetSeconds === 61 ? 61 : 118;
      return true;
    });
    const deps = makeDeps({
      performSeek,
      fetchEvents: () => Promise.resolve({ total: 2, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();
    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    videoEl = video;

    // 第一次 seek：apply 后落点=目标 → 立即收敛（建立 apply 时间戳）
    fireEvent.click(screen.getByRole("button", { name: /第一次/ }));
    await flush();
    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument();

    // 1s 后发起第二次 seek（前次补丁 clamp 链仍在运行）
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    fireEvent.click(screen.getByRole("button", { name: /第二次/ }));
    await flush();
    await flush(); // performSeek resolve → applied（落点 118，偏离目标 2s → 不近目标，不收敛）
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();

    // 前次 seek 的 scheduleSeekAlignment 残留 seeked：位置与本次落点/目标均不符 → 不得消费
    video.currentTime = 55;
    fireEvent.seeked(video);
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();

    // 真实落位：位置=本次 apply 采样落点（118）→ 按位置归属即时收敛
    video.currentTime = 118;
    fireEvent.seeked(video);
    await flush();
    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("第十轮审核返工：R12（StrictMode / MSE 降级 / 弹幕清屏 / readyPending）", () => {
  it("R12-a StrictMode 双挂载下 useReplayEvents 仍完成加载（disposed 可复活）", async () => {
    const events = [makeEvent("e1", 10, "第一条")];
    const deps = makeDeps({ fetchEvents: () => Promise.resolve({ total: 1, items: events }) });

    render(
      <StrictMode>
        <ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />
      </StrictMode>,
    );

    // 红：StrictMode 首挂载 setup→cleanup(dispose)→setup 后 store 终局，
    // 快照永停 loading=true、events=[]，事件条目永不出现
    await waitFor(
      () => expect(screen.getByRole("button", { name: /第一条/ })).toBeInTheDocument(),
      { timeout: 2000 },
    );
    expect(screen.queryByText(/正在加载弹幕事件/)).not.toBeInTheDocument();
    expect(screen.getByTestId("event-list").textContent).not.toContain("加载失败");
  });
});

describe("第五轮审核返工：R7（真实落位归属为唯一收敛判据）", () => {
  it("R7-a 关键帧落位晚于超时到达：真实落位清除超时浮层（latch/看门狗已终局也一样）", async () => {
    vi.useFakeTimers();
    const events = [makeEvent("e1", 61, "目标事件")];
    let videoEl: HTMLVideoElement | null = null;
    // 注入 performSeek：8s 后 apply 成功（directSeek 已把 currentTime 落到关键帧 55，偏离目标 6s >1s）
    const performSeek = vi.fn(
      (args: PerformSeekArgs) =>
        new Promise<boolean>((resolve) => {
          window.setTimeout(() => {
            if (videoEl) videoEl.currentTime = 55; // apply：落点=关键帧时间戳
            args.watchdog?.arm();
            resolve(true);
          }, 8_000);
        }),
    );
    const deps = makeDeps({
      performSeek,
      fetchEvents: () => Promise.resolve({ total: 1, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();
    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    videoEl = video;

    fireEvent.click(screen.getByRole("button", { name: /目标事件/ }));
    await flush();
    act(() => {
      vi.advanceTimersByTime(8_000); // apply（落点偏离目标 >1s → nearTarget 不命中）
    });
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(7_000); // T=15s：超时（此时仅清理 UI，落位监控继续）
    });
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("seek 超时");

    // T=18s：真实落位数据到达（seeked，位置=apply 时采样的落点 55）
    await flush();
    fireEvent.seeked(video);
    await flush();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // 红：超时浮层残留于实际在播的视频之上
    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument();
  });

  it("R7-b 播放中 seek 超时：abort 令 fetch 立即 reject，错误与重试持续可见（不以 paused 吞错）", async () => {
    vi.useFakeTimers();
    const events = [makeEvent("e1", 61, "目标事件")];
    const seekSpy = vi.fn();
    // 真实 fetch 时序：收到 abort 信号立即 reject
    const fetchFn = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      })) as unknown as typeof fetch;
    const performSeekImpl = vi.fn((args: PerformSeekArgs) =>
      realPerformSeek({ ...args, fetchFn, seekToByteOffset: seekSpy }),
    );
    const deps = makeDeps({
      performSeek: performSeekImpl,
      fetchEvents: () => Promise.resolve({ total: 1, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();

    // 播放中发起 seek（实现不以 paused 为判据，审核 次-3③）
    fireEvent.click(screen.getByRole("button", { name: /目标事件/ }));
    await flush();

    act(() => {
      vi.advanceTimersByTime(15_000); // 超时 → abort → fetch 立即 reject → onAborted
    });
    await flush();

    // 一切失败终局一律保留显性错误 + 重试（审核 R7-b / AC-6）
    expect(screen.getByRole("alert")).toHaveTextContent("seek 超时");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument();
    expect(seekSpy).not.toHaveBeenCalled();
  });

  it("R7-c(1) 越窗（链尾 +5.0s 于 +5.3s）到达的残留 seeked 不得消费本次 latch", async () => {
    vi.useFakeTimers();
    const events = [makeEvent("e1", 61, "第一次"), makeEvent("e2", 120, "第二次")];
    let videoEl: HTMLVideoElement | null = null;
    const performSeek = vi.fn(async (args: PerformSeekArgs) => {
      args.watchdog?.arm();
      if (videoEl) videoEl.currentTime = args.targetSeconds === 61 ? 61 : 118; // apply 落点
      return true;
    });
    const deps = makeDeps({
      performSeek,
      fetchEvents: () => Promise.resolve({ total: 2, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();
    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    videoEl = video;

    fireEvent.click(screen.getByRole("button", { name: /第一次/ })); // apply at t0（建立 prevApplyAt）
    await flush();
    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    fireEvent.click(screen.getByRole("button", { name: /第二次/ })); // apply 落点 118
    await flush();
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();

    // 前次 clamp 链尾（+5.0s）的 seeked 于 +5.3s 投递（越过任何 5s 时间窗），位置为残留 clamp 落点
    act(() => {
      vi.advanceTimersByTime(5_200);
    });
    video.currentTime = 60.5; // 残留 clamp 落点：既非本次落点 118、也非目标 120 邻域
    fireEvent.seeked(video);
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument(); // 红：越窗残留 seeked 提前消费 latch

    // 真实落位（位置=本次 apply 采样落点）仍可归属收敛
    video.currentTime = 118;
    fireEvent.seeked(video);
    await flush();
    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R7-c(2) 窗内真实落位（目标近距、非大位移）经位置归属即时收敛，不被时间窗误杀", async () => {
    vi.useFakeTimers();
    const events = [makeEvent("e1", 61, "第一次"), makeEvent("e2", 120, "第二次")];
    const performSeek = vi.fn(async (args: PerformSeekArgs) => {
      args.watchdog?.arm();
      return true; // apply 成功但落位数据未到：currentTime 仍停在旧位置（补丁 RECOMMEND_SEEKPOINT 后续才落位）
    });
    const deps = makeDeps({
      performSeek,
      fetchEvents: () => Promise.resolve({ total: 2, items: events }),
    });
    render(<ReplayStage roomId={1001} file={file} bounds={bounds} deps={deps} />);
    await flush();
    const video = screen.getByLabelText("录播视频") as HTMLVideoElement;
    video.currentTime = 61;

    fireEvent.click(screen.getByRole("button", { name: /第一次/ }));
    await flush();
    video.currentTime = 61; // 第一次落位到目标 → 收敛（建立 prevApplyAt）
    fireEvent.seeked(video);
    await flush();
    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    fireEvent.click(screen.getByRole("button", { name: /第二次/ })); // target 120，apply 后 currentTime 仍为 61
    await flush();
    await flush();
    expect(screen.getByRole("status", { name: "缓冲中" })).toBeInTheDocument();

    // 窗内（前次 apply 后 1.1s）真实落位 seeked：位置=目标近距（119.5 vs 120，非大位移）→ 立即收敛
    video.currentTime = 119.5;
    fireEvent.seeked(video);
    await flush();
    expect(screen.queryByRole("status", { name: "缓冲中" })).not.toBeInTheDocument(); // 红：被时间窗误杀，只能等超时

    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
