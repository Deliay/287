/**
 * 未开播标题降级链②（PRD FR-2 · 审核 R14-2）的模块级缓存：
 * 用户点开某成员录播分组、取数成功时写入「最新一场非空 `info.title`」，
 * 状态卡片读取用于回填未开播标题——纯前端缓存，**不为此新增任何请求**
 * （与 FR-4 点击前零请求约束一致；降级链终点为「不展示标题行」）。
 */

const titles = new Map<string, string>();
const listeners = new Set<() => void>();

/** 写入某成员的最新场次标题（空串/undefined 忽略）；值变化时通知订阅者。 */
export function setLastTitle(memberId: string, title: string | undefined): void {
  const next = title?.trim();
  if (!next || titles.get(memberId) === next) return;
  titles.set(memberId, next);
  for (const listener of listeners) listener();
}

/** 读取某成员缓存的标题；从未取过数返回 undefined（降级链③）。 */
export function getLastTitle(memberId: string): string | undefined {
  return titles.get(memberId);
}

/** 订阅缓存变化（状态卡片 useSyncExternalStore 用）。 */
export function subscribeLastTitle(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
