import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import Home from "@/app/page";
import { members } from "@/data/members";
import { renderWithTheme } from "./utils";

describe("首页组装", () => {
  it("渲染立绘墙 4 项 + 介绍区 4 区，两处成员顺序一致（绿黑白紫）", () => {
    renderWithTheme(<Home />);

    const regions = screen.getAllByRole("region");
    expect(regions).toHaveLength(5);

    const [wall, ...sections] = regions;
    const heroNames = within(wall)
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");
    expect(heroNames).toHaveLength(4);

    sections.forEach((section, index) => {
      expect(heroNames[index]).toContain(members[index].name);
      expect(section.textContent).toContain(members[index].name);
      expect(section.textContent).toContain(members[index].romanName);
    });
  });
});
