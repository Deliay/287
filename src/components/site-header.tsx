"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { Burger, Drawer } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { usePathname } from "next/navigation";
import { getLenis } from "@/lib/lenis";
import styles from "./site-header.module.css";

/** 导航项：首页（锚点回顶）→ 录播（站内路由），顺序见设计文档 §2.1。 */
const navItems = [
  { label: "首页", href: "#top" },
  { label: "录播", href: "/recordings" },
];

function renderNavLinks(
  className: string,
  activeClass: string,
  pathname: string | null,
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void,
): ReactNode {
  return navItems.map((item) => {
    // 仅精确匹配当前路径的站内路由加亮（# 锚点不参与）
    const isActive = item.href.startsWith("/") && item.href === pathname;
    const classes = isActive ? `${className} ${activeClass}` : className;
    const navProps = {
      className: classes,
      onClick: onNavigate,
      ...(isActive ? { "aria-current": "page" as const, "data-active": "true" } : {}),
    };
    // 锚点（首页回顶）保留原生 <a>；站内路由走 next/link
    if (item.href.startsWith("#")) {
      return (
        <a key={item.href} href={item.href} {...navProps}>
          {item.label}
        </a>
      );
    }
    return (
      <Link key={item.href} href={item.href} {...navProps}>
        {item.label}
      </Link>
    );
  });
}

export function SiteHeader() {
  const [opened, { toggle, close }] = useDisclosure(false);
  const pathname = usePathname();

  const handleNavClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const href = event.currentTarget.getAttribute("href") ?? "";
    close();
    // 站内路由（/recordings）走普通跳转，不拦截、不回顶
    if (!href.startsWith("#")) return;
    event.preventDefault();
    const lenis = getLenis();
    if (lenis) {
      lenis.scrollTo(0);
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <span className={styles.brand}>287 应援站</span>
        <nav className={styles.nav} aria-label="主导航">
          {renderNavLinks(styles.link, styles.active, pathname, handleNavClick)}
        </nav>
        <div className={styles.burger}>
          <Burger
            opened={opened}
            onClick={toggle}
            aria-label="导航菜单"
            size="sm"
            color="night287.0"
          />
        </div>
      </div>
      <Drawer
        opened={opened}
        onClose={close}
        position="right"
        size="100%"
        styles={{
          content: { backgroundColor: "var(--mantine-color-night287-8)" },
          header: { backgroundColor: "var(--mantine-color-night287-8)" },
          close: { color: "var(--mantine-color-night287-1)" },
        }}
      >
        <nav className={styles.drawerNav} aria-label="移动端导航">
          {renderNavLinks(styles.drawerLink, styles.active, pathname, handleNavClick)}
        </nav>
      </Drawer>
    </header>
  );
}
