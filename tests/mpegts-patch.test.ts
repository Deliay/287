import { describe, expect, it } from "vitest";
import mpegts from "mpegts.js";

/**
 * T0 回归用例：pnpm `patchedDependencies` 补丁必须生效。
 * 补丁把 mpegts.js 的入口替换为 `dist/mpegts-byte-offset-seek.js`，
 * 为 `createPlayer` 返回的实例挂上 `seekToByteOffset` / `setBufferLimits`
 * （技术方案 §3.3：未缓冲 seek 与 50MB 缓冲预算的前置能力）。
 */
describe("mpegts.js 补丁（字节偏移 seek / 缓冲上限）", () => {
  it("createPlayer 返回的实例带 seekToByteOffset 与 setBufferLimits", () => {
    const player = mpegts.createPlayer({ type: "flv", isLive: true, url: "http://example.invalid/live.flv" }) as unknown as {
      seekToByteOffset?: unknown;
      setBufferLimits?: unknown;
      destroy(): void;
    };
    expect(typeof player.seekToByteOffset).toBe("function");
    expect(typeof player.setBufferLimits).toBe("function");
    player.destroy();
  });

  it("补丁导出 __sumireApplyByteOffsetSeek 供防死锁逻辑单测", () => {
    const patched = mpegts as unknown as { __sumireApplyByteOffsetSeek?: unknown };
    expect(typeof patched.__sumireApplyByteOffsetSeek).toBe("function");
  });
});
