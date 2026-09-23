import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { MemberSection } from "@/components/member-section";
import styles from "@/components/member-section.module.css";
import { members } from "@/data/members";
import { renderWithTheme } from "./utils";

describe("成员介绍区 MemberSection", () => {
  it("渲染成员中文名、罗马音、称号与简介摘要", () => {
    const member = members[0];
    renderWithTheme(<MemberSection member={member} index={0} />);
    const section = screen.getByRole("region", { name: new RegExp(member.name) });
    expect(section.textContent).toContain(member.romanName);
    expect(section.textContent).toContain(member.title);
    expect(section.textContent).toContain(member.description);
  });

  it("渲染指向成员 B 站主页的链接（新标签页）", () => {
    const member = members[1];
    renderWithTheme(<MemberSection member={member} index={1} />);
    const link = screen.getByRole("link", { name: /前往 B 站主页/ });
    expect(link).toHaveAttribute("href", member.bilibili);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
  });

  it("立绘 img 的 alt 含成员名", () => {
    const member = members[2];
    renderWithTheme(<MemberSection member={member} index={2} />);
    expect(screen.getByRole("img").getAttribute("alt")).toContain(member.name);
  });

  it("index 奇偶对应不同的背景 class（287-9 / 287-8 交替）", () => {
    renderWithTheme(
      <>
        <MemberSection member={members[0]} index={0} />
        <MemberSection member={members[3]} index={3} />
      </>,
    );
    const first = screen.getByRole("region", { name: new RegExp(members[0].name) });
    const second = screen.getByRole("region", { name: new RegExp(members[3].name) });
    expect(first).toHaveClass(styles.bgNine);
    expect(second).toHaveClass(styles.bgEight);
  });
});
