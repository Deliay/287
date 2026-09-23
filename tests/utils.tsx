import type { ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { render } from "@testing-library/react";
import { theme } from "@/theme";

/** MantineProvider（注入站点主题）包裹的 render，所有组件用例统一使用 */
export function renderWithTheme(ui: ReactNode) {
  return render(<MantineProvider theme={theme}>{ui}</MantineProvider>);
}
