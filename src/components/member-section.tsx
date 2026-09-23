import type { CSSProperties } from "react";
import Image from "next/image";
import type { Member } from "@/data/members";
import styles from "./member-section.module.css";

export interface MemberSectionProps {
  member: Member;
  index: number;
}

export function MemberSection({ member, index }: MemberSectionProps) {
  const headingId = `member-${member.id}-heading`;

  return (
    <section
      className={`${styles.section} ${
        index % 2 === 0 ? styles.bgNine : styles.bgEight
      }`}
      aria-labelledby={headingId}
      style={
        {
          "--art-pos": member.imagePosition ?? "50% 0%",
          /* 成员色强调均引用主题 token，不硬编码色值 */
          "--member-accent": `var(--mantine-color-${member.colorKey}-6)`,
          "--member-heading": `var(--mantine-color-${member.colorKey}-2)`,
        } as CSSProperties
      }
    >
      <div className={styles.figure}>
        <Image
          src={member.image}
          alt={`${member.name} 立绘`}
          fill
          sizes="(min-width: 48em) 40vw, 100vw"
          className={styles.art}
        />
      </div>
      <div className={styles.content}>
        <h2 id={headingId} className={styles.name}>
          {member.name}
          <span className={styles.roman}>{member.romanName}</span>
        </h2>
        <p className={styles.subtitle}>{member.title}</p>
        <p className={styles.description}>{member.description}</p>
        <a
          className={styles.cta}
          href={member.bilibili}
          target="_blank"
          rel="noopener noreferrer"
        >
          前往 B 站主页 →
        </a>
      </div>
    </section>
  );
}
