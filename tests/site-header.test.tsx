import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteHeader } from "@/components/site-header";
import { setLenis } from "@/lib/lenis";
import { renderWithTheme } from "./utils";

afterEach(() => {
  setLenis(null);
  vi.restoreAllMocks();
});

describe("导航栏 SiteHeader", () => {
  it("渲染站点名「287 应援站」，导航链接仅「首页」一项", () => {
    renderWithTheme(<SiteHeader />);
    expect(screen.getByText("287 应援站")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "首页" })).toBeInTheDocument();
  });

  it("Burger 按钮常驻 DOM（视觉显隐由 CSS 控制）", () => {
    renderWithTheme(<SiteHeader />);
    expect(screen.getByRole("button", { name: "导航菜单" })).toBeInTheDocument();
  });

  it("点击 Burger 展开 Drawer（内含「首页」），点击抽屉内「首页」后收起", async () => {
    const user = userEvent.setup();
    renderWithTheme(<SiteHeader />);

    await user.click(screen.getByRole("button", { name: "导航菜单" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "首页" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("link", { name: "首页" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("点击「首页」回到页面顶部：lenis 可用时走 lenis.scrollTo(0)", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    setLenis({ scrollTo });

    renderWithTheme(<SiteHeader />);
    await user.click(screen.getByRole("link", { name: "首页" }));

    expect(scrollTo).toHaveBeenCalledWith(0);
  });

  it("无 lenis 时「首页」降级为原生平滑滚动回顶", async () => {
    const user = userEvent.setup();
    const nativeScrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});

    renderWithTheme(<SiteHeader />);
    await user.click(screen.getByRole("link", { name: "首页" }));

    expect(nativeScrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
