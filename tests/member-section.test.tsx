import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemberSection } from "@/components/member-section";
import liveBadgeStyles from "@/components/live-badge.module.css";
import styles from "@/components/member-section.module.css";
import { members } from "@/data/members";
import { renderWithTheme } from "./utils";

const useLiveStatusMock = vi.hoisted(() => vi.fn());

// 录播入口为 LiveBadge 未开播态的替换节点，状态出口唯一：只打桩 useLiveStatus，
// LiveBadge / RecordingEntry 均用真实组件断言替换语义（PRD FR-4 返工 R1）
vi.mock("@/lib/live-status", () => ({
  useLiveStatus: useLiveStatusMock,
}));

const OFFLINE = { status: { living: false, title: null } };
const LIVING = { status: { living: true, title: "今晚杂谈" } };
const LOADING = { status: null };

beforeEach(() => {
  useLiveStatusMock.mockReset();
  useLiveStatusMock.mockReturnValue(OFFLINE);
});

describe("成员介绍区 MemberSection", () => {
  it("渲染成员中文名、罗马音、称号与简介摘要", () => {
    const member = members[0];
    renderWithTheme(<MemberSection member={member} index={0} />);
    const section = screen.getByRole("region", { name: new RegExp(member.name) });
    expect(section.textContent).toContain(member.romanName);
    expect(section.textContent).toContain(member.title);
    expect(section.textContent).toContain(member.description);
  });

  it("section 带站内锚点 id（AC-1 锚点目标存在）", () => {
    const member = members[1];
    renderWithTheme(<MemberSection member={member} index={1} />);
    const section = screen.getByRole("region", { name: new RegExp(member.name) });
    expect(section).toHaveAttribute("id", `member-${member.id}`);
  });

  it("详情区挂载直播状态出口，与 LiveBadge 同数据源（AC-5）", () => {
    const member = members[2];
    renderWithTheme(<MemberSection member={member} index={2} />);

    // 未开播：状态出口即录播入口，且位于详情区 section 内
    const link = screen.getByRole("link", { name: "未开播，看录播 →" });
    const section = screen.getByRole("region", { name: new RegExp(member.name) });
    expect(section.contains(link)).toBe(true);
    expect(useLiveStatusMock).toHaveBeenCalledWith(member.id);
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

describe("详情区直播状态三态互斥（PRD FR-4 返工 R1：替换而非并列）", () => {
  it("未开播：只见录播入口，不见「未开播」纯文本，也不见骨架", () => {
    useLiveStatusMock.mockReturnValue(OFFLINE);
    renderWithTheme(<MemberSection member={members[0]} index={0} />);

    expect(
      screen.getByRole("link", { name: "未开播，看录播 →" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("未开播")).toBeNull();
    expect(
      document.querySelector(`.${liveBadgeStyles.skeleton}`),
    ).toBeNull();
  });

  it("开播：只见直播徽章，不见录播入口", () => {
    useLiveStatusMock.mockReturnValue(LIVING);
    renderWithTheme(<MemberSection member={members[1]} index={1} />);

    const badge = screen.getByRole("link", { name: /正在直播/ });
    expect(badge).toHaveTextContent("正在直播：今晚杂谈");
    expect(screen.queryByRole("link", { name: "未开播，看录播 →" })).toBeNull();
    expect(screen.queryByText("未开播")).toBeNull();
  });

  it("加载中：只见占位骨架，录播入口与「未开播」文本均不出现", () => {
    useLiveStatusMock.mockReturnValue(LOADING);
    renderWithTheme(<MemberSection member={members[2]} index={2} />);

    expect(
      document.querySelector(`.${liveBadgeStyles.skeleton}`),
    ).not.toBeNull();
    expect(screen.queryByRole("link", { name: "未开播，看录播 →" })).toBeNull();
    expect(screen.queryByText("未开播")).toBeNull();
  });

  it("详情区仅一次 useLiveStatus 订阅（单一状态出口，避免徽章与入口重复订阅）", () => {
    useLiveStatusMock.mockReturnValue(OFFLINE);
    renderWithTheme(<MemberSection member={members[3]} index={3} />);

    expect(screen.getByRole("link", { name: "未开播，看录播 →" })).toBeInTheDocument();
    expect(useLiveStatusMock).toHaveBeenCalledTimes(1);
    expect(useLiveStatusMock).toHaveBeenCalledWith(members[3].id);
  });
});
