import type { ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { render } from "@testing-library/react";
import { theme } from "@/theme";

/** MantineProvider（注入站点主题）包裹的 render，所有组件用例统一使用 */
export function renderWithTheme(ui: ReactNode) {
  return render(<MantineProvider theme={theme}>{ui}</MantineProvider>);
}

/**
 * R14-5 图标口径断言用：emoji / Unicode 几何字形集合。
 * 覆盖 ←(2190)、─(2500)、■▸▾▢(25A0-25FF)、♪(266A)、⛶(26F6)、✕(2715)、⏸▶(23F8/25B6)、🔊(1F50A) 等；
 * 不含 ×(00D7，倍速「1×」) 与中文/常规标点。
 */
export const GLYPH_RE =
  /[\u2190-\u21FF\u2300-\u23FF\u2500-\u27BF\u2B00-\u2BFF]|[\u{1F300}-\u{1FAFF}]/u;
