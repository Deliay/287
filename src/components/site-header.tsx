"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { Burger, Drawer } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { usePathname } from "next/navigation";
import { getLenis } from "@/lib/lenis";
import styles from "./site-header.module.css";

/** 导航项：首页（锚点回顶，对应 `/`）→ 录播（站内路由），顺序与当前页加亮见设计文档 §2.1。 */
const navItems = [
  { label: "首页", href: "#top", match: "/" },
  { label: "录播", href: "/recordings", match: "/recordings" },
];

/**
 * 解析实际 href：首页锚点 `#top` 仅在首页页内回顶；
 * 在其它路由（如 `/recordings`）点「首页」必须导航回 `/`（审核 R3 / AC-8）。
 */
function resolveHref(item: (typeof navItems)[number], pathname: string | null): string {
  if (item.href === "#top" && pathname !== null && pathname !== "/") return "/";
  return item.href;
}

/** 当前页加亮：首页按 `/` 精确匹配；其余按路由**子树**匹配（`/recordings/replay` 也加亮「录播」，审核 R3）。 */
function isActiveFor(item: (typeof navItems)[number], pathname: string | null): boolean {
  if (pathname === null) return false;
  if (item.match === "/") return pathname === "/";
  return pathname === item.match || pathname.startsWith(`${item.match}/`);
}

function renderNavLinks(
  className: string,
  activeClass: string,
  pathname: string | null,
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void,
): ReactNode {
  return navItems.map((item) => {
    const href = resolveHref(item, pathname);
    const isActive = isActiveFor(item, pathname);
    const classes = isActive ? `${className} ${activeClass}` : className;
    const navProps = {
      className: classes,
      onClick: onNavigate,
      ...(isActive ? { "aria-current": "page" as const, "data-active": "true" } : {}),
    };
    // 锚点（首页页内回顶）保留原生 <a>；其余（含跨路由回 `/`）走 next/link
    if (href.startsWith("#")) {
      return (
        <a key={item.label} href={href} {...navProps}>
          {item.label}
        </a>
      );
    }
    return (
      <Link key={item.label} href={href} {...navProps}>
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
