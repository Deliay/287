import type { Metadata } from "next";
import { RecordingsView } from "@/features/recordings/recordings-view";

export const metadata: Metadata = {
  title: "录播 | 287 应援站",
  description: "四位成员的当前直播状态、在线收听与历史录播回看",
};

/**
 * 录播页（FR-1~FR-4）：静态导出的服务器组件壳，负责 metadata；
 * 客户端组装见 `RecordingsView`（首屏仅请求 recording-status）。
 */
export default function RecordingsPage() {
  return <RecordingsView />;
}
