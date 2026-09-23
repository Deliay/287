import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { HeroWall } from "@/components/hero-wall";
import styles from "@/components/hero-wall.module.css";
import { members } from "@/data/members";
import { renderWithTheme } from "./utils";

const BILIBILI_LINKS = [
  "https://space.bilibili.com/1891335475",
  "https://space.bilibili.com/1512246445",
  "https://space.bilibili.com/2138961136",
  "https://space.bilibili.com/1150976664",
];

describe("首屏立绘墙 HeroWall", () => {
  it("按 members 顺序渲染 4 个成员链接（绿黑白紫）", () => {
    renderWithTheme(<HeroWall members={members} />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      BILIBILI_LINKS,
    );
  });

  it("每个成员链接在新标签页打开（target=_blank 且 rel 含 noopener noreferrer）", () => {
    renderWithTheme(<HeroWall members={members} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      const rel = link.getAttribute("rel") ?? "";
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
    }
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
