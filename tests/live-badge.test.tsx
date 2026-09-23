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

describe("直播状态徽章 LiveBadge", () => {
  it("加载中渲染固定高度占位骨架，且不渲染任何链接", () => {
    useLiveStatusMock.mockReturnValue({ status: null });
    renderWithTheme(<LiveBadge member={members[0]} />);

    expect(screen.queryByRole("link")).toBeNull();
    const skeleton = document.querySelector(`.${styles.skeleton}`);
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveClass(styles.badge);
  });

  it("开播时显示直播标题，渲染为指向成员 B 站主页的新标签页链接（AC-2/AC-3）", () => {
    useLiveStatusMock.mockReturnValue({
      status: { living: true, title: "重生之我是钓鱼大师" },
    });
    renderWithTheme(<LiveBadge member={members[0]} />);

    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("重生之我是钓鱼大师");
    expect(link).toHaveAttribute("href", members[0].bilibili);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
    expect(link.getAttribute("aria-label") ?? "").toContain("正在直播");
    expect(link.getAttribute("aria-label") ?? "").toContain(
      members[0].romanName,
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
});

describe("直播状态徽章 LiveBadge 指针事件分层（R3 回归防护）", () => {
  /** 从 CSS 源码取出某条规则的声明体 */
  function ruleBody(css: string, selector: string): string {
    return css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  }

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
