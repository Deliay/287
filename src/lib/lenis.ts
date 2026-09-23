/** 回顶所需的最小 lenis 能力（lenis 实例的 scrollTo 满足结构兼容） */
export interface ScrollToTop {
  scrollTo(target: number): void;
}

let instance: ScrollToTop | null = null;

/** 由 SmoothScroll 在初始化/销毁时注册或清除 lenis 实例 */
export function setLenis(next: ScrollToTop | null): void {
  instance = next;
}

export function getLenis(): ScrollToTop | null {
  return instance;
}
