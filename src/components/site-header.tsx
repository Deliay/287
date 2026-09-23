"use client";

import type { MouseEvent } from "react";
import { Burger, Drawer } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { getLenis } from "@/lib/lenis";
import styles from "./site-header.module.css";

const navItems = [{ label: "首页", href: "#top" }];

function renderNavLinks(className: string, onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void) {
  return navItems.map((item) => (
    <a key={item.href} href={item.href} className={className} onClick={onNavigate}>
      {item.label}
    </a>
  ));
}

export function SiteHeader() {
  const [opened, { toggle, close }] = useDisclosure(false);

  const handleNavClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    close();
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
          {renderNavLinks(styles.link, handleNavClick)}
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
          {renderNavLinks(styles.drawerLink, handleNavClick)}
        </nav>
      </Drawer>
    </header>
  );
}
