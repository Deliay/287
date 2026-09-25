"use client";

import type { ReactNode } from "react";
import { liveRoomUrl, type Member } from "@/data/members";
import { useLiveStatus } from "@/lib/live-status";
import styles from "./live-badge.module.css";

export interface LiveBadgeProps {
  member: Member;
  /**
   * 未开播态的**替换**渲染节点（PRD FR-4 · 返工 R1）：传入时在徽章同一位置渲染该节点，
   * 不再输出「未开播」纯文本——二者二选一、不并列。缺省不传（HeroWall）保持 AC-3 原行为。
   * 详情区据此挂载录播入口，徽章同时是该区域直播状态的**单一状态出口**（只订阅一次）。
   */
  offlineNode?: ReactNode;
}

/** 直播标题超过该字数时挂截断样式（CSS ellipsis） */
const TITLE_ELLIPSIS_THRESHOLD = 16;

/**
 * 直播状态徽章（Client 孤岛，HeroWall / MemberSection 内嵌）。
 * 三态：加载中占位骨架 / 开播显示「正在直播：{标题}」（可点击）/ 未开播（不可点击）。
 * 未开播态：传入 `offlineNode` 时以替换方式输出该节点（详情区录播入口），否则输出「未开播」纯文本（HeroWall，AC-3）。
 * 开播态跳转目标：`liveUrl` 逃生口 → `roomId` 推导的直播间 → 缺失降级个人主页（AC-1/AC-2）。
 */
export function LiveBadge({ member, offlineNode }: LiveBadgeProps) {
  const { status } = useLiveStatus(member.id);

  /** 开播跳转目标（两级降级链，技术方案 FR-1）：直播间优先，roomId 缺失回落个人主页 */
  const livingHref =
    member.liveUrl ??
    (member.roomId !== undefined ? liveRoomUrl(member.roomId) : member.bilibili);

  if (status === null) {
    // 加载中：固定高度占位，避免布局跳动；不渲染链接
    return (
      <span
        className={`${styles.badge} ${styles.skeleton}`}
        aria-hidden="true"
      />
    );
  }

  if (status.living) {
    const title = status.title ?? "";
    const className = [
      styles.badge,
      styles.living,
      title.length > TITLE_ELLIPSIS_THRESHOLD ? styles.ellipsis : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <a
        className={className}
        href={livingHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${member.romanName} 正在直播：${title}`}
      >
        {`正在直播：${title}`}
      </a>
    );
  }

  // 未开播：详情区在此**同一位置**替换为录播入口（PRD FR-4 · 返工 R1，二选一不并列）；
  // HeroWall 缺省 offlineNode，保持「未开播」纯文本与 AC-3 行为
  return (
    <>
      {offlineNode ?? (
        <span
          className={`${styles.badge} ${styles.offline}`}
          aria-label={`${member.romanName} 未开播`}
        >
          未开播
        </span>
      )}
    </>
  );
}
