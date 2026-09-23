import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import Home from "@/app/page";
import heroStyles from "@/components/hero-wall.module.css";
import { members } from "@/data/members";
import { renderWithTheme } from "./utils";

describe("首页组装", () => {
  it("渲染立绘墙 4 项 + 介绍区 4 区，两处成员顺序一致（绿黑白紫）", () => {
    const { container } = renderWithTheme(<Home />);

    const regions = screen.getAllByRole("region");
    expect(regions).toHaveLength(5);

    const [wall] = regions;
    // 面板容器（div）承载成员名，覆盖式锚点只负责跳转（P1-1 返工后结构）
    const panels = container.querySelectorAll(`.${heroStyles.panel}`);
    expect(panels).toHaveLength(4);
    panels.forEach((panel, index) => {
      expect(panel.textContent).toContain(members[index].name);
      expect(panel.textContent).toContain(members[index].romanName);
    });

    const heroLinks = within(wall)
      .getAllByRole("link")
      .filter((link) => (link.getAttribute("href") ?? "").startsWith("#"));
    expect(heroLinks.map((link) => link.getAttribute("href"))).toEqual(
      members.map((member) => `#member-${member.id}`),
    );

    const [, ...sections] = regions;
    sections.forEach((section, index) => {
      expect(section.textContent).toContain(members[index].name);
      expect(section.textContent).toContain(members[index].romanName);
    });
  });
});
