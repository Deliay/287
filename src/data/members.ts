export interface Member {
  id: "viridis" | "komichi" | "chu2u" | "sumire";
  /** 中文名，如「小松绿」 */
  name: string;
  /** 罗马音名，如「Viridis」 */
  romanName: string;
  /** 身份/称号（设计文档 §2.5 副题） */
  title: string;
  /** 介绍区简介摘要（设计文档 §2.5 文案） */
  description: string;
  /** 成员调色盘在 theme.colors 中的键 */
  colorKey: "viridis" | "komichi" | "chu2u" | "sumire";
  /** B 站 UID（即接口字段 `mid`）：录播状态/录播列表按 `mid` 与 recording-status 关联（技术方案 §4.3） */
  mid: number;
  /** 录播房间号兜底：房间归属以 recording-status 的 `mid` 关联为准，仅当接口未返回该成员时使用本字段（可缺省） */
  roomId?: number;
  /** 立绘路径，如 /images/members/viridis.avif */
  image: string;
  /** 立绘hero位置，默认 "50% 0%"，可按成员微调 */
  imagePosition?: string;
  /** 立绘详情页位置，默认 "50% 0%"，可按成员微调 */
  imagePositionDetail?: string;
  /** 移动端立绘hero位置，默认 "50% 0%"，可按成员微调 */
  imagePositionMobileHero?: string;
  /** 移动端详情页立绘位置，默认 "50% 0%"，可按成员微调 */
  imagePositionMobileDetail?: string;
  /** B 站主页 UID 直链 */
  bilibili: string;
}

export const members: Member[] = [
  {
    id: "viridis",
    name: "小松绿",
    romanName: "Viridis",
    title: "想成为大家互联网盆栽的园艺师",
    description:
      "在现实中不太擅长与人交流、常独自上山和花花草草说话的女孩。为了交到朋友、讲述自己喜欢的植物小故事而加入 VirtuaReal。名字取自多肉植物「小松绿」。",
    colorKey: "viridis",
    mid: 1891335475,
    image: "/images/members/viridis.avif",
    imagePosition: "5% -15%",
    imagePositionDetail: "52% 0%",
    imagePositionMobileHero: "-15% 5%",
    imagePositionMobileDetail: "0% 0%",
    bilibili: "https://space.bilibili.com/1891335475",
  },
  {
    id: "komichi",
    name: "四时小路",
    romanName: "Komichi",
    title: "以普通 JK 身份活动的都市传说",
    description:
      "凌晨四点的十字路口，变戏法般递出手绘传单的少女。黑发紫瞳、红色大围巾与「禁止通行」路牌是她的标志。VR 史上最速千舰纪录保持者。",
    colorKey: "komichi",
    mid: 1512246445,
    image: "/images/members/komichi.avif",
    imagePosition: "35% 0%",
    imagePositionDetail: "38% 0%",
    imagePositionMobileHero: "0% 10%",
    imagePositionMobileDetail: "0% 0%",
    bilibili: "https://space.bilibili.com/1512246445",
  },
  {
    id: "chu2u",
    name: "羽啾",
    romanName: "Chu2u",
    title: "来自地球的外星人",
    description:
      "以「外星间谍」身份潜伏地球的少女，白发、天线与机能风外套，身边漂浮着绿色方块小生物。兴趣是占卜，公认烂梗大王。",
    colorKey: "chu2u",
    mid: 2138961136,
    image: "/images/members/chu2u.avif",
    imagePosition: "5% -15%",
    imagePositionDetail: "50% 1%",
    imagePositionMobileHero: "-15% 0%",
    imagePositionMobileDetail: "0% 0%",
    bilibili: "https://space.bilibili.com/2138961136",
  },
  {
    id: "sumire",
    name: "枝堇",
    romanName: "Sumire",
    title: "老书屋的一株藤蔓",
    description:
      "喜欢雨水、雾与破旧纸张的小书店店主。浅紫长发与哥特连衣裙，身缠紫色藤蔓，怀抱一本带刺的书，一边看店一边把妹妹拉扯长大。",
    colorKey: "sumire",
    mid: 1150976664,
    image: "/images/members/sumire.avif",
    imagePosition: "-25% -15%",
    imagePositionDetail: "85% 0%",
    imagePositionMobileHero: "-35% 3%",
    imagePositionMobileDetail: "-50% 0%",
    bilibili: "https://space.bilibili.com/1150976664",
  },
];
