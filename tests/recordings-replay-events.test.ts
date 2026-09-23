import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveEvent } from "@/features/recordings/types";
import {
  WINDOW_PAGE_SIZE,
  createReplayEventsStore,
  type FetchEvents,
} from "@/features/recordings/replay/replay-events";

const START_MS = Date.parse("2026-09-23T20:00:00.000Z");

function makeEvent(id: string, occurredAt: string): LiveEvent {
  return {
    eventId: id,
    type: "danmaku",
    occurredAt,
    sender: { uid: 1, name: "观众", face: "", medal: null, guardLevel: null },
    content: id,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

interface CapturedCall {
  roomId: number;
  start: string;
  end: string;
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}

function captureFetch(handler: (call: CapturedCall, index: number) => Promise<Response> | Response) {
  const calls: CapturedCall[] = [];
  const fetchEvents: FetchEvents = (params) => {
    const call: CapturedCall = { ...params };
    calls.push(call);
    return Promise.resolve(handler(call, calls.length - 1)).then(
      (response) => response.json() as Promise<never>,
    );
  };
  return { calls, fetchEvents };
}

async function flush(times = 60): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("弹幕窗口增量加载 replay-events（T10 / AC-7）", () => {
  it("聚焦窗口 0 请求 [start, start+10min)；重复聚焦命中缓存不重复请求", async () => {
    const { calls, fetchEvents } = captureFetch(() =>
      jsonResponse({ total: 1, page: 1, pageSize: 100, items: [makeEvent("e1", "2026-09-23T20:01:00.000Z")] }),
    );
    const store = createReplayEventsStore({ roomId: 7, startMs: START_MS, fetchEvents });

    store.focusWindow(0);
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.start).toBe("2026-09-23T20:00:00.000Z");
    expect(calls[0]?.end).toBe("2026-09-23T20:10:00.000Z");
    expect(calls[0]?.roomId).toBe(7);
    expect(store.getSnapshot().loading).toBe(false);
    expect(store.getSnapshot().error).toBe(false);

    store.focusWindow(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(1); // 缓存命中
    store.dispose();
  });

  it("单窗口 total > 100 时自动翻页拉全", async () => {
    const { calls, fetchEvents } = captureFetch((call) => {
      const offset = (call.page - 1) * 100;
      const count = Math.max(0, Math.min(100, 250 - offset));
      const items = Array.from({ length: count }, (_, index) =>
        makeEvent(`p${call.page}-${index}`, new Date(START_MS + call.page * 1000 + index).toISOString()),
      );
      return jsonResponse({ total: 250, page: call.page, pageSize: WINDOW_PAGE_SIZE, items });
    });
    const store = createReplayEventsStore({ roomId: 7, startMs: START_MS, fetchEvents });

    store.focusWindow(0);
    await flush();

    expect(calls.map((call) => call.page)).toEqual([1, 2, 3]);
    expect(store.getSnapshot().events).toHaveLength(250);
    store.dispose();
  });

  it("播放过窗口中点时预取下一窗口", async () => {
    const { calls, fetchEvents } = captureFetch(() =>
      jsonResponse({ total: 0, page: 1, pageSize: 100, items: [] }),
    );
    const store = createReplayEventsStore({ roomId: 7, startMs: START_MS, fetchEvents });

    store.focusWindow(0);
    await flush();
    expect(calls).toHaveLength(1);

    store.prefetchNext(200_000); // 未过中点（300_000）
    await flush();
    expect(calls).toHaveLength(1);

    store.prefetchNext(400_000); // 已过中点 → 预取窗口 1
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.start).toBe("2026-09-23T20:10:00.000Z");
    store.dispose();
  });

  it("快速 seek 连发：旧请求被 abort，仅最新窗口生效", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const calls: CapturedCall[] = [];
    const fetchEvents: FetchEvents = (params) => {
      const call: CapturedCall = { ...params };
      calls.push(call);
      return new Promise<Response>((resolve) => {
        resolvers.push(resolve);
      }).then((response) => response.json() as Promise<never>);
    };
    const store = createReplayEventsStore({ roomId: 7, startMs: START_MS, fetchEvents });

    store.focusWindow(0);
    store.focusWindow(3);
    store.focusWindow(5);

    expect(calls).toHaveLength(3);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(calls[1]?.signal?.aborted).toBe(true);
    expect(calls[2]?.signal?.aborted).toBe(false);
    expect(store.getSnapshot().focusedWindow).toBe(5);

    // 过期响应即便晚到也不影响当前状态
    resolvers[0]?.(jsonResponse({ total: 0, page: 1, pageSize: 100, items: [] }));
    resolvers[2]?.(jsonResponse({ total: 1, page: 1, pageSize: 100, items: [makeEvent("late", "2026-09-23T20:50:00.000Z")] }));
    await flush();

    expect(store.getSnapshot().loading).toBe(false);
    expect(store.getSnapshot().error).toBe(false);
    expect(store.getSnapshot().events.map((event) => event.eventId)).toEqual(["late"]);
    store.dispose();
  });

  it("eventsFor 返回当前及相邻窗口的去重升序事件", async () => {
    const { fetchEvents } = captureFetch(() =>
      jsonResponse({
        total: 0,
        page: 1,
        pageSize: 100,
        items: [],
      }),
    );
    const store = createReplayEventsStore({ roomId: 7, startMs: START_MS, fetchEvents });

    // 直接注入缓存：窗口 0/1 各若干条 + 一条跨窗重复
    const seed = store as unknown as { cache: Map<string, LiveEvent[]> };
    seed.cache.set(`${7}:${START_MS}`, [
      makeEvent("b", "2026-09-23T20:05:00.000Z"),
      makeEvent("a", "2026-09-23T20:01:00.000Z"),
      makeEvent("dup", "2026-09-23T20:09:00.000Z"),
    ]);
    seed.cache.set(`${7}:${START_MS + 600_000}`, [
      makeEvent("dup", "2026-09-23T20:09:00.000Z"),
      makeEvent("c", "2026-09-23T20:15:00.000Z"),
    ]);
    store.focusWindow(0);
    await flush();

    const window0 = store.eventsFor(60_000);
    expect(window0.map((event) => event.eventId)).toEqual(["a", "b", "dup", "c"]);
    // 相邻窗口（0 与 1）之外的事件不返回
    expect(store.eventsFor(1_800_000)).toHaveLength(0);

    // 升序 + 去重由快照保证
    const offsets = store.getSnapshot().events.map((event) => Date.parse(event.occurredAt));
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    store.dispose();
  });

  it("请求失败置 error 并可 retry 重拉", async () => {
    let fail = true;
    const { calls, fetchEvents } = captureFetch(() => {
      if (fail) return new Response("boom", { status: 500 });
      return jsonResponse({ total: 0, page: 1, pageSize: 100, items: [] });
    });
    const store = createReplayEventsStore({ roomId: 7, startMs: START_MS, fetchEvents });

    store.focusWindow(0);
    await flush();
    expect(store.getSnapshot().error).toBe(true);
    expect(store.getSnapshot().loading).toBe(false);

    fail = false;
    store.retry();
    await flush();
    expect(store.getSnapshot().error).toBe(false);
    expect(calls).toHaveLength(2);
    store.dispose();
  });

  it("次要3 total 缺失/0 时不提前 break：按页拉全到不足一页为止", async () => {
    const pages: Record<number, number> = { 1: 100, 2: 30, 3: 0 };
    const calls: number[] = [];
    const fetchEvents: FetchEvents = async (params) => {
      calls.push(params.page);
      const count = pages[params.page] ?? 0;
      return {
        total: 0, // 上游未回 total（或为 0）
        items: Array.from({ length: count }, (_, index) =>
          makeEvent(`p${params.page}-${index}`, new Date(START_MS + params.page * 1000 + index).toISOString()),
        ),
      };
    };
    const store = createReplayEventsStore({ roomId: 7, startMs: START_MS, fetchEvents });
    store.focusWindow(0);
    await flush();

    expect(calls).toEqual([1, 2]);
    expect(store.getSnapshot().events).toHaveLength(130);
    expect(store.getSnapshot().error).toBe(false);
    store.dispose();
  });

  it("次要3 触及 MAX_WINDOW_PAGES 上限时置 error（不静默截断）", async () => {
    const fetchEvents: FetchEvents = async () => ({
      total: 1_000_000,
      items: Array.from({ length: WINDOW_PAGE_SIZE }, (_, index) =>
        makeEvent(`bulk-${index}`, new Date(START_MS + index).toISOString()),
      ),
    });
    const store = createReplayEventsStore({ roomId: 7, startMs: START_MS, fetchEvents });
    store.focusWindow(0);
    await flush();

    expect(store.getSnapshot().error).toBe(true);
    store.dispose();
  });

  it("次要3 inflight 归属比对：被取代的旧请求不误删新请求的在途记录", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    let fetchCount = 0;
    const fetchEvents: FetchEvents = () => {
      fetchCount += 1;
      return new Promise((resolve) => {
        resolvers.push(resolve);
      }).then(() => ({ total: 0, items: [] as ReturnType<typeof makeEvent>[] }));
    };
    const store = createReplayEventsStore({ roomId: 7, startMs: START_MS, fetchEvents });

    store.focusWindow(0); // 窗口0 在途（A）
    await flush();
    store.focusWindow(1); // 取代 → 中止 A
    await flush();
    store.focusWindow(0); // 窗口0 新请求（B）在途
    await flush();
    expect(fetchCount).toBe(3);

    resolvers[0]?.({}); // A 迟到返回 → 其 finally 不得删掉 B 的在途记录
    await flush();

    const before = fetchCount;
    void store.ensureWindow(0); // B 仍在途 → 不应重复取数（不 await：B 尚未完成）
    expect(fetchCount).toBe(before);
    store.dispose();
  });

  it("次要3 startMs 非法（NaN）时不取数也不置 error", async () => {
    const spy = vi.fn(() => Promise.resolve({ total: 0, items: [] as ReturnType<typeof makeEvent>[] }));
    const store = createReplayEventsStore({ roomId: 7, startMs: Number.NaN, fetchEvents: spy });

    store.focusWindow(0);
    store.prefetchNext(1_000);
    await flush();

    expect(spy).not.toHaveBeenCalled();
    expect(store.getSnapshot().loading).toBe(false);
    expect(store.getSnapshot().error).toBe(false);
    store.dispose();
  });
});
