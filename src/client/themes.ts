import type { IconName } from "./components/Icon";
import { referenceThemes, type ReferenceTheme, type ReferenceThemeId } from "./referenceThemes";

export type CoreThemeId =
  "paper" | "sepia" | "white" | "eye" | "douchi" | "night" | "dark" | "amoled";

export type ThemeId = CoreThemeId | ReferenceThemeId;

export type ThemeKind = "light" | "dark";

export interface ThemeOption {
  value: ThemeId;
  label: string;
  description: string;
  icon: IconName;
  kind: ThemeKind;
  group: string;
  /** [底色, 强调色]，用于菜单里的色块 */
  swatch: [string, string];
}

const coreThemeOptions: ThemeOption[] = [
  {
    value: "paper",
    label: "纸页",
    description: "温暖米白",
    icon: "sun",
    kind: "light",
    group: "纸感阅读",
    swatch: ["#fbf8f2", "#9a472c"],
  },
  {
    value: "sepia",
    label: "羊皮纸",
    description: "旧书米黄",
    icon: "book",
    kind: "light",
    group: "纸感阅读",
    swatch: ["#f5ead4", "#8b4326"],
  },
  {
    value: "white",
    label: "纯白",
    description: "中性高亮",
    icon: "contrast",
    kind: "light",
    group: "纸感阅读",
    swatch: ["#ffffff", "#9c3f1c"],
  },
  {
    value: "eye",
    label: "护眼",
    description: "柔和草绿",
    icon: "leaf",
    kind: "light",
    group: "护眼柔和",
    swatch: ["#eaf1e5", "#3d6b4a"],
  },
  {
    value: "douchi",
    label: "豆沙",
    description: "中性米灰",
    icon: "cup",
    kind: "light",
    group: "护眼柔和",
    swatch: ["#eceae0", "#7d5030"],
  },
  {
    value: "night",
    label: "夜读",
    description: "暖调低亮",
    icon: "moon",
    kind: "dark",
    group: "夜间模式",
    swatch: ["#1a1815", "#c98a63"],
  },
  {
    value: "dark",
    label: "墨夜",
    description: "中性深灰",
    icon: "contrast",
    kind: "dark",
    group: "夜间模式",
    swatch: ["#16171b", "#7fa8d4"],
  },
  {
    value: "amoled",
    label: "纯黑",
    description: "OLED 真黑",
    icon: "display",
    kind: "dark",
    group: "夜间模式",
    swatch: ["#000000", "#7fb2e8"],
  },
];

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastLabel(a: string, b: string): string {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return `对比 ${((light! + 0.05) / (dark! + 0.05)).toFixed(1)}:1`;
}

const referenceThemeOptions: ThemeOption[] = referenceThemes.map(
  (theme: ReferenceTheme & { id: ReferenceThemeId }) => ({
    value: theme.id,
    label: theme.label,
    description: contrastLabel(theme.bg, theme.ink),
    icon: theme.kind === "dark" ? "moon" : theme.group === "文档站" ? "display" : "book",
    kind: theme.kind,
    group: `${theme.group}配色`,
    swatch: [theme.bg, theme.accent],
  }),
);

export const themeOptions: ThemeOption[] = [...coreThemeOptions, ...referenceThemeOptions];

export const themeIds: ThemeId[] = themeOptions.map((option) => option.value);

export const defaultTheme: ThemeId = "paper";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (themeIds as string[]).includes(value);
}

export function themeKindOf(theme: ThemeId): ThemeKind {
  return themeOptions.find((option) => option.value === theme)?.kind ?? "light";
}
