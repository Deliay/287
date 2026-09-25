"use client";

import Link from "next/link";
import type { Member } from "@/data/members";
import { useLiveStatus } from "@/lib/live-status";
import styles from "./recording-entry.module.css";

export interface RecordingEntryProps {
  member: Member;
}

/**
 * 未开播录播入口（PRD FR-4 · Client 孤岛，仅 `MemberSection` 挂载）。
 *
 * 数据源复用 `useLiveStatus(member.id)` 的模块级缓存：与同页 `LiveBadge`
 * 共享同一次直播状态请求，不引入额外请求（PRD §5）。
 * 三态：加载中不渲染（避免状态闪烁）、开播不渲染、未开播渲染一行站内文本链接
 * `/recordings?member={id}`（与录播页 FR-3 的 query param 约定一致，AC-8）。
 */
export function RecordingEntry({ member }: RecordingEntryProps) {
  const { status } = useLiveStatus(member.id);

  if (status === null || status.living) {
    return null;
  }

  return (
    <Link className={styles.entry} href={`/recordings?member=${member.id}`}>
      {"未开播，看录播 ->"}
    </Link>
  );
}
