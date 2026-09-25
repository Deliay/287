import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { RecordingEntry } from "@/components/recording-entry";
import { members } from "@/data/members";
import { renderWithTheme } from "./utils";

const useLiveStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/live-status", () => ({
  useLiveStatus: useLiveStatusMock,
}));

describe("未开播录播入口 RecordingEntry（PRD FR-4）", () => {
  /** 断言组件未渲染任何实际节点（忽略 MantineProvider 注入的 <style>） */
  function expectNoContent(container: HTMLElement): void {
    const nodes = Array.from(container.querySelectorAll("*")).filter(
      (element) => element.tagName.toLowerCase() !== "style",
    );
    expect(nodes).toEqual([]);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("未开播，看录播 ->")).toBeNull();
  }

  it("未开播时渲染「未开播，看录播 ->」且指向 /recordings?member={id}（AC-8）", () => {
    useLiveStatusMock.mockReturnValue({ status: { living: false, title: null } });
    renderWithTheme(<RecordingEntry member={members[0]} />);

    const link = screen.getByRole("link", { name: "未开播，看录播 ->" });
    expect(link).toHaveAttribute("href", `/recordings?member=${members[0].id}`);
  });

  it("开播时不渲染任何内容（AC-8）", () => {
    useLiveStatusMock.mockReturnValue({
      status: { living: true, title: "今晚杂谈" },
    });
    const { container } = renderWithTheme(<RecordingEntry member={members[1]} />);

    expectNoContent(container);
  });

  it("直播状态加载中不渲染任何内容，避免状态闪烁（AC-8）", () => {
    useLiveStatusMock.mockReturnValue({ status: null });
    const { container } = renderWithTheme(<RecordingEntry member={members[2]} />);

    expectNoContent(container);
  });

  it("数据源为共享的 useLiveStatus(member.id)，不新增取数通道（PRD §5 零额外请求）", () => {
    useLiveStatusMock.mockReturnValue({ status: { living: false, title: null } });
    renderWithTheme(<RecordingEntry member={members[3]} />);

    expect(useLiveStatusMock).toHaveBeenCalledTimes(1);
    expect(useLiveStatusMock).toHaveBeenCalledWith(members[3].id);
  });
});
