"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { setLenis } from "@/lib/lenis";

/**
 * 阻尼滚动：仅 PC（≥ 48em）启用 lenis，移动端保留原生触屏惯性滚动。
 * 初始化失败或不支持时自然降级为原生滚动，不影响内容可达性。
 */
export function SmoothScroll() {
  useEffect(() => {
    if (!window.matchMedia("(min-width: 48em)").matches) {
      return;
    }

    const lenis = new Lenis({ autoRaf: true });
    setLenis(lenis);

    return () => {
      setLenis(null);
      lenis.destroy();
    };
  }, []);

  return null;
}
