import { describe, expect, it } from "vitest";
import type { RecordingFile } from "@/features/recordings/types";
import {
  WINDOW_MS,
  offsetMsFor,
  segmentBoundsForFile,
  toIso,
  windowBounds,
  windowIndexFor,
} from "@/features/recordings/replay/replay-windows";

function makeFile(
  name: string,
  createdAt: string,
  info?: { recordingId: string; startedAt: string; endedAt: string },
): RecordingFile {
  return {
    name,
    size: 1000,
    createdAt,
    ...(info
      ? { info: { recordingId: info.recordingId, title: "标题", mid: 1, startedAt: info.startedAt, endedAt: info.endedAt } }
      : {}),
  };
}

describe("时间锚点与分段推导 replay-windows（T9 / AC-7 对齐基准）", () => {
  it("单文件场次：bounds 起点 = info.startedAt（不是 createdAt）", () => {
    const files = [
      makeFile("only.flv", "2026-09-23T23:00:00.000Z", {
        recordingId: "rec-1",
        startedAt: "2026-09-23T20:58:38.000Z",
        endedAt: "2026-09-23T23:00:00.000Z",
      }),
    ];
    const bounds = segmentBoundsForFile(files, "only.flv");
    expect(bounds.startMs).toBe(Date.parse("2026-09-23T20:58:38.000Z"));
    expect(bounds.endMs).toBe(Date.parse("2026-09-23T23:00:00.000Z"));
    expect(bounds.startMs).not.toBe(Date.parse("2026-09-23T23:00:00.000Z"));
  });

  it("多分段：第二段起止由兄弟文件 createdAt 推导（锚点用首段 startedAt）", () => {
    const files = [
      makeFile("seg-2.flv", "2026-09-23T22:00:00.000Z", {
        recordingId: "rec-9",
        startedAt: "2026-09-23T20:00:00.000Z",
        endedAt: "2026-09-23T23:00:00.000Z",
      }),
      makeFile("seg-1.flv", "2026-09-23T21:00:00.000Z", {
        recordingId: "rec-9",
        startedAt: "2026-09-23T20:00:00.000Z",
        endedAt: "2026-09-23T23:00:00.000Z",
      }),
    ];

    const first = segmentBoundsForFile(files, "seg-1.flv");
    expect(first.startMs).toBe(Date.parse("2026-09-23T20:00:00.000Z")); // 首段：锚点 startedAt
    expect(first.endMs).toBe(Date.parse("2026-09-23T21:00:00.000Z")); // 下一段 createdAt

    const second = segmentBoundsForFile(files, "seg-2.flv");
    // 风险表 #7 检查点：起点来自**前一段** createdAt，而非目标文件自身 createdAt
    expect(second.startMs).toBe(Date.parse("2026-09-23T21:00:00.000Z"));
    expect(second.startMs).not.toBe(Date.parse("2026-09-23T22:00:00.000Z"));
    expect(second.endMs).toBe(Date.parse("2026-09-23T23:00:00.000Z")); // 末段：info.endedAt
  });

  it("info 缺失时回退 createdAt 作起点，终点无法确定则为 NaN", () => {
    const files = [makeFile("raw.flv", "2026-09-23T22:00:00.000Z")];
    const bounds = segmentBoundsForFile(files, "raw.flv");
    expect(bounds.startMs).toBe(Date.parse("2026-09-23T22:00:00.000Z"));
    expect(Number.isNaN(bounds.endMs)).toBe(true);
    expect(bounds.fallback).toBe(true);
  });

  it("windowIndexFor 边界值：0 / 599999 / 600000；负值与 NaN 钳到 0", () => {
    expect(windowIndexFor(0)).toBe(0);
    expect(windowIndexFor(599_999)).toBe(0);
    expect(windowIndexFor(600_000)).toBe(1);
    expect(windowIndexFor(1_200_000)).toBe(2);
    expect(windowIndexFor(-1)).toBe(0);
    expect(windowIndexFor(Number.NaN)).toBe(0);
  });

  it("windowBounds 起止与 12h 契约：12h 只约束单窗查询宽度，不做绝对时长上限", () => {
    const start = Date.parse("2026-09-23T20:00:00.000Z");
    expect(windowBounds(0, start)).toEqual({ startMs: start, endMs: start + WINDOW_MS });
    expect(windowBounds(0, start, start + 120_000)).toEqual({
      startMs: start,
      endMs: start + 120_000,
    });
    // 已知终点早于窗口起点 → 空窗（调用方跳过）
    expect(windowBounds(10, start, start + 60_000).endMs).toBeLessThanOrEqual(
      windowBounds(10, start, start + 60_000).startMs,
    );

    // 次要2：终点未知（info 缺失）时，index ≥ 72（>12h）的窗口仍是完整 10min，不得被静默拉空
    const far = windowBounds(72, start);
    expect(far.startMs).toBe(start + 72 * WINDOW_MS);
    expect(far.endMs).toBe(far.startMs + WINDOW_MS);
    const veryFar = windowBounds(200, start);
    expect(veryFar.endMs).toBe(veryFar.startMs + WINDOW_MS);
    expect(veryFar.endMs - veryFar.startMs).toBe(WINDOW_MS); // 单窗恒为 10min（12h 上限只在 api.ts 钳制查询区间）
  });

  it("offsetMsFor / toIso 互为逆运算", () => {
    const start = "2026-09-23T20:00:00.000Z";
    const occurred = "2026-09-23T20:10:00.000Z";
    expect(offsetMsFor(occurred, start)).toBe(600_000);
    expect(toIso(Date.parse(start))).toBe(start);
  });
});
