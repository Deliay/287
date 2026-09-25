import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { RecordingEntry } from "@/components/recording-entry";
import { members } from "@/data/members";
import { renderWithTheme } from "./utils";

const useLiveStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/live-status", () => ({
  useLiveStatus: useLiveStatusMock,
}));

beforeEach(() => {
  useLiveStatusMock.mockReset();
  // 替换节点只在 LiveBadge 的未开播分支被挂载；此处保持未开播口径便于断言文案
  useLiveStatusMock.mockReturnValue({ status: { living: false, title: null } });
});

describe("未开播录播入口 RecordingEntry（PRD FR-4 · LiveBadge 未开播态的替换节点）", () => {
  it("渲染「未开播，看录播 →」且指向 /recordings?member={id}（AC-8）", () => {
    renderWithTheme(<RecordingEntry member={members[0]} />);

    const link = screen.getByRole("link", { name: "未开播，看录播 →" });
    expect(link).toHaveAttribute("href", `/recordings?member=${members[0].id}`);
  });

  it("文案为右箭头「→」（U+2192），不含 ASCII 的「->」，可读名与可见文案一致", () => {
    renderWithTheme(<RecordingEntry member={members[1]} />);

    const [link] = screen.getAllByRole("link");
    expect(link).toHaveTextContent("未开播，看录播 →");
    expect(link.textContent ?? "").not.toContain("->");
    expect(link).toHaveAccessibleName("未开播，看录播 →");
  });

  it("纯展示节点：不自行订阅直播状态（状态出口在 LiveBadge，避免重复订阅）", () => {
    renderWithTheme(<RecordingEntry member={members[2]} />);

    expect(screen.getByRole("link")).toBeInTheDocument();
    expect(useLiveStatusMock).not.toHaveBeenCalled();
  });
});
