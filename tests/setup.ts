import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest 未开 globals，RTL 无法自动注册清理，需显式卸载上一用例的组件
afterEach(() => {
  cleanup();
});

// jsdom 不实现 window.scrollTo（回顶降级路径会触发），静默其警告
window.scrollTo = () => {};

// jsdom 缺少 window.matchMedia，Mantine 组件依赖它（Mantine 官方文档标准做法）
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
});
