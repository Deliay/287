import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  fetchLiveEvents,
  fetchRecordingStatus,
  fetchRoomRecordings,
  liveAudioUrl,
  recordingFileUrl,
  recordingReplayHref,
} from "@/features/recordings/api";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const statusSample = {
  items: [
    {
      mid: 1891335475,
      roomId: 1727071052,
      state: "recording",
      sessionTitle: "重生之我是钓鱼大师",
      files: ["[RAW][1727071052][小松绿Viridis]2026-09-23-20-58-38-重生之我是钓鱼大师.flv"],
      updatedAt: "2026-09-23T14:58:15.876Z",
      streamer: { name: "小松绿Viridis" },
    },
    {
      mid: 2138961136,
      roomId: 1727074031,
      state: "not_live",
      sessionTitle: null,
      files: [],
      updatedAt: "2026-09-23T14:57:41.605Z",
      streamer: { name: "羽啾chu2u" },
    },
  ],
};

const recordingsSample = {
  files: [
    {
      name: "[RAW][1727071052][小松绿Viridis]2026-09-23-20-58-38-重生之我是钓鱼大师.flv",
      size: 9663676416,
      createdAt: "2026-09-23T23:00:00.000Z",
      info: {
        recordingId: "rec-1",
        title: "重生之我是钓鱼大师",
        mid: 1891335475,
        startedAt: "2026-09-23T20:58:38.000Z",
        endedAt: "2026-09-23T23:00:00.000Z",
      },
    },
    { name: "no-info.flv", size: 1024, createdAt: "2026-09-23T19:00:00.000Z" },
  ],
};

const liveEventsSample = {
  total: 2,
  page: 1,
  pageSize: 100,
  items: [
    {
      eventId: "e1",
      type: "danmaku",
      occurredAt: "2026-09-23T21:00:01.000Z",
      sender: {
        uid: 1,
        name: "观众甲",
        face: "https://example.invalid/face.png",
        medal: { name: "287", level: 3, color: "#8eb056" },
        guardLevel: null,
      },
      content: "好听",
      emote: { url: "https://example.invalid/e.png", name: "耶", width: 44, height: 44 },
    },
    {
      eventId: "e2",
      type: "super_chat",
      occurredAt: "2026-09-23T21:00:05.000Z",
      sender: { uid: 2, name: "观众乙", face: "", medal: null, guardLevel: null },
      content: "加油",
      price: 30,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("录播 API 封装 types/api（T1）", () => {
  it("fetchRecordingStatus 解析实测样例，字段逐项正确", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(statusSample));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRecordingStatus();
    expect(result.items).toHaveLength(2);
    const [first, second] = result.items;
    expect(first).toEqual({
      mid: 1891335475,
      roomId: 1727071052,
      state: "recording",
      sessionTitle: "重生之我是钓鱼大师",
      files: ["[RAW][1727071052][小松绿Viridis]2026-09-23-20-58-38-重生之我是钓鱼大师.flv"],
      updatedAt: "2026-09-23T14:58:15.876Z",
      streamer: { name: "小松绿Viridis" },
    });
    expect(second?.state).toBe("not_live");
    expect(second?.sessionTitle).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://recordings.vtuber.fffdan.com/api/b/live/recording-status",
    );
  });

  it("fetchRoomRecordings 解析实测样例，info 可缺省", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(recordingsSample));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRoomRecordings(1727071052);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://recordings.vtuber.fffdan.com/api/b/live/1727071052/recordings",
    );
    expect(result.files).toHaveLength(2);
    const [withInfo, withoutInfo] = result.files;
    expect(withInfo?.info).toEqual({
      recordingId: "rec-1",
      title: "重生之我是钓鱼大师",
      mid: 1891335475,
      startedAt: "2026-09-23T20:58:38.000Z",
      endedAt: "2026-09-23T23:00:00.000Z",
    });
    expect(withInfo?.size).toBe(9663676416);
    expect(withoutInfo?.info).toBeUndefined();
  });

  it("fetchLiveEvents 解析实测样例，类型与 sender 字段齐全", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(liveEventsSample));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLiveEvents({
      roomId: 1727071052,
      start: "2026-09-23T06:59:19.336Z",
      end: "2026-09-23T07:09:19.336Z",
      page: 1,
      pageSize: 100,
    });
    expect(result.total).toBe(2);
    expect(result.items[0]?.sender.medal).toEqual({ name: "287", level: 3, color: "#8eb056" });
    expect(result.items[0]?.emote?.name).toBe("耶");
    expect(result.items[1]?.type).toBe("super_chat");
    expect(result.items[1]?.price).toBe(30);
  });

  it("结构不符（缺 items / files / items）抛 ApiError 而非静默通过", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ unexpected: [] })),
    );
    await expect(fetchRecordingStatus()).rejects.toBeInstanceOf(ApiError);
    await expect(fetchRoomRecordings(1)).rejects.toBeInstanceOf(ApiError);
    await expect(
      fetchLiveEvents({ roomId: 1, start: "a", end: "b", page: 1, pageSize: 100 }),
    ).rejects.toBeInstanceOf(ApiError);

    // 顶层 items 存在但字段整体不合法（非对象数组元素）→ 仍属结构错误
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ items: "oops" })),
    );
    await expect(fetchRecordingStatus()).rejects.toMatchObject({ kind: "structure" });
  });

  it("非 2xx 与 fetch reject 均归一化为 ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(fetchRecordingStatus()).rejects.toMatchObject({ kind: "http", status: 500 });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(fetchRoomRecordings(3)).rejects.toMatchObject({ kind: "network" });
    await expect(fetchRoomRecordings(3)).rejects.toBeInstanceOf(ApiError);
  });

  it("弹幕请求 URL 正确拼接 roomId/start/end/page/pageSize query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(liveEventsSample));
    vi.stubGlobal("fetch", fetchMock);

    await fetchLiveEvents({
      roomId: 1727071052,
      start: "2026-09-23T06:59:19.336Z",
      end: "2026-09-23T07:09:19.336Z",
      page: 3,
      pageSize: 100,
    });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(`${url.origin}${url.pathname}`).toBe("https://api.sumire.live/api/live-events/replay");
    expect(url.searchParams.get("roomId")).toBe("1727071052");
    expect(url.searchParams.get("start")).toBe("2026-09-23T06:59:19.336Z");
    expect(url.searchParams.get("end")).toBe("2026-09-23T07:09:19.336Z");
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("pageSize")).toBe("100");
  });

  it("流地址与回放页站内地址拼接正确（文件名编码）", () => {
    expect(liveAudioUrl(1727071052)).toBe(
      "https://recordings.vtuber.fffdan.com/api/b/live/1727071052/live-stream/audio",
    );
    expect(recordingFileUrl(1727071052, "[RAW] 空格.flv")).toBe(
      "https://recordings.vtuber.fffdan.com/api/b/live/1727071052/recordings/%5BRAW%5D%20%E7%A9%BA%E6%A0%BC.flv",
    );
    expect(recordingReplayHref(7, "a b.flv")).toBe(
      "/recordings/replay?roomId=7&file=a%20b.flv",
    );
  });

  it("次要1 结构校验宽容：坏 item 跳过、可缺省字段按可缺省校验（不整响应失败）", async () => {
    // 录制进行中的文件：info 有 startedAt 无 endedAt → 不得整体失败（直播中高概率命中）
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({
            files: [
              {
                name: "live.flv",
                size: 1024,
                createdAt: "2026-09-23T23:00:00.000Z",
                info: {
                  recordingId: "rec-live",
                  title: "直播中",
                  mid: 1,
                  startedAt: "2026-09-23T20:58:38.000Z",
                },
              },
              { name: 123 },
            ],
          }),
        ),
    );
    const recordings = await fetchRoomRecordings(9);
    expect(recordings.files).toHaveLength(1); // 坏 item 跳过，好 item 保留
    expect(recordings.files[0]?.info?.endedAt).toBe("");

    // 状态：缺 sessionTitle / streamer 缺 name（可缺省）；缺 mid 的坏 item 跳过
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({
            items: [
              { mid: 1891335475, roomId: 1, state: "recording", updatedAt: "2026-09-23T14:58:15.876Z" },
              { state: "not_live" },
            ],
          }),
        ),
    );
    const status = await fetchRecordingStatus();
    expect(status.items).toHaveLength(1);
    expect(status.items[0]?.sessionTitle).toBeNull();
    expect(status.items[0]?.streamer.name).toBe("");

    // 事件：sender 缺 face/guardLevel、medal 结构不符、坏 item 缺 eventId
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({
            total: 2,
            items: [
              {
                eventId: "e1",
                type: "danmaku",
                occurredAt: "2026-09-23T21:00:01.000Z",
                sender: { uid: 1, name: "观众", medal: { nope: 1 } },
              },
              { type: "danmaku", occurredAt: "2026-09-23T21:00:02.000Z" },
            ],
          }),
        ),
    );
    const events = await fetchLiveEvents({
      roomId: 1,
      start: "2026-09-23T21:00:00.000Z",
      end: "2026-09-23T21:10:00.000Z",
      page: 1,
      pageSize: 100,
    });
    expect(events.items).toHaveLength(1);
    expect(events.items[0]?.sender.face).toBe("");
    expect(events.items[0]?.sender.guardLevel).toBeNull();
    expect(events.items[0]?.sender.medal).toBeNull();
  });

  it("R15-2 缺失/非法 state 的状态项跳过：不产生任何 recording 项（防假直播态）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            { mid: 1, roomId: 101 }, // 缺 state
            { mid: 2, roomId: 102, state: "weird" }, // 非法 state
            { mid: 3, roomId: 103, state: "not_live" }, // 合法：保留
          ],
        }),
      ),
    );
    const status = await fetchRecordingStatus();
    // 红：当前缺/非法 state 被强转 recording → items 长度 3 且含 recording 项
    expect(status.items).toHaveLength(1);
    expect(status.items[0]?.state).toBe("not_live");
    expect(status.items.some((item) => item.state === "recording")).toBe(false);
  });

  it("次要10 fetchLiveEvents 钳制 pageSize≤100 且查询区间≤12h（上游契约）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ total: 0, items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchLiveEvents({
      roomId: 5,
      start: "2026-09-23T00:00:00.000Z",
      end: "2026-09-23T20:00:00.000Z", // 20h > 12h
      page: 1,
      pageSize: 500, // > 100
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("pageSize")).toBe("100");
    const end = Date.parse(url.searchParams.get("end") as string);
    const start = Date.parse(url.searchParams.get("start") as string);
    expect(end - start).toBeLessThanOrEqual(12 * 60 * 60 * 1000);
  });
});
