import type { Metadata } from "next";
import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from "@mantine/core";
import "@mantine/core/styles.css";
import { theme } from "@/theme";
import { FloatingAudioPlayer } from "@/features/recordings/live-audio/floating-audio-player";
import "./globals.css";

export const metadata: Metadata = {
  title: "287 应援站",
  description: "VirtuaReal 二十八期粉丝站",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" id="top" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="dark">
          {children}
          {/* 悬浮播放组件：root 级挂载，跨路由不卸载（FR-6 / AC-8） */}
          <FloatingAudioPlayer />
        </MantineProvider>
      </body>
    </html>
  );
}
