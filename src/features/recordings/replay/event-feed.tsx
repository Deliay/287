"use client";

import type { CSSProperties } from "react";
import type { LiveEvent } from "../types";
import { formatOffset } from "../format";
import styles from "./event-feed.module.css";

/**
 * 事件信息流条目（FR-6 · 设计 §2.4）：按 `event.type` 分派 danmaku / gift inline 流式布局，
 * guard_buy / super_chat 独占一行卡片；条目本体为 button——保留时间戳与点击 seek，
 * `current` 驱动当前播放位置高亮（窗口化数据链路零改动）。
 */
export interface EventFeedItemProps {
  event: LiveEvent;
  /** 相对录播起点的偏移秒：渲染时间戳并作为 `onSeek` 入参。 */
  offsetSeconds: number;
  /** 当前播放位置高亮。 */
  current: boolean;
  onSeek(offsetSeconds: number): void;
}

/** 金额：仅正数渲染，前置 `¥`、两位小数（price 已由服务端折算为元，需求 §7）。 */
function Price({ value }: { value?: number }) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return <span className={styles.price}>¥{value.toFixed(2)}</span>;
}

/**
 * 发送者段：粉丝牌 badge（牌名 + 等级，`medal.color` 着色）+ 浅色用户名 + 可选冒号。
 * `colon` 仅 danmaku 场景为 true（FR-6.1）；gift 沿用同一 badge/用户名样式（FR-6.2）。
 */
function Sender({ event, medal, colon }: { event: LiveEvent; medal: boolean; colon: boolean }) {
  const { sender } = event;
  return (
    <>
      {medal && sender.medal && (
        <span
          className={styles.medal}
          style={{
            color: sender.medal.color,
            borderColor: sender.medal.color,
            backgroundColor: `color-mix(in srgb, ${sender.medal.color} 15%, transparent)`,
          }}
        >
          <span className={styles.medalName}>{sender.medal.name}</span>
          <span className={styles.medalLevel}>{sender.medal.level}</span>
        </span>
      )}
      <span className={styles.sender}>{sender.name}</span>
      {colon && (
        <span className={styles.colon} aria-hidden="true">
          ：
        </span>
      )}
    </>
  );
}

/** FR-6.1 弹幕：inline 流式、支持换行；`emote` 图文混排（懒加载）。 */
function DanmakuBody({ event }: { event: LiveEvent }) {
  return (
    <span className={styles.flow}>
      <Sender event={event} medal colon />
      <span className={styles.message}>
        {event.content}
        {event.emote && (
          // 跨源表情/礼物图（上游 CDN 直链）：静态导出关闭 next/image 优化，按设计 §2.4 用原生懒加载
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.emote}
            src={event.emote.url}
            alt={event.emote.name}
            loading="lazy"
          />
        )}
      </span>
    </span>
  );
}

/** FR-6.2 礼物：发送者（同 6.1）+ 赝送了 + 图标 + `gift.name ×count` + 金额。 */
function GiftBody({ event }: { event: LiveEvent }) {
  const gift = event.gift;
  return (
    <span className={styles.flow}>
      <Sender event={event} medal colon={false} />
      <span className={styles.giftLead}>赠送了</span>
      {gift?.iconUrl && (
        // 跨源礼物图标（上游 CDN 直链）：静态导出关闭 next/image 优化，按设计 §2.4 用原生懒加载
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.giftIcon} src={gift.iconUrl} alt="" loading="lazy" />
      )}
      <span className={styles.giftName}>
        {gift ? `${gift.name} ×${gift.count}` : (event.content ?? "")}
      </span>
      <Price value={event.price} />
    </span>
  );
}

/** FR-6.3 舰长上舰：独占一行卡片；上游事实 face/medal 恒空，不渲染对应元素（需求 §7）。 */
function GuardBody({ event }: { event: LiveEvent }) {
  const guard = event.guard;
  return (
    <span className={styles.guardCard}>
      <span className={styles.guardSender}>{event.sender.name}</span>
      <span className={styles.guardText}>
        {guard ? `开通了 ${guard.name} ×${guard.count}` : (event.content ?? "")}
      </span>
      <Price value={event.price} />
    </span>
  );
}

/** FR-6.4 醒目留言 SC：独占一行卡片，配色取 `scColors`，缺失/非法回退默认金色系（设计 §1）。 */
function SuperChatBody({ event }: { event: LiveEvent }) {
  const colors = event.scColors;
  const inlineStyle: CSSProperties | undefined = colors
    ? {
        backgroundImage: `linear-gradient(${colors.backgroundStart}, ${colors.backgroundEnd})`,
        color: colors.fontColor,
      }
    : undefined;
  return (
    <span className={styles.scCard} style={inlineStyle}>
      <span className={styles.scHead}>
        <span className={styles.scIdentity}>
          {/* 文字类型标识：配色不作为唯一信息通道（PRD §5 / 设计 §1「SC 留言」） */}
          <span className={styles.scTag}>SC 留言</span>
          <span className={styles.scSender}>{event.sender.name}</span>
        </span>
        <Price value={event.price} />
      </span>
      {event.content && <span className={styles.scMessage}>{event.content}</span>}
    </span>
  );
}

/** 解析层已把 `gift_v2` 归一为 `gift`（T1）；此处再兜底一次，保证渲染分支恒定。 */
function feedKind(type: LiveEvent["type"]): "danmaku" | "super_chat" | "gift" | "guard_buy" {
  if (type === "gift_v2") return "gift";
  return type;
}

export function EventFeedItem({ event, offsetSeconds, current, onSeek }: EventFeedItemProps) {
  const kind = feedKind(event.type);
  return (
    <button
      type="button"
      className={current ? styles.itemCurrent : styles.item}
      data-current={current ? "true" : undefined}
      onClick={() => onSeek(offsetSeconds)}
    >
      <span className={styles.time}>{formatOffset(offsetSeconds)}</span>
      {kind === "gift" ? (
        <GiftBody event={event} />
      ) : kind === "guard_buy" ? (
        <GuardBody event={event} />
      ) : kind === "super_chat" ? (
        <SuperChatBody event={event} />
      ) : (
        <DanmakuBody event={event} />
      )}
    </button>
  );
}
