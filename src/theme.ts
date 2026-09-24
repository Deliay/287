import { createTheme, type MantineColorsTuple } from "@mantine/core";

/** 「287」团体调色盘（设计文档 §1.1） */
const night287: MantineColorsTuple = [
  "#f4f3f5",
  "#dedde2",
  "#c4c2cc",
  "#a5a2b0",
  "#888497",
  "#706a81",
  "#5c5670",
  "#454154",
  "#2e2b38",
  "#1c1a22",
];

/** 小松绿 Viridis（设计文档 §1.2） */
const viridis: MantineColorsTuple = [
  "#f7f9f3",
  "#e8efdd",
  "#d6e3c2",
  "#c1d4a2",
  "#adc584",
  "#9cb96a",
  "#8eb056",
  "#6b8441",
  "#47582b",
  "#2b351a",
];

/** 四时小路 Komichi（设计文档 §1.3） */
const komichi: MantineColorsTuple = [
  "#fff0f1",
  "#ffd3d6",
  "#ffafb5",
  "#ff858e",
  "#ff5e69",
  "#ff3d4a",
  "#ff2231",
  "#bf1a25",
  "#801119",
  "#4d0a0f",
];

/** 羽啾 Chu2u（设计文档 §1.4/§6-3 口径：深底**文字**取浅阶 0–2，**强调色块**取 index 6） */
const chu2u: MantineColorsTuple = [
  "#fcfcf6",
  "#f6f8e5",
  "#f0f2cf",
  "#e7ebb6",
  "#e0e49f",
  "#d9de8b",
  "#d4da7b",
  "#9fa45c",
  "#6a6d3e",
  "#404125",
];

/** 枝堇 Sumire（设计文档 §1.5） */
const sumire: MantineColorsTuple = [
  "#faf9fb",
  "#f0edf2",
  "#e4dfe8",
  "#d6cedc",
  "#c8bed0",
  "#bdb1c7",
  "#b4a6bf",
  "#877d8f",
  "#5a5360",
  "#363239",
];

export const theme = createTheme({
  colors: { night287, viridis, komichi, chu2u, sumire },
  primaryColor: "night287",
});
