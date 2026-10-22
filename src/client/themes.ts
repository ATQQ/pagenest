import type { IconName } from "./components/Icon";

export type ThemeId = "paper" | "sepia" | "white" | "eye" | "douchi" | "night" | "dark" | "amoled";

export type ThemeKind = "light" | "dark";

export interface ThemeOption {
  value: ThemeId;
  label: string;
  description: string;
  icon: IconName;
  kind: ThemeKind;
  group: string;
}

export const themeOptions: ThemeOption[] = [
  {
    value: "paper",
    label: "纸页",
    description: "温暖米白",
    icon: "sun",
    kind: "light",
    group: "纸感阅读",
  },
  {
    value: "sepia",
    label: "羊皮纸",
    description: "旧书米黄",
    icon: "book",
    kind: "light",
    group: "纸感阅读",
  },
  {
    value: "white",
    label: "纯白",
    description: "中性高亮",
    icon: "contrast",
    kind: "light",
    group: "纸感阅读",
  },
  {
    value: "eye",
    label: "护眼",
    description: "柔和草绿",
    icon: "leaf",
    kind: "light",
    group: "护眼柔和",
  },
  {
    value: "douchi",
    label: "豆沙",
    description: "中性米灰",
    icon: "cup",
    kind: "light",
    group: "护眼柔和",
  },
  {
    value: "night",
    label: "夜读",
    description: "暖调低亮",
    icon: "moon",
    kind: "dark",
    group: "夜间模式",
  },
  {
    value: "dark",
    label: "墨夜",
    description: "中性深灰",
    icon: "contrast",
    kind: "dark",
    group: "夜间模式",
  },
  {
    value: "amoled",
    label: "纯黑",
    description: "OLED 真黑",
    icon: "display",
    kind: "dark",
    group: "夜间模式",
  },
];

export const themeIds: ThemeId[] = themeOptions.map((option) => option.value);

export const defaultTheme: ThemeId = "paper";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (themeIds as string[]).includes(value);
}

export function themeKindOf(theme: ThemeId): ThemeKind {
  return themeOptions.find((option) => option.value === theme)?.kind ?? "light";
}
