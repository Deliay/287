import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import Lenis from "lenis";
import { SmoothScroll } from "@/components/smooth-scroll";
import { getLenis } from "@/lib/lenis";
import { renderWithTheme } from "./utils";

const LenisMock = vi.mocked(Lenis);

vi.mock("lenis", () => ({
  default: vi.fn(function LenisStub(this: unknown) {
    return { destroy: vi.fn(), scrollTo: vi.fn() };
  }),
}));

const snapAdds = vi.hoisted(() => [] as number[]);
const snapDestroy = vi.hoisted(() => vi.fn());
const SnapMock = vi.hoisted(() =>
  vi.fn(function SnapStub(this: unknown) {
    return {
      add: (value: number) => {
        snapAdds.push(value);
        return () => {};
      },
      destroy: snapDestroy,
      resize: vi.fn(),
    };
  }),
);

vi.mock("lenis/snap", () => ({ default: SnapMock }));

const MEMBER_IDS = ["viridis", "komichi", "chu2u", "sumire"];

/** 在 document.body 挂出首屏之外的 4 个介绍区（含标题 id，验证选择器不误命中），返回清理函数 */
function mountMemberSections(): () => void {
  const sections = MEMBER_IDS.map((id, index) => {
    const section = document.createElement("section");
    section.id = `member-${id}`;
    const heading = document.createElement("h2");
    heading.id = `member-${id}-heading`;
    section.appendChild(heading);
    // jsdom 无布局：注入等价于一屏高度的视口矩形（吸附点按 getBoundingClientRect 计算）
    Object.defineProperty(section, "getBoundingClientRect", {
      value: () =>
        ({
          top: index * 768,
          bottom: (index + 1) * 768,
          left: 0,
          right: 0,
          width: 0,
          height: 768,
          x: 0,
          y: index * 768,
          toJSON: () => ({}),
        }) as DOMRect,
      configurable: true,
    });
    document.body.appendChild(section);
    return section;
  });
  return () => sections.forEach((section) => section.remove());
}

function mockMatchMedia(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  snapAdds.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("阻尼滚动 SmoothScroll", () => {
  it("PC 断点命中时初始化 lenis（autoRaf + 显式动画参数）并注册实例，卸载时 destroy（AC-4）", () => {
    mockMatchMedia(true);

    const { unmount } = renderWithTheme(<SmoothScroll />);

    expect(LenisMock).toHaveBeenCalledTimes(1);
    const lenisOptions = LenisMock.mock.calls[0][0] as Record<string, unknown>;
    expect(lenisOptions).toMatchObject({ autoRaf: true });
    // 显式动画参数：滚动/吸附必须走时长插值，不得依赖库默认的瞬时/lerp 行为
    expect(typeof lenisOptions.duration).toBe("number");
    expect(lenisOptions.duration as number).toBeGreaterThan(0);
    expect(typeof lenisOptions.easing).toBe("function");
    // PRD FR-2「无视减少动效规定，呈现完整动效」：不接受 lenis 的 reduced-motion 降级
    expect(lenisOptions.respectReducedMotion).toBe(false);

    const instance = LenisMock.mock.results[0].value;
    expect(getLenis()).toBe(instance);

    unmount();
    expect(instance.destroy).toHaveBeenCalled();
    expect(getLenis()).toBeNull();
  });

  it("proximity 吸附显式配置 duration 与 easing，归位为动画过程而非瞬时跳变（AC-4）", () => {
    mockMatchMedia(true);
    renderWithTheme(<SmoothScroll />);

    expect(SnapMock).toHaveBeenCalledTimes(1);
    const [, snapOptions] = SnapMock.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(snapOptions.type).toBe("proximity");
    expect(typeof snapOptions.duration).toBe("number");
    expect(snapOptions.duration as number).toBeGreaterThan(0);
    expect(typeof snapOptions.easing).toBe("function");
    // 参数可用：easing 是合法的 [0,1] → [0,1] 单调映射
    const easing = snapOptions.easing as (t: number) => number;
    expect(easing(0)).toBeCloseTo(0, 5);
    expect(easing(1)).toBeCloseTo(1, 5);
  });

  it("移动端断点不命中时不初始化 lenis、不注册吸附点（保留原生滚动）", () => {
    mockMatchMedia(false);
    const cleanup = mountMemberSections();

    render(<SmoothScroll />);

    expect(LenisMock).not.toHaveBeenCalled();
    expect(getLenis()).toBeNull();
    expect(SnapMock).not.toHaveBeenCalled();
    expect(snapAdds).toHaveLength(0);

    cleanup();
  });

  it("PC 断点注册 4 个介绍区中心为吸附点，卸载时清理吸附与 lenis（AC-6 装配）", () => {
    mockMatchMedia(true);
    const cleanup = mountMemberSections();

    const { unmount } = renderWithTheme(<SmoothScroll />);

    // 只注册介绍区 section，不误命中 member-{id}-heading 标题
    expect(SnapMock).toHaveBeenCalledTimes(1);
    expect(snapAdds).toHaveLength(4);
    // 吸附点 = 各介绍区中心 - 半个视口（使其停在介绍区正中）
    expect(snapAdds).toEqual(
      MEMBER_IDS.map((_, index) => index * 768 + 768 / 2 - window.innerHeight / 2),
    );

    unmount();
    expect(snapDestroy).toHaveBeenCalled();

    cleanup();
  });

  it("lenis 存在时点击站内锚点：阻止默认跳转并交给 lenis.scrollTo(hash)", () => {
    mockMatchMedia(true);
    const { unmount } = renderWithTheme(<SmoothScroll />);
    const instance = LenisMock.mock.results[0].value;

    const anchor = document.createElement("a");
    anchor.href = "#member-viridis";
    document.body.appendChild(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(instance.scrollTo).toHaveBeenCalledWith("#member-viridis");

    anchor.remove();
    unmount();
  });

  it("lenis 不存在（未初始化/移动端）时不拦截锚点，放行原生跳转", () => {
    mockMatchMedia(false);
    const { unmount } = renderWithTheme(<SmoothScroll />);

    const anchor = document.createElement("a");
    anchor.href = "#member-komichi";
    document.body.appendChild(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(LenisMock).not.toHaveBeenCalled();

    anchor.remove();
    unmount();
  });

  it("非站内锚点链接（如外链徽章）不被拦截", () => {
    mockMatchMedia(true);
    const { unmount } = renderWithTheme(<SmoothScroll />);
    const instance = LenisMock.mock.results[0].value;

    const link = document.createElement("a");
    link.href = "https://space.bilibili.com/1891335475";
    document.body.appendChild(link);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(instance.scrollTo).not.toHaveBeenCalled();

    link.remove();
    unmount();
  });
});

describe("逐屏吸附（CSS 降级路径，AC-7 结构断言）", () => {
  it("移动端（< 48em）根滚动容器启用 proximity 吸附", () => {
    const globals = readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    expect(globals).toMatch(
      /@media[^{}]*max-width[^{}]*\{[^}]*scroll-snap-type:\s*y\s*proximity/,
    );
  });

  it("介绍区 section 声明 scroll-snap-align: center", () => {
    const sectionCss = readFileSync(
      path.join(process.cwd(), "src/components/member-section.module.css"),
      "utf8",
    );
    expect(sectionCss).toMatch(
      /\.section[^{}]*\{[^}]*scroll-snap-align:\s*center/,
    );
  });
});

describe("完整动效保障（PRD FR-2 / AC-4）", () => {
  it("src/ 全量源码不存在 prefers-reduced-motion 降级规则（防止后续引入）", () => {
    const files = listSourceFiles(path.join(process.cwd(), "src"));
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) =>
      /prefers-reduced-motion/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

/** 递归收集目录下全部 .ts/.tsx/.css 源码文件路径 */
function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(?:ts|tsx|css)$/.test(entry.name) ? [full] : [];
  });
}
