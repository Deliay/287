"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import Snap from "lenis/snap";
import { getLenis, setLenis } from "@/lib/lenis";

/**
 * 吸附点 = 介绍区中心 - 半个视口，使页面停在介绍区正中。
 * 用 getBoundingClientRect + scrollY（相对视口换算到文档坐标），
 * 不用 offsetTop：后者相对 offsetParent，出现定位祖先即会算错。
 */
function sectionCenter(section: HTMLElement): number {
  const rect = section.getBoundingClientRect();
  return (
    rect.top + window.scrollY + rect.height / 2 - window.innerHeight / 2
  );
}

/**
 * 站内锚点拦截：lenis 可用时交给 lenis 平滑滚动；
 * lenis 不存在（移动端/未初始化）或事件已被处理方 preventDefault（如导航回顶）时放行原生行为。
 */
function handleAnchorClick(event: MouseEvent): void {
  if (event.defaultPrevented) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  // 取最近的祖先链接：外链徽章（如开播态 LiveBadge）必须保持默认的新开标签页行为
  const anchor = target.closest("a");
  if (!anchor) {
    return;
  }
  const href = anchor.getAttribute("href") ?? "";
  if (!href.startsWith("#") || href.length <= 1) {
    return;
  }
  const lenis = getLenis();
  if (!lenis) {
    return;
  }
  event.preventDefault();
  lenis.scrollTo(href);
}

/**
 * 阻尼滚动：仅 PC（≥ 48em）启用 lenis，移动端保留原生触屏惯性滚动。
 * 初始化失败或不支持时自然降级为原生滚动，不影响内容可达性。
 * PC 端逐屏吸附由 lenis/snap 提供（proximity，只在接近介绍区中心时吸附）；
 * 移动端吸附走 CSS scroll-snap（见 globals.css / member-section.module.css）。
 */
export function SmoothScroll() {
  useEffect(() => {
    document.addEventListener("click", handleAnchorClick);
    return () => {
      document.removeEventListener("click", handleAnchorClick);
    };
  }, []);

  useEffect(() => {
    if (!window.matchMedia("(min-width: 48em)").matches) {
      return;
    }

    const lenis = new Lenis({ autoRaf: true });
    setLenis(lenis);

    const snap = new Snap(lenis, { type: "proximity" });
    let unsubscribes: Array<() => void> = [];

    const registerSnaps = () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      // 限定 section 元素：避免命中介绍区标题 id="member-{id}-heading"
      unsubscribes = Array.from(
        document.querySelectorAll<HTMLElement>("section[id^='member-']"),
      ).map((section) => snap.add(sectionCenter(section)));
    };

    const handleResize = () => {
      registerSnaps();
      snap.resize();
    };

    registerSnaps();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      snap.destroy();
      setLenis(null);
      lenis.destroy();
    };
  }, []);

  return null;
}
