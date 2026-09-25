import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { LiveBadge } from "@/components/live-badge";
import styles from "@/components/live-badge.module.css";
import { members } from "@/data/members";
import { renderWithTheme } from "./utils";

const useLiveStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/live-status", () => ({
  useLiveStatus: useLiveStatusMock,
}));

/** 从 CSS 源码取出某条规则的声明体（结构断言共用） */
function ruleBody(css: string, selector: string): string {
  return css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("直播状态徽章 LiveBadge", () => {
  it("加载中渲染固定高度占位骨架，且不渲染任何链接", () => {
    useLiveStatusMock.mockReturnValue({ status: null });
    renderWithTheme(<LiveBadge member={members[0]} />);

    expect(screen.queryByRole("link")).toBeNull();
    const skeleton = document.querySelector(`.${styles.skeleton}`);
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveClass(styles.badge);
  });

  it("开播时可见文本为「正在直播：{标题}」，渲染为指向直播间的新标签页链接（AC-1）", () => {
    useLiveStatusMock.mockReturnValue({
      status: { living: true, title: "重生之我是钓鱼大师" },
    });
    renderWithTheme(<LiveBadge member={members[0]} />);

    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("正在直播：重生之我是钓鱼大师");
    expect(link).toHaveAttribute(
      "href",
      `https://live.bilibili.com/${members[0].roomId}`,
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
    expect(link.getAttribute("aria-label") ?? "").toContain("正在直播");
    expect(link.getAttribute("aria-label") ?? "").toContain(
      members[0].romanName,
    );
  });

  it("成员缺失 roomId 时开播链接降级为个人主页，不渲染无效直播间地址（AC-2）", () => {
    useLiveStatusMock.mockReturnValue({
      status: { living: true, title: "今晚杂谈" },
    });
    const withoutRoomId = { ...members[1], roomId: undefined };
    renderWithTheme(<LiveBadge member={withoutRoomId} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", members[1].bilibili);
    expect(link.getAttribute("href") ?? "").not.toContain("live.bilibili.com");
  });

  it("逐成员 liveUrl 覆盖优先于 roomId 推导（逃生口语义不变）", () => {
    useLiveStatusMock.mockReturnValue({
      status: { living: true, title: "今晚杂谈" },
    });
    const overridden = { ...members[2], liveUrl: "https://example.com/live" };
    renderWithTheme(<LiveBadge member={overridden} />);

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://example.com/live",
    );
  });

  it("未开播时显示「未开播」纯文本，且不可点击（非链接）", () => {
    useLiveStatusMock.mockReturnValue({
      status: { living: false, title: null },
    });
    renderWithTheme(<LiveBadge member={members[1]} />);

    expect(screen.getByText("未开播")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("直播标题过长时挂载截断 class（结构断言）", () => {
    const longTitle = "这是一个远远超过截断阈值的非常非常长的直播标题测试用例";
    useLiveStatusMock.mockReturnValue({
      status: { living: true, title: longTitle },
    });
    renderWithTheme(<LiveBadge member={members[2]} />);

    expect(screen.getByRole("link")).toHaveClass(styles.ellipsis);
  });

  it("开播态的截断阈值内短标题不挂截断 class", () => {
    useLiveStatusMock.mockReturnValue({
      status: { living: true, title: "今晚杂谈" },
    });
    renderWithTheme(<LiveBadge member={members[3]} />);

    expect(screen.getByRole("link")).not.toHaveClass(styles.ellipsis);
  });

  it("开播态可见文本以「正在直播：」开头且包含直播标题（AC-2，前缀完整可见）", () => {
    useLiveStatusMock.mockReturnValue({
      status: { living: true, title: "园艺杂谈第 42 期" },
    });
    renderWithTheme(<LiveBadge member={members[0]} />);

    const text = screen.getByRole("link").textContent ?? "";
    expect(text.startsWith("正在直播：")).toBe(true);
    expect(text).toContain("园艺杂谈第 42 期");
  });

  it("开播态主色引用成员代表色 --member-accent，不硬编码全站统一固定色（AC-2 结构断言）", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/components/live-badge.module.css"),
      "utf8",
    );
    const livingBody = ruleBody(css, "living");

    // 背景主色必须来自容器内联的成员代表色
    expect(livingBody).toMatch(/background(?:-color)?:\s*var\(--member-accent\)/);
    // 不得硬编码十六进制色值
    expect(livingBody).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    // 背景不得取固定色板（全站统一红等）
    expect(livingBody).not.toMatch(
      /background(?:-color)?:\s*var\(--mantine-color-/,
    );
  });

  it("徽章圆角不超过 2px（--mantine-radius-xs），避免圆角+overflow 裁切命中区域导致角点点击穿透（R5-2 附带防护）", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/components/live-badge.module.css"),
      "utf8",
    );
    const badgeBody = ruleBody(css, "badge");

    // border-radius 4px + overflow:hidden（ellipsis 必需）会使右下内角 (1,1)
    // 偏移点落在弧外（实测 3/4px → 网格 14/15），2px → 15/15
    expect(badgeBody).toMatch(
      /border-radius:\s*var\(--mantine-radius-xs\)/,
    );
  });
});

describe("直播状态徽章 LiveBadge 指针事件分层（R3 回归防护）", () => {
  it("非交互态关闭指针事件、仅开播态恢复 auto（徽章盒不成为面板点击死区）", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/components/live-badge.module.css"),
      "utf8",
    );
    const badgeBody = ruleBody(css, "badge");
    const livingBody = ruleBody(css, "living");
    const skeletonBody = ruleBody(css, "skeleton");
    const offlineBody = ruleBody(css, "offline");

    // 基础规则关闭指针事件：骨架/未开播态点击穿透到下方面板锚点（§4.3）
    expect(badgeBody).toMatch(/pointer-events:\s*none/);
    // 仅交互态（开播为链接）接管点击，AC-3 不受影响
    expect(livingBody).toMatch(/pointer-events:\s*auto/);
    // 非交互态不得回设 auto
    expect(skeletonBody).not.toMatch(/pointer-events:\s*auto/);
    expect(offlineBody).not.toMatch(/pointer-events:\s*auto/);
  });
});
