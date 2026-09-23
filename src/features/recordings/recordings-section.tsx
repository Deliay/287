"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { members, type Member } from "@/data/members";
import { fetchRoomRecordings, recordingReplayHref } from "./api";
import type { RecordingFile, RecordingStatusItem } from "./types";
import { formatDateTime, formatDuration, formatFileSize } from "./format";
import { REVEAL_GROUP_EVENT, readRevealMemberId } from "./reveal-group";
import styles from "./recordings-section.module.css";

/** 每页条数（FR-4：20）。 */
export const PAGE_SIZE = 20;

type GroupState =
  | { kind: "idle" }
  /** 已请求但 recording-status 尚未就绪（等待状态数据，避免误判空态，审核次要9） */
  | { kind: "waiting" }
  | { kind: "loading" }
  | { kind: "ok"; files: RecordingFile[] }
  | { kind: "error" };

/** recording-status 数据就绪状态（由页面注入，缺省视为就绪）。 */
export type StatusKind = "loading" | "error" | "ok";

/** 按 `startedAt`（缺失回退 `createdAt`）倒序。 */
export function sortRecordings(files: RecordingFile[]): RecordingFile[] {
  return [...files].sort((a, b) => {
    const left = Date.parse(a.info?.startedAt ?? a.createdAt);
    const right = Date.parse(b.info?.startedAt ?? b.createdAt);
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });
}

function recordingTitle(file: RecordingFile): string {
  return file.info?.title?.trim() || file.name;
}

interface MemberGroupProps {
  member: Member;
  roomId: number | undefined;
  /** recording-status 就绪状态；未就绪时分组进入「等待状态」而非空态（审核次要9）。 */
  statusKind?: StatusKind;
}

/** 单成员录播分组：折叠态不请求；进入视口、首次展开或状态卡片定位时触发加载（AC-4）。 */
function MemberGroup({ member, roomId, statusKind = "ok" }: MemberGroupProps) {
  const headerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<GroupState>({ kind: "idle" });
  const [page, setPage] = useState(1);
  /** 是否已请求过加载（状态未就绪时先挂起，就绪后补跑） */
  const requestedRef = useRef(false);

  const load = useCallback(async () => {
    requestedRef.current = true;
    // 触发加载即视为展开：视口触发后 aria-expanded / 箭头与内容保持一致（审核次要9）
    setExpanded(true);
    setPage(1);
    if (statusKind !== "ok") {
      setState({ kind: "waiting" });
      return;
    }
    if (roomId === undefined) {
      // 接口已就绪但未返回该成员：分组展示空态（技术方案 §4.3）
      setState({ kind: "ok", files: [] });
      return;
    }
    setState({ kind: "loading" });
    try {
      const response = await fetchRoomRecordings(roomId);
      setState({ kind: "ok", files: sortRecordings(response.files) });
    } catch {
      setState({ kind: "error" });
    }
  }, [roomId, statusKind]);

  // recording-status 就绪后补跑挂起的加载（审核次要9）
  useEffect(() => {
    if (statusKind !== "ok") return;
    if (!requestedRef.current || state.kind !== "waiting") return;
    void load();
  }, [statusKind, state.kind, load]);

  // 状态卡片点击定位（设计 §2.3）：展开并加载对应分组（审核次要6）
  useEffect(() => {
    const onReveal = (event: Event) => {
      if (readRevealMemberId(event) !== member.id) return;
      setExpanded(true);
      if (state.kind === "idle") void load();
    };
    window.addEventListener(REVEAL_GROUP_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_GROUP_EVENT, onReveal);
  }, [member.id, state.kind, load]);

  // 进入视口（含 rootMargin 预取）即加载；断开观察避免重复触发
  useEffect(() => {
    const target = headerRef.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void load();
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [load]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && state.kind === "idle") void load();
  };

  const files = state.kind === "ok" ? state.files : [];
  const pageCount = Math.max(1, Math.ceil(files.length / PAGE_SIZE));
  const pageFiles = files.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showContent = expanded || state.kind !== "idle";

  return (
    <div className={styles.group} id={`recordings-group-${member.id}`} data-testid={`recordings-group-${member.id}`}>
      <button
        ref={headerRef}
        type="button"
        className={styles.groupHeader}
        aria-expanded={expanded}
        onClick={toggle}
      >
        <span className={styles.groupTitle}>
          <span
            className={styles.swatch}
            style={{ backgroundColor: `var(--mantine-color-${member.colorKey}-6)` }}
            aria-hidden="true"
          />
          {member.name}
        </span>
        <span className={styles.groupMeta}>
          {state.kind === "ok" && files.length > 0 ? `${files.length} 场` : ""}
          <span className={styles.chevron} aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
        </span>
      </button>

      {showContent && (
        <div className={styles.groupBody}>
          {state.kind === "waiting" && (
            <p className={styles.empty} role="status">
              等待直播状态加载…
            </p>
          )}

          {state.kind === "loading" && (
            <div role="status" aria-label="加载中" className={styles.skeletons}>
              <span className={styles.skeleton} />
              <span className={styles.skeleton} />
              <span className={styles.skeleton} />
            </div>
          )}

          {state.kind === "error" && (
            <div className={styles.error}>
              <span>录播列表加载失败。</span>
              <button type="button" className={styles.retry} onClick={() => void load()}>
                重试
              </button>
            </div>
          )}

          {state.kind === "ok" && files.length === 0 && (
            <p className={styles.empty}>暂无录播</p>
          )}

          {state.kind === "ok" && files.length > 0 && (
            <>
              <ul className={styles.list} data-testid={`recordings-${member.id}-list`}>
                {pageFiles.map((file) => (
                  <li key={file.name} className={styles.item} data-testid="recording-item">
                    <Link
                      href={recordingReplayHref(roomId as number, file.name)}
                      className={styles.itemLink}
                    >
                      <span className={styles.itemTitle} data-testid="recording-title">
                        {recordingTitle(file)}
                      </span>
                      <span className={styles.itemMeta}>
                        {formatDateTime(file.info?.startedAt ?? file.createdAt)}
                        {formatDuration(file.info?.startedAt, file.info?.endedAt)
                          ? ` · ${formatDuration(file.info?.startedAt, file.info?.endedAt)}`
                          : ""}
                        {file.size > 0 ? ` · ${formatFileSize(file.size)}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              {pageCount > 1 && (
                <div className={styles.pagination}>
                  <button
                    type="button"
                    className={styles.pageButton}
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    上一页
                  </button>
                  <span className={styles.pageInfo}>
                    第 {page} / {pageCount} 页
                  </span>
                  <button
                    type="button"
                    className={styles.pageButton}
                    disabled={page >= pageCount}
                    onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface RecordingsSectionProps {
  /** 录制状态（用于 mid → roomId 关联）；未返回的成员分组展示空态。 */
  items: RecordingStatusItem[];
  /** recording-status 就绪状态；未就绪时分组先显示等待态而非「暂无录播」（审核次要9）。 */
  statusKind?: StatusKind;
}

/**
 * 历史录播列表（FR-4 / 设计文档 §2.4）：按成员分组、进入视口后加载、
 * `startedAt` 倒序、每页 20 条分页；条目跳转站内回放页。
 */
export function RecordingsSection({ items, statusKind = "ok" }: RecordingsSectionProps) {
  return (
    <section aria-labelledby="recordings-section-heading" className={styles.section}>
      <h2 id="recordings-section-heading" className={styles.heading}>
        历史录播
      </h2>
      <div className={styles.groups}>
        {members.map((member) => {
          const item = items.find((candidate) => candidate.mid === member.mid);
          return (
            <MemberGroup
              key={member.id}
              member={member}
              roomId={item?.roomId ?? member.roomId}
              statusKind={statusKind}
            />
          );
        })}
      </div>
    </section>
  );
}
