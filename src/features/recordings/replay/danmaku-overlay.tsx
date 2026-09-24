"use client";

import { useEffect, useRef } from "react";
import type { LiveEvent } from "../types";
import { offsetMsFor } from "./replay-windows";

/** 播放头回退或前跳超过该阈值（秒）判为 seek，清空浮层重建。 */
export const SEEK_JUMP_THRESHOLD_SECONDS = 2;
/** seek 重建时回放「最近多少秒内」的弹幕，避免落点画面空荡。 */
export const SEEK_REBUILD_SECONDS = 4;
/** 弹幕横穿画面所需秒数（决定匀速速度）。 */
export const TRAVEL_SECONDS = 8;
/** 同屏在飞弹幕上限；超出丢弃。 */
export const MAX_ACTIVE_DANMAKU = 50;
/** 单轨道基准高度（px）。 */
export const LANE_HEIGHT = 28;
/** 同轨道两条弹幕之间的最小安全间距（px）。 */
export const MIN_LANE_GAP = 24;
/** 弹幕字号基准（px @1920 宽）与下限。 */
export const BASE_FONT_SIZE = 32;
export const MIN_FONT_SIZE = 20;
export const BASE_VIDEO_WIDTH = 1920;
/** 表情弹幕最大高度相对字号的倍数。 */
export const EMOTE_MAX_SCALE = 2;

/** 在飞弹幕的最小状态（轨道分配用，纯数据）。 */
export interface ActiveDanmaku {
  lane: number;
  /** 左缘 x 坐标（px，随时间左移）。 */
  x: number;
  /** 弹幕像素宽度。 */
  width: number;
  /** 左移速度（px/s）。 */
  speed: number;
}

export interface DanmakuInput {
  text?: string;
  emoteUrl?: string;
  emoteAlt?: string;
}

/** 字号随画布宽度线性缩放（32px @1920），并钳到下限 20px。 */
export function fontSizeForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return BASE_FONT_SIZE;
  return Math.max(MIN_FONT_SIZE, Math.round((BASE_FONT_SIZE * width) / BASE_VIDEO_WIDTH));
}

/** 匀速左移速度（px/s），与文本长度无关。 */
export function danmakuSpeed(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return width / TRAVEL_SECONDS;
}

/** 单轨道高度：随字号放大，至少 LANE_HEIGHT，保证相邻轨道不重叠。 */
export function laneHeightForWidth(width: number): number {
  return Math.max(LANE_HEIGHT, Math.round(fontSizeForWidth(width) * 1.3));
}

/** 按 16:9 画布高度与轨道高度推算轨道数。 */
export function laneCountForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.floor((width * 9) / 16 / laneHeightForWidth(width)));
}

/**
 * 选择首个可用轨道：该轨道最新弹幕的右缘须已完全进入画面并留出 `MIN_LANE_GAP`。
 * 全部轨道占用或在飞数达上限时返回 `null`（丢弃）。
 */
export function assignLane(
  active: ActiveDanmaku[],
  width: number,
  laneCount = laneCountForWidth(width),
): number | null {
  if (active.length >= MAX_ACTIVE_DANMAKU) return null;
  for (let lane = 0; lane < laneCount; lane++) {
    let free = true;
    for (const item of active) {
      if (item.lane !== lane) continue;
      if (item.x + item.width + MIN_LANE_GAP > width) {
        free = false;
        break;
      }
    }
    if (free) return lane;
  }
  return null;
}

/** 事件墙上时钟 → 相对录播偏移秒（仅 danmaku 类型）。 */
export function danmakuOffsets(
  events: readonly LiveEvent[],
  recordStartMs: number,
): { event: LiveEvent; offsetSeconds: number }[] {
  const result: { event: LiveEvent; offsetSeconds: number }[] = [];
  for (const event of events) {
    if (event.type !== "danmaku") continue;
    const offset = offsetMsFor(event.occurredAt, recordStartMs);
    if (!Number.isFinite(offset)) continue;
    result.push({ event, offsetSeconds: offset / 1000 });
  }
  return result;
}

/** 选取 `(prev, next]` 区间内应发射的弹幕（播放前进时的增量）。 */
export function selectDanmakusToEmit<T extends { offsetSeconds: number }>(
  offsets: T[],
  prevSeconds: number,
  nextSeconds: number,
): T[] {
  return offsets.filter((item) => item.offsetSeconds > prevSeconds && item.offsetSeconds <= nextSeconds);
}

/** 播放头跳变（回退或前跳，|Δ|>阈值）判为 seek——小幅回退不算（审核次要7，与计划 T12 一致）。 */
export function isSeekJump(prevSeconds: number, nextSeconds: number): boolean {
  return Math.abs(nextSeconds - prevSeconds) > SEEK_JUMP_THRESHOLD_SECONDS;
}

/** 渲染循环调度（可注入，便于单测驱动帧）。 */
export interface DanmakuScheduler {
  request(callback: (timestamp: number) => void): number;
  cancel(handle: number): void;
}

const defaultScheduler: DanmakuScheduler = {
  request: (callback) =>
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(callback)
      : (setTimeout(() => callback(Date.now()), 16) as unknown as number),
  cancel: (handle) => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
    else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  },
};

export interface DanmakuRenderer {
  enqueue(input: DanmakuInput): void;
  setPaused(paused: boolean): void;
  clear(): void;
  /** 更新绘制缓冲与坐标系（尺寸为 CSS 像素，dpr 为设备像素比）——审核 R2 */
  setMetrics(width: number, height: number, dpr: number): void;
  destroy(): void;
}

interface FlyingDanmaku extends ActiveDanmaku, DanmakuInput {
  /** 表情图片加载后是否已按实际尺寸重测过宽度（审核次要7） */
  measured?: boolean;
}

const imageCache = new Map<string, HTMLImageElement>();

function loadImage(url: string): HTMLImageElement {
  let image = imageCache.get(url);
  if (!image) {
    image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.src = url;
    imageCache.set(url, image);
  }
  return image;
}

export interface CreateRendererOptions {
  color?: string;
  strokeColor?: string;
  fontFamily?: string;
  scheduler?: DanmakuScheduler;
}

/**
 * 创建 canvas 弹幕渲染器：调度驱动的匀速左移、出画回收、暂停挂起；
 * 表情弹幕经 `Image` 预载，未载完以 alt 文本占位。
 */
export function createDanmakuRenderer(
  canvas: HTMLCanvasElement,
  options: CreateRendererOptions = {},
): DanmakuRenderer {
  const ctx = canvas.getContext("2d");
  const scheduler = options.scheduler ?? defaultScheduler;
  const color = options.color ?? "#ffffff";
  const strokeColor = options.strokeColor ?? "rgba(0, 0, 0, 0.85)";
  const fontFamily = options.fontFamily ?? "system-ui, sans-serif";

  let items: FlyingDanmaku[] = [];
  let width = canvas.clientWidth || BASE_VIDEO_WIDTH;
  let height = canvas.clientHeight || Math.round((BASE_VIDEO_WIDTH * 9) / 16);
  let dpr =
    typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
  let paused = false;
  let handle: number | null = null;
  let lastTs = 0;
  let destroyed = false;

  /**
   * 同步绘制缓冲与坐标系（审核 R2）：`canvas.width/height` 是位图缓冲，
   * 只设 CSS 尺寸会让 300×150 默认缓冲被拉伸——超出缓冲的绘制坐标全部不可见。
   * `setTransform(dpr)` 后，绘制逻辑统一使用 CSS 像素坐标。
   */
  function applyMetrics(nextWidth: number, nextHeight: number, nextDpr: number): void {
    if (Number.isFinite(nextWidth) && nextWidth > 0) width = nextWidth;
    if (Number.isFinite(nextHeight) && nextHeight > 0) height = nextHeight;
    if (Number.isFinite(nextDpr) && nextDpr > 0) dpr = nextDpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // 初始化绘制缓冲（默认按容器尺寸 ×DPR）
  applyMetrics(width, height, dpr);

  function measure(input: DanmakuInput): number {
    const fontSize = fontSizeForWidth(width);
    if (input.emoteUrl) {
      const image = loadImage(input.emoteUrl);
      const natural = image.naturalWidth > 0 ? image.naturalWidth : fontSize * 2;
      return Math.min(natural, fontSize * 4);
    }
    if (!ctx) return (input.text?.length ?? 0) * fontSize * 0.6;
    ctx.font = `600 ${fontSize}px ${fontFamily}`;
    return ctx.measureText(input.text ?? "").width;
  }

  function draw(item: FlyingDanmaku) {
    if (!ctx) return;
    const fontSize = fontSizeForWidth(width);
    const laneHeight = laneHeightForWidth(width);
    const y = item.lane * laneHeight + laneHeight / 2 + fontSize / 2;
    if (item.emoteUrl) {
      const image = loadImage(item.emoteUrl);
      if (image.complete && image.naturalWidth > 0) {
        // 图片加载完成后按实际尺寸重测一次（否则一直用估宽绘制会被压扁，审核次要7）
        if (!item.measured) {
          item.width = Math.min(image.naturalWidth, fontSize * 4);
          item.measured = true;
        }
        const ratio = image.naturalHeight > 0 ? image.naturalHeight / image.naturalWidth : 1;
        // 高度上限取「字号倍数」与「轨道高」较小者：表情不得压过轨道造成相邻轨道重叠（审核次要7）
        const maxEmoteHeight = Math.min(fontSize * EMOTE_MAX_SCALE, laneHeight * 0.9);
        const w = Math.min(item.width, fontSize * 4, maxEmoteHeight / ratio);
        ctx.drawImage(image, item.x, y - w * ratio + fontSize / 2, w, w * ratio);
      } else {
        ctx.font = `600 ${fontSize}px ${fontFamily}`;
        ctx.lineWidth = Math.max(2, fontSize * 0.12);
        ctx.strokeStyle = strokeColor;
        ctx.fillStyle = color;
        ctx.strokeText(item.emoteAlt ?? "", item.x, y);
        ctx.fillText(item.emoteAlt ?? "", item.x, y);
      }
      return;
    }
    ctx.font = `600 ${fontSize}px ${fontFamily}`;
    ctx.lineWidth = Math.max(2, fontSize * 0.12);
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = color;
    ctx.strokeText(item.text ?? "", item.x, y);
    ctx.fillText(item.text ?? "", item.x, y);
  }

  function frame(timestamp: number) {
    if (destroyed) return;
    const dt = lastTs === 0 ? 0 : Math.min((timestamp - lastTs) / 1000, 0.1);
    lastTs = timestamp;
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
    }
    if (!paused) {
      for (const item of items) item.x -= item.speed * dt;
      items = items.filter((item) => item.x + item.width > 0);
    }
    for (const item of items) draw(item);
    handle = scheduler.request(frame);
  }

  function ensureLoop() {
    if (handle !== null || destroyed) return;
    lastTs = 0;
    handle = scheduler.request(frame);
  }

  ensureLoop();

  return {
    enqueue(input) {
      const measured = measure(input);
      const lane = assignLane(items, width, laneCountForWidth(width));
      if (lane === null) return;
      items.push({ lane, x: width, width: measured, speed: danmakuSpeed(width), ...input });
      ensureLoop();
    },
    setPaused(next) {
      paused = next;
      ensureLoop();
    },
    clear() {
      items = [];
    },
    setMetrics(nextWidth, nextHeight, nextDpr) {
      applyMetrics(nextWidth, nextHeight, nextDpr);
      ensureLoop();
    },
    destroy() {
      destroyed = true;
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
      items = [];
    },
  };
}

export interface DanmakuOverlayProps {
  /** 已加载窗口内的事件（升序去重）。 */
  events: readonly LiveEvent[];
  /** 分段实际起点毫秒（`info.startedAt` 推导）。 */
  recordStartMs: number;
  /** 当前播放时间（秒）。 */
  currentTime: number;
  playing: boolean;
  /** 弹幕开关。 */
  enabled: boolean;
  className?: string;
  /** 依赖注入：渲染循环调度（单测用）。 */
  scheduler?: DanmakuScheduler;
}

function toInput(event: LiveEvent): DanmakuInput {
  if (event.emote?.url) return { emoteUrl: event.emote.url, emoteAlt: event.emote.name, text: event.content };
  return { text: event.content ?? "" };
}

/**
 * 视频上层的 canvas 弹幕浮层（技术方案 §3.3 弹幕渲染）：
 * 正常播放发射 `(prev, current]` 区间事件；seek 跳变（回退或前跳 >2s）清空轨道并补发最近 4s。
 */
export function DanmakuOverlay({
  events,
  recordStartMs,
  currentTime,
  playing,
  enabled,
  className,
  scheduler,
}: DanmakuOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DanmakuRenderer | null>(null);
  const prevRef = useRef<number | null>(null);

  // 渲染器随组件挂载/卸载创建销毁（页面卸载即停止）；容器尺寸变化时同步绘制缓冲（审核 R2）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createDanmakuRenderer(canvas, scheduler ? { scheduler } : {});
    rendererRef.current = renderer;

    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
            const rect = entries[entries.length - 1]?.contentRect;
            if (!rect) return;
            renderer.setMetrics(
              rect.width,
              rect.height,
              typeof window !== "undefined" && window.devicePixelRatio > 0
                ? window.devicePixelRatio
                : 1,
            );
          })
        : null;
    observer?.observe(canvas);

    return () => {
      observer?.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [scheduler]);

  // 播放推进/seek 驱动的发射逻辑
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setPaused(!playing);

    if (prevRef.current === null) {
      prevRef.current = currentTime;
      return;
    }
    const prev = prevRef.current;
    prevRef.current = currentTime;

    // 弹幕开关关闭：清屏（在飞弹幕立即消失），且 seek 也不再重建（审核次要7）。
    // 必须在「prev === currentTime」早退之前——暂停态（时间不前进）切换开关也要清屏（审核 R12-c）
    if (!enabled) {
      renderer.clear();
      return;
    }

    if (prev === currentTime) return;

    const offsets = danmakuOffsets(events, recordStartMs);
    if (isSeekJump(prev, currentTime)) {
      renderer.clear();
      for (const item of selectDanmakusToEmit(offsets, currentTime - SEEK_REBUILD_SECONDS, currentTime)) {
        renderer.enqueue(toInput(item.event));
      }
      return;
    }
    for (const item of selectDanmakusToEmit(offsets, prev, currentTime)) {
      renderer.enqueue(toInput(item.event));
    }
  }, [events, recordStartMs, currentTime, playing, enabled]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}
