import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { HeroWall } from "@/components/hero-wall";
import styles from "@/components/hero-wall.module.css";
import { members } from "@/data/members";
import { renderWithTheme } from "./utils";

// LiveBadge 由 tests/live-badge.test.tsx 单独覆盖，此处用桩组件断言装配关系
vi.mock("@/components/live-badge", () => ({
  LiveBadge: ({ member }: { member: { id: string } }) => (
    <span data-testid="live-badge" data-member-id={member.id} />
  ),
}));

const ANCHOR_LINKS = [
  "#member-viridis",
  "#member-komichi",
  "#member-chu2u",
  "#member-sumire",
];

describe("首屏立绘墙 HeroWall", () => {
  it("按 members 顺序渲染 4 个站内锚点链接（AC-1，指向介绍区）", () => {
    renderWithTheme(<HeroWall members={members} />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      ANCHOR_LINKS,
    );
  });

  it("成员链接不在新标签页打开（移除 target=_blank 与 rel，站内跳转）", () => {
    renderWithTheme(<HeroWall members={members} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("target");
      expect(link).not.toHaveAttribute("rel");
    }
  });

  it("每个面板渲染一个直播状态徽章，且位于成员名字上方（AC-2，DOM 顺序断言）", () => {
    renderWithTheme(<HeroWall members={members} />);
    const badges = screen.getAllByTestId("live-badge");
    expect(badges).toHaveLength(4);

    const links = screen.getAllByRole("link");
    badges.forEach((badge, index) => {
      expect(badge).toHaveAttribute("data-member-id", members[index].id);
      const name = links[index].querySelector(`.${styles.name}`);
      expect(name).not.toBeNull();
      // 名字紧随徽章之后出现（徽章在名字上方）
      const position = badge.compareDocumentPosition(name as Node);
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

  it("容器与每项挂载 hover 灰化所需的 CSS class（结构断言）", () => {
    renderWithTheme(<HeroWall members={members} />);
    const wall = screen.getByRole("region", { name: "287 期成员立绘墙" });
    expect(wall).toHaveClass(styles.wall);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveClass(styles.panel);
    }
  });

  it("每项叠成员名称（中文名 + 罗马音）与代表色指示条，名称始终可读", () => {
    const { container } = renderWithTheme(<HeroWall members={members} />);
    const links = screen.getAllByRole("link");
    links.forEach((link, index) => {
      expect(link.textContent).toContain(members[index].name);
      expect(link.textContent).toContain(members[index].romanName);
    });
    expect(container.querySelectorAll(`.${styles.bar}`)).toHaveLength(4);
  });
});
