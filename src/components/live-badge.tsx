"use client";

import type { Member } from "@/data/members";
import { useLiveStatus } from "@/lib/live-status";
import styles from "./live-badge.module.css";

export interface LiveBadgeProps {
  member: Member;
}

/** 直播标题超过该字数时挂截断样式（CSS ellipsis） */
const TITLE_ELLIPSIS_THRESHOLD = 16;

/**
 * 直播状态徽章（Client 孤岛，HeroWall / MemberSection 内嵌）。
 * 三态：加载中占位骨架 / 开播显示直播标题（可点击）/ 未开播纯文本（不可点击）。
 */
export function LiveBadge({ member }: LiveBadgeProps) {
  const { status } = useLiveStatus(member.id);

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
        href={member.liveUrl ?? member.bilibili}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${member.romanName} 正在直播：${title}`}
      >
        {title}
      </a>
    );
  }

  return (
    <span
      className={`${styles.badge} ${styles.offline}`}
      aria-label={`${member.romanName} 未开播`}
    >
      未开播
    </span>
  );
}
