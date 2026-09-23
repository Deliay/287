import type { CSSProperties } from "react";
import Image from "next/image";
import type { Member } from "@/data/members";
import { LiveBadge } from "@/components/live-badge";
import styles from "./hero-wall.module.css";

export interface HeroWallProps {
  members: Member[];
}

export function HeroWall({ members }: HeroWallProps) {
  return (
    <section className={styles.wall} aria-label="287 期成员立绘墙">
      {members.map((member) => (
        <a
          key={member.id}
          href={`#member-${member.id}`}
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
          <Image
            src={member.image}
            alt={`${member.name} 立绘`}
            fill
            priority
            sizes="(min-width: 48em) 25vw, 100vw"
            className={styles.art}
          />
          <div className={styles.meta}>
            <LiveBadge member={member} />
            <span className={styles.name}>
              {member.name}
              <span className={styles.roman}>{member.romanName}</span>
            </span>
          </div>
          <span className={styles.bar} />
        </a>
      ))}
    </section>
  );
}
