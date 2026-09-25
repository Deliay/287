import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EventFeedItem } from "@/features/recordings/replay/event-feed";
import styles from "@/features/recordings/replay/event-feed.module.css";
import type { LiveEvent } from "@/features/recordings/types";

/** 从 CSS 源码取出某条规则的声明体（结构断言共用，同 live-badge 用例口径） */
function ruleBody(css: string, selector: string): string {
  return css.match(new RegExp(`\\.${selector}\\b[^{}]*\\{([^{}]*)\\}`))?.[1] ?? "";
}

function makeEvent(overrides: Partial<LiveEvent>): LiveEvent {
  return {
    eventId: "e1",
    type: "danmaku",
    occurredAt: "2026-09-23T21:00:00.000Z",
    sender: { uid: 1, name: "观众甲", face: "", medal: null, guardLevel: null },
    ...overrides,
  };
}

describe("信息流条目 EventFeedItem（T8 / AC-6 · FR-6 · 设计 §2.4）", () => {
  it("danmaku：时间戳 + 粉丝牌 badge（牌名+等级、medal.color 着色）+ 浅色用户名 + 冒号 + 发言", () => {
    const event = makeEvent({
      sender: {
        uid: 1,
        name: "观众甲",
        face: "",
        medal: { name: "287", level: 3, color: "#8eb056" },
        guardLevel: null,
      },
      content: "好听，今天也来了",
    });
    render(<EventFeedItem event={event} offsetSeconds={61} current={false} onSeek={vi.fn()} />);

    const entry = screen.getByRole("button");
    expect(entry).toHaveTextContent("01:01"); // 时间戳保留（formatOffset）
    const medal = entry.querySelector(`.${styles.medal}`);
    expect(medal).not.toBeNull();
    expect(medal?.textContent).toContain("287"); // 牌名
    expect(medal?.textContent).toContain("3"); // 等级
    // jsdom 会把十六进制色规范化为 rgb()，两种写法均接受
    expect(medal?.getAttribute("style") ?? "").toMatch(/#8eb056|rgb\(\s*142,\s*176,\s*86\s*\)/i);
    expect(entry.querySelector(`.${styles.flow}`)).not.toBeNull(); // inline 流式容器
    expect(entry.querySelector(`.${styles.sender}`)).toHaveTextContent("观众甲"); // 用户名（浅色 class）
    expect(entry.textContent).toContain("："); // 冒号
    expect(entry.textContent).toContain("好听，今天也来了"); // 发言
  });

  it("danmaku 表情：emote 渲染为 img 且懒加载（图文混排）", () => {
    const event = makeEvent({
      content: "耶",
      emote: { url: "https://example.invalid/e.png", name: "耶", width: 44, height: 44 },
    });
    render(<EventFeedItem event={event} offsetSeconds={12} current={false} onSeek={vi.fn()} />);

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.invalid/e.png");
    expect(img).toHaveAttribute("alt", "耶");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img.closest("button")).not.toBeNull(); // 与文字同条目混排
  });

  it("gift：发送者（同 6.1 样式）+ 礼物图标 + 名称 ×数量 + 金额（price>0 才显示）", () => {
    const event = makeEvent({
      type: "gift",
      sender: {
        uid: 2,
        name: "送礼者",
        face: "",
        medal: { name: "287", level: 5, color: "#8eb056" },
        guardLevel: null,
      },
      price: 0.1,
      gift: { name: "人气票", count: 1, iconUrl: "https://example.invalid/gift.png" },
    });
    const { container } = render(
      <EventFeedItem event={event} offsetSeconds={20} current={false} onSeek={vi.fn()} />,
    );

    const entry = screen.getByRole("button");
    expect(entry.textContent).toContain("送礼者");
    expect(entry.textContent).toContain("人气票 ×1");
    expect(entry.textContent).toContain("¥0.10");
    expect(entry.querySelector(`.${styles.medal}`)).not.toBeNull(); // 发送者沿用 6.1 样式
    const icon = container.querySelector('img[loading="lazy"]');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("src")).toBe("https://example.invalid/gift.png");
    expect(icon?.getAttribute("alt")).toBe(""); // 装饰性图标
  });

  it("gift 无金额（price 缺失/为 0）不显示金额段", () => {
    const event = makeEvent({
      type: "gift",
      gift: { name: "小心心", count: 5, iconUrl: "https://example.invalid/g.png" },
    });
    render(<EventFeedItem event={event} offsetSeconds={30} current={false} onSeek={vi.fn()} />);
    const entry = screen.getByRole("button");
    expect(entry.textContent).toContain("小心心 ×5");
    expect(entry.textContent).not.toContain("¥");
  });

  it("gift_v2 归一事件与 gift 同构渲染（解析层归一 + 渲染层兜底）", () => {
    const gift = makeEvent({
      type: "gift",
      price: 1,
      gift: { name: "辣条", count: 2, iconUrl: "https://example.invalid/l.png" },
    });
    const first = render(
      <EventFeedItem event={gift} offsetSeconds={40} current={false} onSeek={vi.fn()} />,
    );
    const giftEntry = first.container.querySelector("button") as HTMLButtonElement;
    first.unmount();

    const second = render(
      <EventFeedItem
        event={{ ...gift, type: "gift_v2" }}
        offsetSeconds={40}
        current={false}
        onSeek={vi.fn()}
      />,
    );
    const v2Entry = second.container.querySelector("button") as HTMLButtonElement;
    expect(v2Entry.textContent).toBe(giftEntry.textContent);
    expect(v2Entry.textContent).toContain("辣条 ×2");
    expect(v2Entry.querySelector("img")).not.toBeNull();
  });

  it("guard_buy：独占一行卡片「用户名 开通了 舰长 ×1」+ 金额；无 medal/face 不崩；class 与普通弹幕区分", () => {
    const event = makeEvent({
      type: "guard_buy",
      sender: { uid: 3, name: "上舰者", face: "", medal: null, guardLevel: 3 },
      price: 198,
      guard: { level: 3, name: "舰长", count: 1 },
    });
    render(<EventFeedItem event={event} offsetSeconds={35} current={false} onSeek={vi.fn()} />);

    const entry = screen.getByRole("button");
    expect(entry.textContent).toContain("上舰者");
    expect(entry.textContent).toContain("开通了 舰长 ×1");
    expect(entry.textContent).toContain("¥198.00");
    expect(entry.querySelector(`.${styles.guardCard}`)).not.toBeNull(); // 独立整行卡片 class
    expect(entry.querySelector(`.${styles.flow}`)).toBeNull(); // 与普通弹幕形态区分
    expect(entry.querySelector("img")).toBeNull(); // 上游事实：无头像/粉丝牌，不渲染对应元素
  });

  it("super_chat：scColors 内联渐变 + fontColor；金额与留言展示", () => {
    const event = makeEvent({
      type: "super_chat",
      sender: { uid: 4, name: "打赏者", face: "", medal: null, guardLevel: null },
      content: "加油加油",
      price: 50,
      scColors: {
        backgroundStart: "#7a5b12",
        backgroundEnd: "#463309",
        fontColor: "#ffe6a6",
      },
    });
    render(<EventFeedItem event={event} offsetSeconds={41} current={false} onSeek={vi.fn()} />);

    const entry = screen.getByRole("button");
    expect(entry.textContent).toContain("打赏者");
    expect(entry.textContent).toContain("加油加油");
    expect(entry.textContent).toContain("¥50.00");
    const card = entry.querySelector(`.${styles.scCard}`) as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.style.backgroundImage).toContain("linear-gradient");
    expect(card.style.backgroundImage).toMatch(/#7a5b12|rgb\(\s*122,\s*91,\s*18\s*\)/i);
    expect(card.style.backgroundImage).toMatch(/#463309|rgb\(\s*70,\s*51,\s*9\s*\)/i);
    expect(card.style.color).toMatch(/#ffe6a6|255,\s*230,\s*166/i);
  });

  it("super_chat 缺失 scColors 时回退默认配色（不写内联色，CSS 默认金色系生效）", () => {
    const event = makeEvent({
      type: "super_chat",
      sender: { uid: 5, name: "观众乙", face: "", medal: null, guardLevel: null },
      content: "支持",
      price: 30,
    });
    render(<EventFeedItem event={event} offsetSeconds={42} current={false} onSeek={vi.fn()} />);
    const card = document.querySelector(`.${styles.scCard}`) as HTMLElement;
    expect(card.style.backgroundImage).toBe("");
    expect(card.style.color).toBe("");

    const css = readFileSync(
      path.join(process.cwd(), "src/features/recordings/replay/event-feed.module.css"),
      "utf8",
    );
    const scBody = ruleBody(css, "scCard");
    expect(scBody).toMatch(/#7a5b12/);
    expect(scBody).toMatch(/#463309/);
    expect(scBody).toMatch(/#ffe6a6/);
  });

  it("信息流配色遵循设计 §1：浅色用户名、舰长卡片左边框、弹幕正文色", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/features/recordings/replay/event-feed.module.css"),
      "utf8",
    );
    expect(ruleBody(css, "sender")).toMatch(/#c4c2cc|night287-2/); // 浅色用户名
    expect(ruleBody(css, "guardCard")).toMatch(/border-left/); // 舰长卡片左边框
    expect(ruleBody(css, "message")).toMatch(/#f4f3f5|night287-0/); // 弹幕正文
  });

  it("SC 卡片含视觉可见且读屏可及的文字类型标识「SC 留言」（PRD §5 配色非唯一信息通道）", () => {
    const sc = makeEvent({
      type: "super_chat",
      sender: { uid: 6, name: "打赏者丙", face: "", medal: null, guardLevel: null },
      content: "支持一下",
      price: 30,
      scColors: {
        backgroundStart: "#7a5b12",
        backgroundEnd: "#463309",
        fontColor: "#ffe6a6",
      },
    });
    const guard = makeEvent({
      type: "guard_buy",
      sender: { uid: 7, name: "上舰者", face: "", medal: null, guardLevel: 3 },
      price: 198,
      guard: { level: 3, name: "舰长", count: 1 },
    });
    const danmaku = makeEvent({ content: "普通弹幕" });
    const { container } = render(
      <>
        <EventFeedItem event={sc} offsetSeconds={41} current={false} onSeek={vi.fn()} />
        <EventFeedItem event={guard} offsetSeconds={35} current={false} onSeek={vi.fn()} />
        <EventFeedItem event={danmaku} offsetSeconds={10} current={false} onSeek={vi.fn()} />
      </>,
    );

    const scCard = container.querySelector(`.${styles.scCard}`) as HTMLElement;
    expect(scCard).not.toBeNull();
    const tag = Array.from(scCard.querySelectorAll("span")).find(
      (node) => node.textContent === "SC 留言",
    );
    expect(tag).toBeDefined(); // 文字类型标识存在
    expect(tag?.hasAttribute("aria-hidden")).toBe(false); // 读屏可及（未被隐藏）
    // 类型标识随卡片配色继承 fontColor（不引入新色值，设计 §1）
    expect(tag?.className).toBe(styles.scTag);

    // 不回归：guard 以「开通了」传达类型；普通弹幕不含 SC 标识
    const guardEntry = container.querySelectorAll("button")[1] as HTMLButtonElement;
    expect(guardEntry.textContent).toContain("开通了");
    const danmakuEntry = container.querySelectorAll("button")[2] as HTMLButtonElement;
    expect(danmakuEntry.textContent).not.toContain("SC 留言");
  });

  it("事件条时间戳为左侧固定宽列（设计 §2.4「左侧固定宽列」口径）", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/features/recordings/replay/event-feed.module.css"),
      "utf8",
    );
    const timeBody = ruleBody(css, "time");
    expect(timeBody).toMatch(/flex:\s*0\s+0\s+auto/);
    expect(timeBody).toMatch(/min-width:\s*[0-9.]+em/); // 列宽下限固定，短时间戳对齐成列
  });

  it("点击条目触发 onSeek(offsetSeconds)；高亮态挂 data-current", () => {
    const onSeek = vi.fn();
    const { rerender } = render(
      <EventFeedItem
        event={makeEvent({ content: "第一条" })}
        offsetSeconds={123}
        current={false}
        onSeek={onSeek}
      />,
    );
    const entry = screen.getByRole("button");
    expect(entry.hasAttribute("data-current")).toBe(false);
    fireEvent.click(entry);
    expect(onSeek).toHaveBeenCalledWith(123);

    rerender(
      <EventFeedItem
        event={makeEvent({ content: "第一条" })}
        offsetSeconds={123}
        current
        onSeek={onSeek}
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-current", "true");
    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it("列表容器集成：条目为 button、带时间戳并按高亮态区分", () => {
    const onSeek = vi.fn();
    render(
      <div data-testid="list">
        <EventFeedItem event={makeEvent({ content: "A" })} offsetSeconds={10} current={false} onSeek={onSeek} />
        <EventFeedItem event={makeEvent({ content: "B" })} offsetSeconds={61} current onSeek={onSeek} />
      </div>,
    );
    const list = screen.getByTestId("list");
    const entries = within(list).getAllByRole("button");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("00:10");
    expect(entries[1]).toHaveAttribute("data-current", "true");
    fireEvent.click(entries[0]);
    expect(onSeek).toHaveBeenCalledWith(10);
  });
});
