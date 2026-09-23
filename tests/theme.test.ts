import { describe, expect, it } from "vitest";
import { theme } from "@/theme";

/** 期望色阶逐项抄自设计文档 §1，禁止重新生成 */
const PALETTES = {
  night287: [
    "#f4f3f5", "#dedde2", "#c4c2cc", "#a5a2b0", "#888497",
    "#706a81", "#5c5670", "#454154", "#2e2b38", "#1c1a22",
  ],
  viridis: [
    "#f7f9f3", "#e8efdd", "#d6e3c2", "#c1d4a2", "#adc584",
    "#9cb96a", "#8eb056", "#6b8441", "#47582b", "#2b351a",
  ],
  komichi: [
    "#fff0f1", "#ffd3d6", "#ffafb5", "#ff858e", "#ff5e69",
    "#ff3d4a", "#ff2231", "#bf1a25", "#801119", "#4d0a0f",
  ],
  chu2u: [
    "#fcfcf6", "#f6f8e5", "#f0f2cf", "#e7ebb6", "#e0e49f",
    "#d9de8b", "#d4da7b", "#9fa45c", "#6a6d3e", "#404125",
  ],
  sumire: [
    "#faf9fb", "#f0edf2", "#e4dfe8", "#d6cedc", "#c8bed0",
    "#bdb1c7", "#b4a6bf", "#877d8f", "#5a5360", "#363239",
  ],
} as const;

const lower = (colors: readonly string[] | undefined) =>
  Array.from(colors ?? []).map((color) => color.toLowerCase());

/** MantineThemeColors 类型上 colors 为可选，收窄后断言 */
const colors: Record<string, readonly string[] | undefined> = theme.colors ?? {};

describe("主题调色盘 theme.colors", () => {
  it("注册 287 团体调色盘与四套成员调色盘，每套 10 级色阶", () => {
    for (const key of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
      expect(colors[key]?.length, `${key} 应为 10 级色阶`).toBe(10);
    }
  });

  it("五套色阶逐项色值与设计文档 §1 一致（统一小写比较）", () => {
    for (const key of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
      expect(lower(colors[key])).toEqual([...PALETTES[key]]);
    }
  });

  it("各成员色阶 index 6 为代表色，night287[6] 为主色 #5c5670", () => {
    expect(colors.viridis?.[6].toLowerCase()).toBe("#8eb056");
    expect(colors.komichi?.[6].toLowerCase()).toBe("#ff2231");
    expect(colors.chu2u?.[6].toLowerCase()).toBe("#d4da7b");
    expect(colors.sumire?.[6].toLowerCase()).toBe("#b4a6bf");
    expect(colors.night287?.[6].toLowerCase()).toBe("#5c5670");
  });

  it("night287[8] 为导航底色 #2e2b38，night287[9] 为页面底色 #1c1a22", () => {
    expect(colors.night287?.[8].toLowerCase()).toBe("#2e2b38");
    expect(colors.night287?.[9].toLowerCase()).toBe("#1c1a22");
  });
});
