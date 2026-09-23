import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { HeroWall } from "@/components/hero-wall";
import { MemberSection } from "@/components/member-section";
import { members } from "@/data/members";
import { renderWithTheme } from "./utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("直播状态缓存共享（AC-5 集成回归，Review P2-3）", () => {
  it("HeroWall + 4×MemberSection 同页 8 枚徽章只发 4 次请求，同成员状态一致", async () => {
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

    // 8 枚徽章（首屏 4 + 介绍区 4）全部完成加载并渲染未开播态
    const badges = await screen.findAllByText("未开播");
    expect(badges).toHaveLength(8);

    // 每成员只请求一次，且地址为成员的 liveStatusUrl（非开发态直连）
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(
      members.map((member) => `https://api.sumire.live${member.liveStatusUrl}`),
    );
  });
});
