import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { IconDownload, IconTheater } from "@/components/icons";
import { GLYPH_RE } from "./utils";

/**
 * 录播优化一期新增图标（实现计划 T2 · R14-5 图标口径）：
 * 一律内联 SVG、描边风格与既有 `ICON_SVG` 一致，不使用 emoji/Unicode 字形。
 * 所在按钮（下载项 / 网页全屏按钮）的 SVG 断言在 T3 / T7 用例覆盖。
 */
describe("新增 SVG 图标 IconDownload / IconTheater（T2 / AC-2、AC-5 图标部分）", () => {
  it("两个图标均渲染为内联 svg（aria-hidden、viewBox 0 0 24 24、描边风格、无字形）", () => {
    const { container } = render(
      <>
        <IconDownload />
        <IconTheater />
      </>,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) {
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("width")).toBe("1em");
      expect(svg.getAttribute("height")).toBe("1em");
      expect(svg.getAttribute("fill")).toBe("none");
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(GLYPH_RE.test(svg.textContent ?? "")).toBe(false);
    }
    expect(GLYPH_RE.test(container.textContent ?? "")).toBe(false);
  });
});
