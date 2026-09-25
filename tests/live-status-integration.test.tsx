import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { HeroWall } from "@/components/hero-wall";
import { MemberSection } from "@/components/member-section";
import { members } from "@/data/members";
import { renderWithTheme } from "./utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("直播状态缓存共享（AC-5 集成回归，Review P2-3 · FR-4 返工 R1）", () => {
  it("HeroWall 4 个「未开播」+ 详情区 4 个录播入口，全页仍只发 4 次请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: { live: false } }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(
      <>
        <HeroWall members={members} />
        {members.map((member, index) => (
          <MemberSection key={member.id} member={member} index={index} />
        ))}
      </>,
    );

    // HeroWall 4 枚徽章渲染未开播纯文本（AC-3 不回归；FR-4 仅覆盖详情区）
    const heroBadges = await screen.findAllByText("未开播");
    expect(heroBadges).toHaveLength(4);

    // 详情区 4 个录播入口**替换**「未开播」文本（FR-4 返工 R1：同一位置二选一，不并列）
    const entries = await screen.findAllByRole("link", {
      name: "未开播，看录播 →",
    });
    expect(entries).toHaveLength(4);
    expect(entries.map((entry) => entry.getAttribute("href"))).toEqual(
      members.map((member) => `/recordings?member=${member.id}`),
    );
    expect(document.body.textContent ?? "").not.toContain("未开播，看录播 ->");

    // 每成员只请求一次（入口替换不引入额外请求），地址为成员的 liveStatusUrl（非开发态直连）
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(
      members.map((member) => `https://api.sumire.live${member.liveStatusUrl}`),
    );
  });
});
