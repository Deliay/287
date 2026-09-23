import type { CSSProperties } from "react";
import Image from "next/image";
import type { Member } from "@/data/members";
import { LiveBadge } from "@/components/live-badge";
import styles from "./hero-wall.module.css";

export interface HeroWallProps {
  members: Member[];
}

/**
 * 首屏立绘墙（Server Component）。
 * 每格结构：`div.panel` 容器 + 覆盖式 `a.panelLink`（铺满面板，承接面板点击）
 * + meta 区（徽章 + 名字，锚点子树之外）——徽章开播态自身是 `<a>`，
 * 必须与面板锚点保持兄弟关系，杜绝 `<a>` 嵌套 `<a>`（Review P1-1）。
 */
export function HeroWall({ members }: HeroWallProps) {
  return (
    <section className={styles.wall} aria-label="287 期成员立绘墙">
      {members.map((member) => (
        <div
          key={member.id}
          className={styles.panel}
          style={
            {
              "--art-pos": member.imagePosition ?? "50% 0%",
              "--art-pos-mobile": member.imagePositionMobileHero ?? "50% 0%",
              /* 成员色强调均引用主题 token，不硬编码色值 */
              "--member-accent": `var(--mantine-color-${member.colorKey}-6)`,
            } as CSSProperties
          }
        >
          <a
            className={styles.panelLink}
            href={`#member-${member.id}`}
            aria-label={`前往${member.name}介绍区`}
          >
            <Image
              src={member.image}
              alt={`${member.name} 立绘`}
              fill
              priority
              sizes="(min-width: 48em) 25vw, 100vw"
              className={styles.art}
            />
          </a>
          <div className={styles.meta}>
            {/* 徽章槽不接管命中（R4）：与 meta 一起点击穿透到下方覆盖式锚点；
                开播徽章由 live-badge 的 .living 显式 auto 接管点击 */}
            <span className={styles.badgeSlot}>
              <LiveBadge member={member} />
            </span>
            <span className={styles.name}>
              {member.name}
              <span className={styles.roman}>{member.romanName}</span>
            </span>
          </div>
          <span className={styles.bar} />
        </div>
      ))}
    </section>
  );
}
