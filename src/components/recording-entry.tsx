import Link from "next/link";
import type { Member } from "@/data/members";
import styles from "./recording-entry.module.css";

export interface RecordingEntryProps {
  member: Member;
}

/**
 * 未开播录播入口（PRD FR-4 · 返工 R1）：`LiveBadge` 未开播态的**替换**节点，
 * 在详情区与「未开播」纯文本同一位置二选一、不并列展示。
 *
 * 纯展示节点——直播状态由 `LiveBadge`（详情区单一状态出口）统一读取，
 * 本组件不订阅状态，避免同一位置出现双行与重复订阅；因此也不存在额外请求（PRD §5）。
 * 文案右箭头「→」（U+2192），`href` 与录播页 FR-3 的 `?member=` 约定一致（AC-8）。
 */
export function RecordingEntry({ member }: RecordingEntryProps) {
  return (
    <Link className={styles.entry} href={`/recordings?member=${member.id}`}>
      {"未开播，看录播 →"}
    </Link>
  );
}
