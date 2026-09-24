/**
 * 录播分组「按需展开」事件：直播状态卡片点击（非按钮区域）→ 定位并展开对应录播分组
 * （设计文档 §2.3「卡片点击滚动定位到下方对应成员的录播分组并展开」）。
 *
 * 用轻量 CustomEvent 解耦「状态卡片」与「录播分组」两个兄弟区块，
 * 避免为一次点击把两者的加载状态上提成共享 context。
 */

export const REVEAL_GROUP_EVENT = "recordings:reveal-group";

export interface RevealGroupDetail {
  memberId: string;
}

/** 广播「展开某成员的录播分组」。 */
export function dispatchRevealGroup(memberId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<RevealGroupDetail>(REVEAL_GROUP_EVENT, { detail: { memberId } }),
  );
}

/** 从事件对象读取目标成员 id；不匹配返回 null。 */
export function readRevealMemberId(event: Event): string | null {
  const detail = (event as CustomEvent<RevealGroupDetail | undefined>).detail;
  return typeof detail?.memberId === "string" ? detail.memberId : null;
}
