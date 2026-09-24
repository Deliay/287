/**
 * 站内内联 SVG 图标（设计文档 §2.5 图标口径 · 审核 R14-5）：
 * 全部图标按钮一律使用 SVG，不再使用 emoji / Unicode 几何字形；
 * 不引入第三方 icon 库（静态导出零新增依赖）。宽高 1em，随字号缩放（等效原字形占位）。
 */
import type { CSSProperties } from "react";

interface IconProps {
  className?: string;
  style?: CSSProperties;
}

const ICON_SVG = {
  viewBox: "0 0 24 24",
  width: "1em",
  height: "1em",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const FILL = { fill: "currentColor", stroke: "none" } as const;

function wrapperStyle(style?: CSSProperties): CSSProperties {
  return { display: "inline-block", verticalAlign: "-0.15em", ...style };
}

/** 返回箭头（←，回放页返回录播列表）。 */
export function IconArrowLeft({ className, style }: IconProps) {
  return (
    <svg {...ICON_SVG} className={className} style={wrapperStyle(style)}>
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </svg>
  );
}

/** 播放（▶ / 卡片「▸ 听直播」同形）。 */
export function IconPlay({ className, style }: IconProps) {
  return (
    <svg {...ICON_SVG} className={className} style={wrapperStyle(style)}>
      <path d="M8 5.2v13.6L19.2 12z" {...FILL} />
    </svg>
  );
}

/** 暂停（⏸ 同义）。 */
export function IconPause({ className, style }: IconProps) {
  return (
    <svg {...ICON_SVG} className={className} style={wrapperStyle(style)}>
      <rect x="7.5" y="5" width="3.2" height="14" rx="1.2" {...FILL} />
      <rect x="13.3" y="5" width="3.2" height="14" rx="1.2" {...FILL} />
    </svg>
  );
}

/** 实心方块（「■ 停止收听」同义）。 */
export function IconSquare({ className, style }: IconProps) {
  return (
    <svg {...ICON_SVG} className={className} style={wrapperStyle(style)}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" {...FILL} />
    </svg>
  );
}

/** 展开/收起箭头（▸ / ▾，录播分组头）。 */
export function IconChevron({ className, style, direction = "down" }: IconProps & { direction?: "up" | "down" }) {
  return (
    <svg {...ICON_SVG} className={className} style={wrapperStyle(style)}>
      <path d={direction === "up" ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
    </svg>
  );
}

/** 关闭（✕，悬浮组件逐路停止）。 */
export function IconClose({ className, style }: IconProps) {
  return (
    <svg {...ICON_SVG} className={className} style={wrapperStyle(style)}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

/** 方框（▢，悬浮组件迷你条展开）。 */
export function IconExpand({ className, style }: IconProps) {
  return (
    <svg {...ICON_SVG} className={className} style={wrapperStyle(style)}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
    </svg>
  );
}

/** 横线（─，悬浮组件收起）。 */
export function IconCollapse({ className, style }: IconProps) {
  return (
    <svg {...ICON_SVG} className={className} style={wrapperStyle(style)}>
      <path d="M5 12h14" />
    </svg>
  );
}

/** 音符（♪，悬浮组件迷你条前缀）。 */
export function IconNote({ className, style }: IconProps) {
  return (
    <svg {...ICON_SVG} className={className} style={wrapperStyle(style)}>
      <path d="M9 17.5V6l8-1.5V14" />
      <circle cx="6.8" cy="17.5" r="2.2" />
      <circle cx="14.8" cy="14" r="2.2" />
    </svg>
  );
}

/** 全屏（⛶，回放控件）。 */
export function IconFullscreen({ className, style }: IconProps) {
  return (
    <svg {...ICON_SVG} className={className} style={wrapperStyle(style)}>
      <path d="M4 9V4.5h5" />
      <path d="M20 9V4.5h-5" />
      <path d="M4 15v4.5h5" />
      <path d="M20 15v4.5h-5" />
    </svg>
  );
}

/** 音量（🔊，回放控件音量前缀）。 */
export function IconVolume({ className, style }: IconProps) {
  return (
    <svg {...ICON_SVG} className={className} style={wrapperStyle(style)}>
      <path d="M4 9.5v5h3.4L12 18V6l-4.6 3.5H4z" />
      <path d="M15.5 9a4.5 4.5 0 010 6" />
    </svg>
  );
}

/** 静音（🔇，回放控件静音切换）。 */
export function IconVolumeMute({ className, style }: IconProps) {
  return (
    <svg {...ICON_SVG} className={className} style={wrapperStyle(style)}>
      <path d="M4 9.5v5h3.4L12 18V6l-4.6 3.5H4z" />
      <path d="M16 9.5l5 5" />
      <path d="M21 9.5l-5 5" />
    </svg>
  );
}
