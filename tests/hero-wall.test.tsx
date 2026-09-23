import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { HeroWall } from "@/components/hero-wall";
import styles from "@/components/hero-wall.module.css";
import { members } from "@/data/members";
import { renderWithTheme } from "./utils";

// 用**真实** LiveBadge 验证嵌套结构（P1-1 回归盲区正是桩组件造成的），
// 只打桩其数据源：四人开播 → 每枚徽章都渲染为外链 <a>
vi.mock("@/lib/live-status", () => ({
  useLiveStatus: (memberId: string) => ({
    status: { living: true, title: `直播中-${memberId}` },
  }),
}));

const ANCHOR_LINKS = [
  "#member-viridis",
  "#member-komichi",
  "#member-chu2u",
  "#member-sumire",
];

/** 站内锚点（面板跳转） */
function panelLinks(): HTMLElement[] {
  return screen
    .getAllByRole("link")
    .filter((link) => (link.getAttribute("href") ?? "").startsWith("#"));
}

/** 开播徽章外链 */
function badgeLinks(): HTMLElement[] {
  return screen
    .getAllByRole("link")
    .filter((link) => (link.getAttribute("href") ?? "").startsWith("http"));
}

describe("首屏立绘墙 HeroWall", () => {
  it("按 members 顺序渲染 4 个站内锚点链接（AC-1，指向介绍区）", () => {
    renderWithTheme(<HeroWall members={members} />);
    expect(panelLinks().map((link) => link.getAttribute("href"))).toEqual(
      ANCHOR_LINKS,
    );
  });

  it("面板锚点不在新标签页打开（移除 target=_blank 与 rel，站内跳转）", () => {
    renderWithTheme(<HeroWall members={members} />);
    for (const link of panelLinks()) {
      expect(link).not.toHaveAttribute("target");
      expect(link).not.toHaveAttribute("rel");
    }
  });

  it("面板内不产生嵌套链接：真实开播徽章外链与面板锚点并存时无 a>a（P1-1 回归）", () => {
    const { container } = renderWithTheme(<HeroWall members={members} />);

    // 前置事实：四枚开播徽章确实是外链，即嵌套风险真实存在
    expect(badgeLinks()).toHaveLength(4);
    expect(container.querySelector("a a")).toBeNull();
  });

  it("每个面板渲染一个直播状态徽章，且位于成员名字上方（AC-2，DOM 顺序断言）", () => {
    const { container } = renderWithTheme(<HeroWall members={members} />);
    const panels = container.querySelectorAll(`.${styles.panel}`);
    expect(panels).toHaveLength(4);

    panels.forEach((panel, index) => {
      const badge = panel.querySelector('a[target="_blank"]');
      const name = panel.querySelector(`.${styles.name}`);
      expect(badge).not.toBeNull();
      expect(name).not.toBeNull();
      expect(badge?.textContent).toContain(`直播中-${members[index].id}`);
      // 名字紧随徽章之后出现（徽章在名字上方）
      const position = badge!.compareDocumentPosition(name!);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it("4 张立绘的 alt 均包含成员中文名", () => {
    renderWithTheme(<HeroWall members={members} />);
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(4);
    images.forEach((image, index) => {
      expect(image.getAttribute("alt")).toContain(members[index].name);
    });
  });

  it("面板容器与覆盖式锚点分别挂载 hover 灰化所需的 CSS class（结构断言）", () => {
    const { container } = renderWithTheme(<HeroWall members={members} />);
    const wall = screen.getByRole("region", { name: "287 期成员立绘墙" });
    expect(wall).toHaveClass(styles.wall);

    const panels = container.querySelectorAll(`.${styles.panel}`);
    expect(panels).toHaveLength(4);
    for (const link of panelLinks()) {
      expect(link).toHaveClass(styles.panelLink);
    }
  });

  it("每面板叠成员名称（中文名 + 罗马音）与代表色指示条，名称始终可读", () => {
    const { container } = renderWithTheme(<HeroWall members={members} />);
    const panels = container.querySelectorAll(`.${styles.panel}`);
    expect(panels).toHaveLength(4);
    panels.forEach((panel, index) => {
      expect(panel.textContent).toContain(members[index].name);
      expect(panel.textContent).toContain(members[index].romanName);
    });
    expect(container.querySelectorAll(`.${styles.bar}`)).toHaveLength(4);
  });
});

describe("首屏立绘墙 HeroWall 层叠结构（R1 回归防护）", () => {
  /** 从 CSS 源码取出某条规则的声明体 */
  function ruleBody(css: string, selector: string): string {
    return css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  }

  it("代表色指示条 .bar 显式声明 z-index 且高于覆盖式锚点 .panelLink（不被立绘遮挡）", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/components/hero-wall.module.css"),
      "utf8",
    );
    const barBody = ruleBody(css, "bar");
    const linkBody = ruleBody(css, "panelLink");

    const barZ = barBody.match(/z-index:\s*(-?\d+)/);
    expect(barZ, ".bar 规则必须显式声明 z-index").not.toBeNull();

    // .panelLink 未设 z-index 时按 0 计（DOM 顺序分层）
    const linkZ = linkBody.match(/z-index:\s*(-?\d+)/);
    expect(Number(barZ![1])).toBeGreaterThan(
      linkZ ? Number(linkZ[1]) : 0,
    );
  });

  it("代表色指示条 .bar 声明 pointer-events: none，条带点击不成为死区（R2 回归防护）", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/components/hero-wall.module.css"),
      "utf8",
    );
    const barBody = ruleBody(css, "bar");

    // .bar 层叠在覆盖式锚点之上：必须关闭指针事件让点击穿透到 a.panelLink
    expect(barBody).toMatch(/pointer-events:\s*none/);
  });

  it("徽章槽 .badgeSlot 不接管命中测试（R4 回归防护：非交互态徽章点击穿透到面板锚点）", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/components/hero-wall.module.css"),
      "utf8",
    );
    const slotBody = ruleBody(css, "badgeSlot");

    // .badgeSlot 整矩形覆盖徽章且位于 meta(z2) 子树：若为 auto 会吞掉
    // 非交互态徽章（computed none 但 paint 序更上层可命中）的点击；
    // 命中链须整条为 none，仅 live-badge 的 .living 显式恢复 auto
    expect(slotBody).toMatch(/pointer-events:\s*none/);
    expect(slotBody).not.toMatch(/pointer-events:\s*auto/);
  });
});
