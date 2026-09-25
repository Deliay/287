"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconChevron, IconDownload, IconPlay } from "@/components/icons";
import { members, type Member } from "@/data/members";
import { fetchRoomRecordings, recordingFileUrl, recordingReplayHref } from "./api";
import { setLastTitle } from "./last-title";
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
  /** recording-status 请求失败：给出错误态而非一直等待（审核次要5） */
  | { kind: "status-error" }
  | { kind: "loading" }
  | { kind: "ok"; files: RecordingFile[] }
  | { kind: "error" };

/** recording-status 数据就绪状态（由页面注入，缺省视为就绪）。 */
export type StatusKind = "loading" | "error" | "ok";

/** 按 `startedAt`（缺失/空串回退 `createdAt`）倒序。 */
export function sortRecordings(files: RecordingFile[]): RecordingFile[] {
  return [...files].sort((a, b) => sortKey(b) - sortKey(a));
}

function recordingTitle(file: RecordingFile): string {
  return file.info?.title?.trim() || file.name;
}

/** 排序键：优先 `info.startedAt`，缺失/空串回退 `createdAt`（审核次要6）。 */
function sortKey(file: RecordingFile): number {
  const fromInfo = Date.parse(file.info?.startedAt ?? "");
  if (Number.isFinite(fromInfo)) return fromInfo;
  const fromCreated = Date.parse(file.createdAt);
  return Number.isFinite(fromCreated) ? fromCreated : 0;
}

interface MemberGroupProps {
  member: Member;
  roomId: number | undefined;
  /** recording-status 就绪状态；未就绪时分组进入「等待状态」而非空态（审核次要9）。 */
  statusKind?: StatusKind;
}

/** 单成员录播分组：折叠态不请求；仅点击分组头或状态卡片定位时触发加载（AC-4 · R14-1 点击前零请求）。 */
function MemberGroup({ member, roomId, statusKind = "ok" }: MemberGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<GroupState>({ kind: "idle" });
  const [page, setPage] = useState(1);
  /** 本组数据实际来源的房间号：轮询导致 roomId 漂移时链接仍指向数据来源房间（审核次要6） */
  const [loadedRoomId, setLoadedRoomId] = useState<number | undefined>(undefined);
  /** 是否已请求过加载（状态未就绪时先挂起，就绪后补跑） */
  const requestedRef = useRef(false);
  /** 是否已有数据/空态（有则不再取数，审核次要6） */
  const loadedRef = useRef(false);
  /** 在途去重：连点/定位与补跑 effect 双触发只取一次（审核次要6 · R14-1 后无视口触发面） */
  const inflightRef = useRef(false);

  const load = useCallback(async (options?: { expand?: boolean }) => {
    requestedRef.current = true;
    // 触发加载即视为展开：点击/定位触发后 aria-expanded / 箭头与内容保持一致（审核次要9 · R14-1）；
    // 状态就绪补跑传 expand:false——静默加载，不得强制展开用户已收起的分组（审核 R15-3）
    if (options?.expand !== false) setExpanded(true);
    if (loadedRef.current) return;
    if (inflightRef.current) return;
    setPage(1);
    if (statusKind === "error") {
      setState({ kind: "status-error" });
      return;
    }
    if (statusKind !== "ok") {
      setState({ kind: "waiting" });
      return;
    }
    if (roomId === undefined) {
      // 接口已就绪但未返回该成员：分组展示空态（技术方案 §4.3）
      loadedRef.current = true;
      setLoadedRoomId(undefined);
      setState({ kind: "ok", files: [] });
      return;
    }
    inflightRef.current = true;
    setState({ kind: "loading" });
    try {
      const response = await fetchRoomRecordings(roomId);
      const files = sortRecordings(response.files);
      loadedRef.current = true;
      setLoadedRoomId(roomId);
      setState({ kind: "ok", files });
      // 未开播标题降级链②（PRD FR-2 · R14-2）：最新一场非空 info.title 写入模块级缓存（不新增请求）
      setLastTitle(member.id, files.find((file) => file.info?.title?.trim())?.info?.title);
    } catch {
      setState({ kind: "error" });
    } finally {
      inflightRef.current = false;
    }
  }, [roomId, statusKind, member.id]);

  // recording-status 就绪后补跑挂起的加载（审核次要9 / 次要5 错误态恢复）
  useEffect(() => {
    if (statusKind !== "ok") return;
    if (!requestedRef.current) return;
    if (state.kind !== "waiting" && state.kind !== "status-error") return;
    // 状态就绪/恢复时补跑挂起的加载（静默：用户显式收起优先，不改展开态；审核 R15-3）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load({ expand: false });
  }, [statusKind, state.kind, load]);

  // 状态卡片点击定位（设计 §2.3）：展开并加载对应分组；失败态再次定位即重试（审核次要6）
  useEffect(() => {
    const onReveal = (event: Event) => {
      if (readRevealMemberId(event) !== member.id) return;
      setExpanded(true);
      if (state.kind === "idle" || state.kind === "error") void load();
    };
    window.addEventListener(REVEAL_GROUP_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_GROUP_EVENT, onReveal);
  }, [member.id, state.kind, load]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && state.kind === "idle") void load();
  };

  const files = state.kind === "ok" ? state.files : [];
  const pageCount = Math.max(1, Math.ceil(files.length / PAGE_SIZE));
  const pageFiles = files.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // 收起即隐藏内容（数据保留在 state，再展开不重新取数）；ARIA/箭头与可见性保持一致（审核 R4）
  const showContent = expanded;

  return (
    <div className={styles.group} id={`recordings-group-${member.id}`} data-testid={`recordings-group-${member.id}`}>
      <button
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
            <IconChevron direction={expanded ? "up" : "down"} />
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

          {state.kind === "status-error" && (
            <p className={styles.empty} role="alert">
              直播状态获取失败，录播分组暂不可用。
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
                {pageFiles.map((file) => {
                  // 链接房间号取「数据来源房间」，避免轮询 roomId 漂移后链接指向新房间（审核次要6）
                  const linkRoomId = loadedRoomId ?? roomId;
                  const durationText = formatDuration(file.info?.startedAt, file.info?.endedAt);
                  return (
                    <li key={file.name} className={styles.item} data-testid="recording-item">
                      <div className={styles.itemRow}>
                        <Link
                          href={
                            linkRoomId === undefined
                              ? "#"
                              : recordingReplayHref(linkRoomId, file.name)
                          }
                          className={styles.itemLink}
                        >
                          <span className={styles.itemTitle} data-testid="recording-title">
                            {recordingTitle(file)}
                          </span>
                          <span className={styles.itemMeta}>
                            {formatDateTime(file.info?.startedAt ?? file.createdAt)}
                            {durationText ? ` · ${durationText}` : ""}
                            {file.size > 0 ? ` · ${formatFileSize(file.size)}` : ""}
                          </span>
                        </Link>
                        {/* 右侧按钮组：房间号取数据来源房间（同条目链接，审核次要6） */}
                        {linkRoomId !== undefined && (
                          <RecordingActions roomId={linkRoomId} fileName={file.name} />
                        )}
                      </div>
                    </li>
                  );
                })}
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

/**
 * 条目右侧按钮组（FR-2 · 设计 §2.5）：主按钮「播放」跳站内回放页（与条目本体同址），
 * 箭头按钮切换下拉菜单（含「下载」直链）。下拉本地 state 开合，点击外部 / Esc 关闭
 * （简单焦点管理，不引库）。
 */
function RecordingActions({ roomId, fileName }: { roomId: number; fileName: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  /** 下拉开关：Esc 收起后焦点归还于此（设计 §3 可键盘操作）。 */
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.actions} ref={rootRef} data-testid="recording-actions">
      <Link
        href={recordingReplayHref(roomId, fileName)}
        className={styles.playButton}
        aria-label="播放"
      >
        <IconPlay />
        <span className={styles.playLabel}>播放</span>
      </Link>
      <div className={styles.menuWrap}>
        <button
          type="button"
          ref={toggleRef}
          className={styles.menuToggle}
          aria-label="更多操作"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <IconChevron direction={open ? "up" : "down"} />
        </button>
        {open && (
          <div className={styles.menu}>
            <a
              href={recordingFileUrl(roomId, fileName)}
              download={fileName}
              className={styles.menuItem}
            >
              <IconDownload />
              <span>下载</span>
            </a>
          </div>
        )}
      </div>
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
 * 历史录播列表（FR-4 / 设计文档 §2.4）：按成员分组、默认收起且仅显式展开时加载
 * （R14-1 点击前零请求）、`startedAt` 倒序、每页 20 条分页；条目跳转站内回放页。
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
