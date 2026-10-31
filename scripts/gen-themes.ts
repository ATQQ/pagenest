/**
 * 由 src/client/referenceThemes.ts 的实测色生成：
 *  - src/client/styles/reference-themes.css  每个参考站点的完整变量块
 *  - src/client/public/theme-init.js         首屏前恢复主题的脚本
 *
 * 用法：pnpm themes:gen
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { referenceThemes, type ReferenceTheme } from "../src/client/referenceThemes.js";
import { defaultTheme, themeOptions } from "../src/client/themes.js";

type Rgb = [number, number, number];

const root = path.resolve(import.meta.dirname, "..");

const parse = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const hex = (rgb: Rgb) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [parse(a), parse(b)];
  return hex(x.map((c, i) => c + (y[i]! - c) * t) as Rgb);
};
const alpha = (color: string, a: number) => `rgba(${parse(color).join(", ")}, ${a})`;

const luminance = (color: string) => {
  const [r, g, b] = parse(color).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [l, d] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l! + 0.05) / (d! + 0.05);
};

/** 把 ink 朝 surface 方向淡化，取不超过 cap、且对比仍 ≥ target 的最淡一档 */
function fade(ink: string, surface: string, target: number, cap: number) {
  let best = ink;
  for (let t = 0; t <= cap + 1e-9; t += 0.01) {
    const candidate = mix(ink, surface, t);
    if (contrast(candidate, surface) < target) break;
    best = candidate;
  }
  return best;
}

/** 颜色压不住背景时朝 toward 方向推，直到对比达到 target */
function ensure(color: string, surface: string, target: number, toward: string) {
  let out = color;
  for (let t = 0.04; contrast(out, surface) < target && t <= 1; t += 0.04) {
    out = mix(color, toward, t);
  }
  return out;
}

function tokens(theme: ReferenceTheme): Record<string, string> {
  const { bg, ink, link } = theme;
  const dark = theme.kind === "dark";
  const paper = mix(bg, ink, dark ? 0.04 : 0.05);
  const paperDeep = dark ? bg : mix(bg, ink, 0.09);
  const panel = mix(paper, paperDeep, 0.58);
  const surfaceSolid = dark ? mix(bg, ink, 0.07) : bg;
  const sourceBg = mix(bg, ink, dark ? 0.04 : 0.03);
  const accent = dark ? theme.accent : ensure(theme.accent, "#ffffff", 4.5, "#000000");
  const syntaxAccent = ensure(accent, sourceBg, 4.5, dark ? "#ffffff" : "#000000");

  const base: Record<string, string> = {
    "color-scheme": theme.kind,
    "--theme-kind": theme.kind,
    "--paper": paper,
    "--paper-deep": paperDeep,
    "--surface": alpha(surfaceSolid, 0.9),
    "--surface-solid": surfaceSolid,
    "--surface-soft": mix(bg, ink, dark ? 0.11 : 0.05),
    "--reader-bg": bg,
    "--reader-ink": ink,
    "--reader-heading": ink,
    "--reader-link": link,
    "--reader-muted": fade(ink, bg, 5, 0.45),
    "--reader-rule": alpha(ink, 0.14),
    "--reader-code-bg": alpha(ink, dark ? 0.08 : 0.05),
    "--reader-quote-bg": alpha(ink, dark ? 0.05 : 0.03),
    "--text": ink,
    "--text-soft": fade(ink, panel, 7, 0.25),
    "--muted": fade(ink, panel, 5.5, 0.45),
    "--faint": fade(ink, panel, 4.5, 0.6),
    "--line": alpha(ink, 0.12),
    "--line-strong": alpha(ink, 0.22),
    "--accent": accent,
    "--accent-strong": mix(accent, dark ? "#ffffff" : "#000000", 0.18),
    "--accent-soft": mix(bg, accent, dark ? 0.16 : 0.1),
    "--accent-ink": dark ? bg : "#ffffff",
    "--teal": dark ? "#8fb8ac" : "#2f6f5e",
    "--shadow": `0 20px 60px ${alpha(dark ? "#000000" : ink, dark ? 0.5 : 0.09)}`,
    "--shadow-small": `0 8px 24px ${alpha(dark ? "#000000" : ink, dark ? 0.4 : 0.07)}`,
    "--source-bg": sourceBg,
    "--source-gutter": mix(bg, ink, dark ? 0.02 : 0.06),
    "--source-head-bg": mix(bg, ink, dark ? 0.06 : 0.045),
    "--source-active": alpha(ink, 0.04),
    "--source-line": alpha(ink, 0.1),
    "--source-text": ink,
    "--source-text-strong": ink,
    "--source-muted": fade(ink, sourceBg, 5, 0.45),
    "--source-syntax-heading": syntaxAccent,
    "--source-syntax-link": ensure(link, sourceBg, 4.5, dark ? "#ffffff" : "#000000"),
    "--source-syntax-code": ensure(
      mix(accent, ink, 0.5),
      sourceBg,
      4.5,
      dark ? "#ffffff" : "#000000",
    ),
    "--source-syntax-quote": fade(ink, sourceBg, 5, 0.45),
    "--source-syntax-marker": fade(ink, sourceBg, 3, 0.7),
    "--source-code-bg": alpha(ink, dark ? 0.08 : 0.05),
    "--source-caret": accent,
    "--source-search": "rgba(190, 150, 80, 0.22)",
    "--source-search-selected": alpha(accent, 0.2),
    "--selection": alpha(accent, dark ? 0.24 : 0.18),
  };

  if (dark) {
    Object.assign(base, {
      "--accent-fill": mix(bg, accent, 0.16),
      "--accent-fill-ink": accent,
      "--accent-fill-hover": mix(bg, accent, 0.22),
      "--brand-fill": mix(bg, accent, 0.45),
      "--brand-ink": mix(accent, "#ffffff", 0.7),
    });
  }
  return base;
}

const css = [
  "/* 由 scripts/gen-themes.ts 根据 src/client/referenceThemes.ts 生成，请勿手改 */",
  ...referenceThemes.map((theme) => {
    const body = Object.entries(tokens(theme))
      .map(([key, value]) => `  ${key}: ${value};`)
      .join("\n");
    return `\n/* ${theme.label} —— ${theme.group}实测：${theme.bg} 底 · ${theme.ink} 墨 · ${theme.link} 链 */\n:root[data-theme="${theme.id}"] {\n${body}\n}`;
  }),
  "",
].join("\n");

const ids = themeOptions.map((option) => option.value);
const darkIds = themeOptions
  .filter((option) => option.kind === "dark")
  .map((option) => option.value);
const init = `// 由 scripts/gen-themes.ts 生成，请勿手改
(function () {
  var THEMES = ${JSON.stringify(ids)};
  var DARK = ${JSON.stringify(darkIds)};

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeKind = DARK.indexOf(theme) === -1 ? "light" : "dark";
  }

  try {
    var saved = localStorage.getItem("pagenest.ui.v2");
    var legacy = localStorage.getItem("pagenest.ui.v1");
    var value = saved ? JSON.parse(saved) : legacy ? JSON.parse(legacy) : null;
    var theme = value && value.state ? value.state.ui?.theme : value?.ui?.theme;
    apply(THEMES.indexOf(theme) === -1 ? "${defaultTheme}" : theme);
  } catch {
    apply("${defaultTheme}");
  }
})();
`;

writeFileSync(path.join(root, "src/client/styles/reference-themes.css"), css);
writeFileSync(path.join(root, "src/client/public/theme-init.js"), init);
console.log(`generated ${referenceThemes.length} reference themes, ${ids.length} themes total`);
