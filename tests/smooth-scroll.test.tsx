import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("阻尼滚动 SmoothScroll", () => {
  it("PC 断点命中时初始化 lenis（autoRaf）并注册实例，卸载时 destroy", () => {
    mockMatchMedia(true);

    const { unmount } = renderWithTheme(<SmoothScroll />);

    expect(LenisMock).toHaveBeenCalledWith({ autoRaf: true });
    const instance = LenisMock.mock.results[0].value;
    expect(getLenis()).toBe(instance);

    unmount();
    expect(instance.destroy).toHaveBeenCalled();
    expect(getLenis()).toBeNull();
  });

  it("移动端断点不命中时不初始化 lenis（保留原生滚动）", () => {
    mockMatchMedia(false);

    render(<SmoothScroll />);

    expect(LenisMock).not.toHaveBeenCalled();
    expect(getLenis()).toBeNull();
  });
});
