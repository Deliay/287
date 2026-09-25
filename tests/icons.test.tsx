import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IconDownload, IconTheater } from "@/components/icons";
import { GLYPH_RE } from "./utils";

/**
 * 录播优化一期新增图标（实现计划 T2 · R14-5 图标口径）：
 * 一律内联 SVG、描边风格与既有 `ICON_SVG` 一致，不使用 emoji/Unicode 字形。
 */
describe("新增 SVG 图标 IconDownload / IconTheater（T2 / AC-2、AC-5 图标部分）", () => {
  const cases: Array<{ name: string; label: string }> = [
    { name: "IconDownload", label: "下载" },
    { name: "IconTheater", label: "网页全屏" },
  ];

  it.each(cases)("IconDownload/IconTheater 中的 $name 渲染为内联 svg（aria-hidden + viewBox 0 0 24 24）", ({ label }) => {
    const { container } = render(
      <span data-testid="icon-host">
        {label === "下载" ? <IconDownload /> : <IconTheater />}
      </span>,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("width")).toBe("1em");
    expect(svg?.getAttribute("height")).toBe("1em");
    // 描边风格与既有 ICON_SVG 一致（fill:none + currentColor 描边）
    expect(svg?.getAttribute("fill")).toBe("none");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    // 无 emoji / Unicode 字形
    expect(GLYPH_RE.test(screen.getByTestId("icon-host").textContent ?? "")).toBe(false);
  });
});
