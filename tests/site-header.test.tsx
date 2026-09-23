import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteHeader } from "@/components/site-header";
import { setLenis } from "@/lib/lenis";
import { renderWithTheme } from "./utils";

const { pathHolder } = vi.hoisted(() => ({ pathHolder: { current: "/" as string } }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathHolder.current,
}));

afterEach(() => {
  setLenis(null);
  pathHolder.current = "/";
  vi.restoreAllMocks();
});

function renderHeader(pathname = "/") {
  pathHolder.current = pathname;
  return renderWithTheme(<SiteHeader />);
}

describe("导航栏 SiteHeader（T5 / AC-1）", () => {
  it("PC 导航渲染「首页」「录播」两个链接，「录播」指向 /recordings", () => {
    renderHeader();
    expect(screen.getByText("287 应援站")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "主导航" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["首页", "录播"]);
    expect(within(nav).getByRole("link", { name: "录播" })).toHaveAttribute("href", "/recordings");
  });

  it("Burger 按钮常驻 DOM（视觉显隐由 CSS 控制）", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "导航菜单" })).toBeInTheDocument();
  });

  it("移动端 Drawer 内同样两项；点击「录播」Drawer 关闭且不触发 lenis 回顶", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    setLenis({ scrollTo });
    renderHeader("/");

    await user.click(screen.getByRole("button", { name: "导航菜单" }));
    const dialog = await screen.findByRole("dialog");
    const drawerNav = within(dialog).getByRole("navigation", { name: "移动端导航" });
    expect(within(drawerNav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "首页",
      "录播",
    ]);

    await user.click(within(drawerNav).getByRole("link", { name: "录播" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("当前页导航项加亮（usePathname 为 /recordings 时「录播」带 active 标记）", () => {
    renderHeader("/recordings");
    const nav = screen.getByRole("navigation", { name: "主导航" });
    const recordings = within(nav).getByRole("link", { name: "录播" });
    const home = within(nav).getByRole("link", { name: "首页" });
    expect(recordings).toHaveAttribute("aria-current", "page");
    expect(recordings).toHaveAttribute("data-active", "true");
    expect(recordings.className).toContain("active");
    expect(home).not.toHaveAttribute("data-active", "true");
  });

  it("当前页导航项加亮：pathname=/ 时「首页」项带加亮标记（次要8）", () => {
    renderHeader("/");
    const nav = screen.getByRole("navigation", { name: "主导航" });
    const home = within(nav).getByRole("link", { name: "首页" });
    expect(home).toHaveAttribute("aria-current", "page");
    expect(home).toHaveAttribute("data-active", "true");
    const recordings = within(nav).getByRole("link", { name: "录播" });
    expect(recordings).not.toHaveAttribute("data-active", "true");
  });

  it("R3 非首页路由点「首页」导航回 `/`（回顶仅在首页页内）", () => {
    renderHeader("/recordings");
    const nav = screen.getByRole("navigation", { name: "主导航" });
    const home = within(nav).getByRole("link", { name: "首页" });
    expect(home).toHaveAttribute("href", "/");

    const scrollTo = vi.fn();
    setLenis({ scrollTo });
    fireEvent.click(home);
    // 走路由跳转而非锚点回顶
    expect(scrollTo).not.toHaveBeenCalled();
    expect(home).not.toHaveAttribute("href", "#top");
  });

  it("R3 录播子树（/recordings/replay）加亮「录播」导航项", () => {
    renderHeader("/recordings/replay");
    const nav = screen.getByRole("navigation", { name: "主导航" });
    const recordings = within(nav).getByRole("link", { name: "录播" });
    const home = within(nav).getByRole("link", { name: "首页" });
    expect(recordings).toHaveAttribute("data-active", "true");
    expect(recordings).toHaveAttribute("aria-current", "page");
    expect(home).not.toHaveAttribute("data-active", "true");
  });

  it("点击「首页」回到页面顶部：lenis 可用时走 lenis.scrollTo(0)", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    setLenis({ scrollTo });

    renderHeader("/");
    await user.click(screen.getByRole("link", { name: "首页" }));

    expect(scrollTo).toHaveBeenCalledWith(0);
  });

  it("无 lenis 时「首页」降级为原生平滑滚动回顶", async () => {
    const user = userEvent.setup();
    const nativeScrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});

    renderHeader("/");
    await user.click(screen.getByRole("link", { name: "首页" }));

    expect(nativeScrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
