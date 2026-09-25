"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { IconChevron } from "@/components/icons";
import { members, type Member } from "@/data/members";
import { fetchRoomRecordings, recordingReplayHref } from "./api";
import { setLastTitle } from "./last-title";
import type { RecordingFile, RecordingStatusItem } from "./types";
import { formatDateTime, formatDuration, formatFileSize } from "./format";
import { REVEAL_GROUP_EVENT, readRevealMemberId } from "./reveal-group";
import styles from "./recordings-section.module.css";

/**
 * `?member=` 值 → 合法成员 id；无效值（缺失/未知成员）返回 null，
 * 调用方按「全部收起」渲染且不报错（AC-7）。
 */
function toMemberId(value: string | null): Member["id"] | null {
  if (!value) return null;
  return members.find((member) => member.id === value)?.id ?? null;
}

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
  /** 展开态由父级 `expandedMemberId` 持有（受控，AC-5 至多一个分组展开）。 */
  expanded: boolean;
  /**
   * 请求父级置位/收起展开态——分组头点击、触发加载、状态卡片定位共用的
   * 单一状态出口（AC-5；该出口同时负责 URL 同步，AC-6）。
   */
  onSetExpanded: (memberId: Member["id"], expanded: boolean) => void;
  /**
   * 父级统一监听 `REVEAL_GROUP_EVENT` 后为该成员递增的序号：
   * 分组据此触发「失败态再次定位即重试」，无需各自监听事件（审核次要6）。
   */
  revealSeq?: number;
}

/** 单成员录播分组：折叠态不请求；仅点击分组头或状态卡片定位时触发加载（AC-4 · R14-1 点击前零请求）。 */
function MemberGroup({
  member,
  roomId,
  statusKind = "ok",
  expanded,
  onSetExpanded,
  revealSeq = 0,
}: MemberGroupProps) {
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
    // 展开态统一交父级持有（AC-5 单展开出口）；
    // 状态就绪补跑传 expand:false——静默加载，不得强制展开用户已收起的分组（审核 R15-3）
    if (options?.expand !== false) onSetExpanded(member.id, true);
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
  }, [roomId, statusKind, member.id, onSetExpanded]);

  // recording-status 就绪后补跑挂起的加载（审核次要9 / 次要5 错误态恢复）
  useEffect(() => {
    if (statusKind !== "ok") return;
    if (!requestedRef.current) return;
    if (state.kind !== "waiting" && state.kind !== "status-error") return;
    // 状态就绪/恢复时补跑挂起的加载（静默：用户显式收起优先，不改展开态；审核 R15-3）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load({ expand: false });
  }, [statusKind, state.kind, load]);

  /** 已消费的 reveal 序号：用于识别「是否由本次定位事件触发」 */
  const handledRevealRef = useRef(0);

  // 展开态由父级置位后补触发首取（分组头点击 / ?member= 带参直达共用，AC-6 · AC-7）：
  // 折叠或已有数据/在途时不取数（R14-1 点击前零请求 · R4 复用数据不重复取数）
  useEffect(() => {
    if (!expanded || state.kind !== "idle") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 首取由「展开态」驱动（分组头点击 / ?member= 带参直达共用），与既有「状态就绪补跑」同一取数通道
    void load({ expand: false });
  }, [expanded, state.kind, load]);

  // 状态卡片定位到「已失败」的分组即重试（审核次要6）：事件已由父级统一监听，
  // 此处只按序号认领本次事件，避免把 state.kind 直接做成依赖导致「失败 → 重试 → 再失败」自循环
  useEffect(() => {
    if (revealSeq === handledRevealRef.current) return;
    handledRevealRef.current = revealSeq;
    if (state.kind !== "error") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 由外部定位事件驱动的失败重试，与「状态就绪补跑」同一取数通道
    void load({ expand: false });
  }, [revealSeq, state.kind, load]);

  const toggle = () => {
    // 取数由上面的「展开态补触发首取」effect 接管，展开与加载职责分离
    onSetExpanded(member.id, !expanded);
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

interface RecordingsSectionProps {
  /** 录制状态（用于 mid → roomId 关联）；未返回的成员分组展示空态。 */
  items: RecordingStatusItem[];
  /** recording-status 就绪状态；未就绪时分组先显示等待态而非「暂无录播」（审核次要9）。 */
  statusKind?: StatusKind;
}

/**
 * 历史录播列表（FR-4 / 设计文档 §2.4）：按成员分组、默认收起且仅显式展开时加载
 * （R14-1 点击前零请求）、`startedAt` 倒序、每页 20 条分页；条目跳转站内回放页。
 *
 * 展开态上移为单一 `expandedMemberId`（PRD FR-3）：任一时刻至多一个分组展开，
 * 分组头点击 / 触发加载 / 状态卡片定位三条路径共用同一状态出口。
 */
export function RecordingsSection({ items, statusKind = "ok" }: RecordingsSectionProps) {
  const searchParams = useSearchParams();
  /** 当前展开的成员 id；null 为全部收起（AC-5 单展开）。初始化只读一次 `?member=`（AC-7） */
  const [expandedMemberId, setExpandedMemberId] = useState<Member["id"] | null>(() =>
    toMemberId(searchParams.get("member")),
  );
  /** `REVEAL_GROUP_EVENT` 触发序号（按成员）：通知对应分组取数/失败重试 */
  const [revealSeq, setRevealSeq] = useState<Record<string, number>>({});

  /** 统一状态出口：置位/收起展开态（收起仅当目标就是当前展开项，避免误伤） */
  const handleSetExpanded = useCallback((memberId: Member["id"], expanded: boolean) => {
    setExpandedMemberId((current) => {
      if (expanded) return memberId;
      return current === memberId ? null : current;
    });
  }, []);

  // 带参直达（AC-7）：挂载时把目标分组滚入视口（能力判断同 live-status-grid 的 reveal 定位）
  const initialScrollRef = useRef(false);
  useEffect(() => {
    if (initialScrollRef.current) return;
    initialScrollRef.current = true;
    if (!expandedMemberId) return;
    const el = document.getElementById(`recordings-group-${expandedMemberId}`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [expandedMemberId]);

  // 展开态 → URL（AC-6）：`history.replaceState` 写删 `?member=`，
  // 全程无刷新、不产生历史记录项；挂载时只读不写（保留带参直达的原始 URL）
  const prevExpandedRef = useRef<Member["id"] | null | undefined>(undefined);
  useEffect(() => {
    const previous = prevExpandedRef.current;
    prevExpandedRef.current = expandedMemberId;
    if (previous === undefined || previous === expandedMemberId) return;
    const url = new URL(window.location.href);
    if (expandedMemberId) url.searchParams.set("member", expandedMemberId);
    else url.searchParams.delete("member");
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [expandedMemberId]);

  // 状态卡片定位（设计 §2.3）：监听上移至父级——展开态与 URL 同步走同一出口，
  // 分组头点击 / 卡片定位 / ?member= 带参直达三条路径共用同一状态出口
  useEffect(() => {
    const onReveal = (event: Event) => {
      const memberId = toMemberId(readRevealMemberId(event));
      if (!memberId) return;
      handleSetExpanded(memberId, true);
      setRevealSeq((current) => ({
        ...current,
        [memberId]: (current[memberId] ?? 0) + 1,
      }));
    };
    window.addEventListener(REVEAL_GROUP_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_GROUP_EVENT, onReveal);
  }, [handleSetExpanded]);

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
              expanded={expandedMemberId === member.id}
              onSetExpanded={handleSetExpanded}
              revealSeq={revealSeq[member.id] ?? 0}
            />
          );
        })}
      </div>
    </section>
  );
}
