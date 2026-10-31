/**
 * 参考站点主题：用 docs/color-audit/verify.mjs 在各站点的真实文章页实测（2026-10-29）。
 * bg / ink / link 取自正文段落及段内链接；accent 是官网首页的品牌主题色（logo、meta theme-color、主按钮）。
 * 改完这里运行 `pnpm themes:gen` 重新生成 reference-themes.css 与 theme-init.js。
 */
export interface ReferenceTheme {
  id: string;
  label: string;
  group: "文档站" | "阅读站";
  kind: "light" | "dark";
  bg: string;
  ink: string;
  link: string;
  /** 站点品牌主题色，用于按钮与选中态；白字压不住时生成脚本会自动加深 */
  accent: string;
}

export const referenceThemes = [
  // github.com README 正文；品牌色是黑色（logo、theme-color、Sign up），正文链接是蓝色
  {
    id: "github",
    label: "GitHub",
    group: "文档站",
    kind: "light",
    bg: "#ffffff",
    ink: "#1f2328",
    link: "#0969da",
    accent: "#1f2328",
  },
  {
    id: "astro",
    label: "Astro",
    group: "文档站",
    kind: "light",
    bg: "#ffffff",
    ink: "#353841",
    link: "#3d50f5",
    accent: "#8d46e7",
  },
  {
    id: "vercel",
    label: "Vercel",
    group: "文档站",
    kind: "light",
    bg: "#ffffff",
    ink: "#4d4d4d",
    link: "#171717",
    accent: "#171717",
  },
  {
    id: "mkdocs",
    label: "MkDocs Material",
    group: "文档站",
    kind: "light",
    bg: "#ffffff",
    ink: "#212121",
    link: "#4051b5",
    accent: "#4051b5",
  },
  // docs.anthropic.com 已迁到 platform.claude.com；品牌色取 Claude logo 的陶土橙
  {
    id: "anthropic",
    label: "Claude Docs",
    group: "文档站",
    kind: "light",
    bg: "#fcfcfb",
    ink: "#52514e",
    link: "#184f95",
    accent: "#d97757",
  },
  {
    id: "stripe",
    label: "Stripe",
    group: "文档站",
    kind: "light",
    bg: "#ffffff",
    ink: "#3c4257",
    link: "#5469d4",
    accent: "#533afd",
  },
  // 正文是 #171717 叠 90% 不透明度，合成到 #fafafa 上的结果
  {
    id: "nextjs",
    label: "Next.js",
    group: "文档站",
    kind: "light",
    bg: "#fafafa",
    ink: "#2e2e2e",
    link: "#171717",
    accent: "#171717",
  },
  {
    id: "mdn",
    label: "MDN",
    group: "文档站",
    kind: "light",
    bg: "#ffffff",
    ink: "#000000",
    link: "#044c9f",
    accent: "#1b1b1b",
  },
  {
    id: "yuque",
    label: "语雀",
    group: "文档站",
    kind: "light",
    bg: "#ffffff",
    ink: "#262626",
    link: "#117cee",
    accent: "#00b96b",
  },
  {
    id: "sspai",
    label: "少数派",
    group: "阅读站",
    kind: "light",
    bg: "#ffffff",
    ink: "#000000",
    link: "#0097ff",
    accent: "#da282a",
  },
  {
    id: "gutenberg",
    label: "Gutenberg",
    group: "阅读站",
    kind: "light",
    bg: "#ffffff",
    ink: "#000000",
    link: "#0000ff",
    accent: "#427e94",
  },
  {
    id: "douban",
    label: "豆瓣读书",
    group: "阅读站",
    kind: "light",
    bg: "#ffffff",
    ink: "#111111",
    link: "#3377aa",
    accent: "#007722",
  },
  // 阅读页正文里没有链接，链接沿用正文色，强调色取页面上的品牌橙
  {
    id: "fanqie",
    label: "番茄小说",
    group: "阅读站",
    kind: "light",
    bg: "#f2f2f2",
    ink: "#252525",
    link: "#252525",
    accent: "#fa6725",
  },
  {
    id: "v2ex",
    label: "V2EX",
    group: "阅读站",
    kind: "light",
    bg: "#ffffff",
    ink: "#000000",
    link: "#778087",
    accent: "#333344",
  },
] as const satisfies readonly ReferenceTheme[];

export type ReferenceThemeId = (typeof referenceThemes)[number]["id"];
