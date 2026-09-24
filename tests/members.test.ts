import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { members, type Member } from "@/data/members";

describe("成员数据层 members", () => {
  it("共 4 位成员，顺序严格为绿黑白紫（viridis → komichi → chu2u → sumire）", () => {
    expect(members.map((m) => m.id)).toEqual(["viridis", "komichi", "chu2u", "sumire"]);
  });

  it("mid 为需求文档 §7 确认的 B 站 UID，可与 recording-status.items[].mid 关联", () => {
    expect(members.map((m) => m.mid)).toEqual([
      1891335475, 1512246445, 2138961136, 1150976664,
    ]);
    for (const member of members) expect(member.mid).toBeGreaterThan(0);
  });

  it("四位成员均可携带 roomId 兜底字段；填入时必须为正整数", () => {
    const sample: Member[] = members.map((member, index) =>
      index === 0 ? { ...member, roomId: 1727071052 } : member,
    );
    expect(sample[0]?.roomId).toBe(1727071052);
    for (const member of members) {
      if (member.roomId !== undefined) {
        expect(Number.isInteger(member.roomId)).toBe(true);
        expect(member.roomId).toBeGreaterThan(0);
      }
    }
  });

  it("每位成员的 B 站主页为需求文档 §7 确认的 UID 直链", () => {
    expect(members.map((m) => m.bilibili)).toEqual([
      "https://space.bilibili.com/1891335475",
      "https://space.bilibili.com/1512246445",
      "https://space.bilibili.com/2138961136",
      "https://space.bilibili.com/1150976664",
    ]);
  });

  it("每位成员带需求 §7 的直播状态接口路径 liveStatusUrl（逐值断言，Sumire 无成员名后缀）", () => {
    expect(members.map((m) => m.liveStatusUrl)).toEqual([
      "/api/live/viridis/status",
      "/api/live/komichi/status",
      "/api/live/chu2u/status",
      "/api/live/status",
    ]);
  });

  it("名称、罗马音、称号、简介均非空，立绘路径有效且文件存在于 public/", () => {
    for (const member of members) {
      expect(member.name.length).toBeGreaterThan(0);
      expect(member.romanName.length).toBeGreaterThan(0);
      expect(member.title.length).toBeGreaterThan(0);
      expect(member.description.length).toBeGreaterThan(0);
      expect(member.image.startsWith("/images/members/")).toBe(true);
      const file = path.join(process.cwd(), "public", member.image);
      expect(existsSync(file), `${member.image} 应存在于 public/ 下`).toBe(true);
    }
  });

  it("colorKey 与调色盘键一一对应", () => {
    expect(members.map((m) => m.colorKey)).toEqual([
      "viridis",
      "komichi",
      "chu2u",
      "sumire",
    ]);
  });

  it("名称、称号、简介与设计文档 §2.5 文案逐字一致（AC-6）", () => {
    expect(members.map((m) => m.name)).toEqual(["小松绿", "四时小路", "羽啾", "枝堇"]);
    expect(members.map((m) => m.romanName)).toEqual(["Viridis", "Komichi", "Chu2u", "Sumire"]);
    expect(members.map((m) => m.title)).toEqual([
      "想成为大家互联网盆栽的园艺师",
      "以普通 JK 身份活动的都市传说",
      "来自地球的外星人",
      "老书屋的一株藤蔓",
    ]);
    expect(members.map((m) => m.description)).toEqual([
      "在现实中不太擅长与人交流、常独自上山和花花草草说话的女孩。为了交到朋友、讲述自己喜欢的植物小故事而加入 VirtuaReal。名字取自多肉植物「小松绿」。",
      "凌晨四点的十字路口，变戏法般递出手绘传单的少女。黑发紫瞳、红色大围巾与「禁止通行」路牌是她的标志。VR 史上最速千舰纪录保持者。",
      "以「外星间谍」身份潜伏地球的少女，白发、天线与机能风外套，身边漂浮着绿色方块小生物。兴趣是占卜，公认烂梗大王。",
      "喜欢雨水、雾与破旧纸张的小书店店主。浅紫长发与哥特连衣裙，身缠紫色藤蔓，怀抱一本带刺的书，一边看店一边把妹妹拉扯长大。",
    ]);
  });
});
