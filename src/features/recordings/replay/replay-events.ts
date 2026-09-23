"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { ApiError, fetchLiveEvents } from "../api";
import type { LiveEvent } from "../types";
import { WINDOW_MS, toIso, windowBounds, windowIndexFor } from "./replay-windows";

/** 单页条数（上游契约上限 100）。 */
export const WINDOW_PAGE_SIZE = 100;

/** 单窗口最多翻页数（防御上游异常 total）。 */
export const MAX_WINDOW_PAGES = 20;

export interface FetchEventsParams {
  roomId: number;
  start: string;
  end: string;
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}

export type FetchEvents = (params: FetchEventsParams) => Promise<{
  total: number;
  items: LiveEvent[];
}>;

export interface ReplayEventsSnapshot {
  /** 已加载窗口合并去重、按 `occurredAt` 升序的事件。 */
  events: readonly LiveEvent[];
  loading: boolean;
  error: boolean;
  focusedWindow: number;
}

export interface ReplayEventsStore extends ReplayEventsSnapshot {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ReplayEventsSnapshot;
  /** 切换关注窗口（seek / 播放进入新窗时调用），过期请求 abort、代次 last-wins。 */
  focusWindow(index: number): void;
  /** 确保某窗口已加载（缓存命中跳过），不改动关注态。 */
  ensureWindow(index: number): Promise<boolean>;
  /** 播放进入窗口后半段时预取下一窗。 */
  prefetchNext(offsetMs: number): void;
  /** 当前及相邻窗口（去重升序）的事件。 */
  eventsFor(offsetMs: number): readonly LiveEvent[];
  /** 清空关注窗缓存并重拉。 */
  retry(): void;
  dispose(): void;
}

export interface CreateReplayEventsStoreOptions {
  /** 直播间 ID；null 时禁用取数。 */
  roomId: number | null;
  /** 分段实际起点毫秒（`segmentBoundsForFile` 推导）；null 时禁用取数。 */
  startMs: number | null;
  /** 分段实际终点毫秒；未知时以 start + 12h 为上界。 */
  endMs?: number | null;
  /** 依赖注入点（默认走 `fetchLiveEvents`）。 */
  fetchEvents?: FetchEvents;
}

interface Inflight {
  promise: Promise<boolean>;
  controller: AbortController;
}

/**
 * 时间窗口增量加载调度（技术方案 §3.2）：`Map` 缓存 + `AbortController` 竞态控制 +
 * 代次 last-wins + 窗口过半预取。以 store 形态实现便于单测，`useReplayEvents` 负责接线 React。
 */
export function createReplayEventsStore(options: CreateReplayEventsStoreOptions): ReplayEventsStore {
  const { roomId, startMs, endMs = null } = options;
  const fetchEvents = options.fetchEvents ?? ((params: FetchEventsParams) => fetchLiveEvents(params));

  const cache = new Map<string, LiveEvent[]>();
  const inflight = new Map<string, Inflight>();
  const listeners = new Set<() => void>();

  let generation = 0;
  let disposed = false;
  let events: readonly LiveEvent[] = Object.freeze([]);
  let loading = false;
  let error = false;
  let focusedWindow = 0;
  let snapshot: ReplayEventsSnapshot = { events, loading, error, focusedWindow };

  const notify = () => {
    snapshot = { events, loading, error, focusedWindow };
    for (const listener of listeners) listener();
  };

  const syncEvents = () => {
    const merged: LiveEvent[] = [];
    for (const list of cache.values()) merged.push(...list);
    const seen = new Set<string>();
    const deduped: LiveEvent[] = [];
    for (const event of merged) {
      if (seen.has(event.eventId)) continue;
      seen.add(event.eventId);
      deduped.push(event);
    }
    deduped.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
    events = Object.freeze(deduped);
  };

  const keyFor = (index: number): string | null => {
    if (roomId === null || startMs === null) return null;
    return `${roomId}:${windowBounds(index, startMs, endMs).startMs}`;
  };

  const loadWindow = (index: number): Promise<boolean> => {
    const key = keyFor(index);
    if (key === null || roomId === null || startMs === null) return Promise.resolve(false);
    const cached = cache.get(key);
    if (cached) {
      syncEvents();
      return Promise.resolve(true);
    }
    const existing = inflight.get(key);
    if (existing) return existing.promise;

    const { startMs: windowStart, endMs: windowEnd } = windowBounds(index, startMs, endMs);
    if (windowEnd <= windowStart) {
      cache.set(key, []);
      syncEvents();
      return Promise.resolve(true);
    }

    const controller = new AbortController();
    const promise = (async () => {
      try {
        const collected: LiveEvent[] = [];
        let page = 1;
        for (;;) {
          const response = await fetchEvents({
            roomId,
            start: toIso(windowStart),
            end: toIso(windowEnd),
            page,
            pageSize: WINDOW_PAGE_SIZE,
            signal: controller.signal,
          });
          if (controller.signal.aborted) return false;
          collected.push(...response.items);
          if (collected.length >= response.total || response.items.length === 0 || page >= MAX_WINDOW_PAGES) {
            break;
          }
          page += 1;
        }
        if (controller.signal.aborted) return false;
        cache.set(key, collected);
        if (!disposed) {
          syncEvents();
          notify();
        }
        return true;
      } catch (cause) {
        if (controller.signal.aborted) return false;
        if (cause instanceof ApiError && cause.kind === "network") return false;
        return false;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, { promise, controller });
    return promise;
  };

  const focusWindow = (index: number) => {
    if (roomId === null || startMs === null) return;
    const targetKey = keyFor(index);
    generation += 1;
    const current = generation;
    // 竞态控制：放弃所有非目标窗口的在途请求
    for (const [key, entry] of [...inflight]) {
      if (key === targetKey) continue;
      entry.controller.abort();
      inflight.delete(key);
    }
    focusedWindow = index;
    loading = true;
    error = false;
    notify();

    void loadWindow(index).then((ok) => {
      if (disposed || current !== generation) return;
      loading = false;
      if (!ok) error = true;
      syncEvents();
      notify();
    });
  };

  const ensureWindow = (index: number) => loadWindow(index);

  const prefetchNext = (offsetMs: number) => {
    if (roomId === null || startMs === null) return;
    if (!Number.isFinite(offsetMs) || offsetMs < 0) return;
    const index = windowIndexFor(offsetMs);
    if (offsetMs - index * WINDOW_MS >= WINDOW_MS / 2) void loadWindow(index + 1);
  };

  const eventsFor = (offsetMs: number): readonly LiveEvent[] => {
    if (!Number.isFinite(offsetMs)) return [];
    const index = windowIndexFor(offsetMs);
    const fromMs = Math.max(0, index - 1) * WINDOW_MS;
    const toMs = (index + 2) * WINDOW_MS;
    const result: LiveEvent[] = [];
    for (const event of events) {
      const offset = Date.parse(event.occurredAt) - (startMs ?? 0);
      if (offset >= fromMs && offset < toMs) result.push(event);
    }
    return result;
  };

  const retry = () => {
    const key = keyFor(focusedWindow);
    if (key !== null) cache.delete(key);
    generation += 1;
    focusWindow(focusedWindow);
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    focusWindow,
    ensureWindow,
    prefetchNext,
    eventsFor,
    retry,
    dispose() {
      disposed = true;
      for (const entry of inflight.values()) entry.controller.abort();
      inflight.clear();
      listeners.clear();
    },
    get cache() {
      return cache;
    },
  } as ReplayEventsStore & { cache: Map<string, LiveEvent[]> };
}

export interface ReplayEventsController extends ReplayEventsSnapshot {
  focusWindow(index: number): void;
  ensureWindow(index: number): Promise<boolean>;
  prefetchNext(offsetMs: number): void;
  eventsFor(offsetMs: number): readonly LiveEvent[];
  retry(): void;
}

/**
 * 弹幕窗口加载 React 绑定（提案 §4.2）：挂载即聚焦首窗，
 * `useSyncExternalStore` 消费 store 快照；roomId / 起点变化时重建 store。
 */
export function useReplayEvents(
  roomId: number | null,
  bounds: { startMs: number | null; endMs?: number | null },
  fetchEvents?: FetchEvents,
): ReplayEventsController {
  const startMs = bounds.startMs;
  const endMs = bounds.endMs ?? null;
  const store = useMemo(
    () => createReplayEventsStore({ roomId, startMs, endMs, fetchEvents }),
    [roomId, startMs, endMs, fetchEvents],
  );

  useEffect(() => {
    store.focusWindow(0);
    return () => store.dispose();
  }, [store]);

  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => store.subscribe(listener), [store]),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );

  return {
    ...snapshot,
    focusWindow: store.focusWindow,
    ensureWindow: store.ensureWindow,
    prefetchNext: store.prefetchNext,
    eventsFor: store.eventsFor,
    retry: store.retry,
  };
}
