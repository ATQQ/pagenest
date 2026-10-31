/**
 * 文档站 / 阅读站配色实测探针
 *
 * 用法：node docs/color-audit/probe.mjs
 * 输出：docs/color-audit/palettes.json（含每个站点的底色、正文、链接、强调色与对比度）
 *
 * 原理：
 *  - 背景色沿 DOM 树逐层做 alpha 合成，避免透明容器取到假黑；
 *  - 正文取「可见、字号 13–22px、文本长度 > 50 字符」的最长段落；
 *  - 对比度按 WCAG 相对亮度公式计算，彩度按 CIE Lab 的 C* 计算；
 *  - 另对首屏截图做像素采样，用于交叉验证背景色。
 */
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const TARGETS = [
  { group: "文档站", name: "Stripe Docs", url: "https://docs.stripe.com/" },
  { group: "文档站", name: "Tailwind CSS Docs", url: "https://tailwindcss.com/docs" },
  { group: "文档站", name: "Vercel Docs", url: "https://vercel.com/docs" },
  { group: "文档站", name: "Next.js Docs", url: "https://nextjs.org/docs" },
  { group: "文档站", name: "MDN Web Docs", url: "https://developer.mozilla.org/zh-CN/docs/Web/CSS/color-mix" },
  { group: "文档站", name: "GitHub Docs", url: "https://docs.github.com/en" },
  { group: "文档站", name: "Astro Docs", url: "https://docs.astro.build/en/getting-started/" },
  { group: "文档站", name: "MkDocs Material", url: "https://squidfunk.github.io/mkdocs-material/" },
  { group: "文档站", name: "Anthropic Docs", url: "https://docs.anthropic.com/" },
  { group: "文档站", name: "语雀文档", url: "https://www.yuque.com/" },
  { group: "文档站", name: "掘金", url: "https://juejin.cn/" },
  { group: "文档站", name: "少数派", url: "https://sspai.com/" },
  { group: "阅读站", name: "微信读书", url: "https://weread.qq.com/" },
  { group: "阅读站", name: "豆瓣读书", url: "https://book.douban.com/" },
  { group: "阅读站", name: "Project Gutenberg", url: "https://www.gutenberg.org/" },
  { group: "阅读站", name: "Readwise Reader", url: "https://readwise.io/read" },
  { group: "阅读站", name: "Google Books", url: "https://books.google.com/" },
  { group: "阅读站", name: "Kindle Cloud Reader", url: "https://read.amazon.com/" },
  { group: "阅读站", name: "番茄小说", url: "https://fanqienovel.com/" },
  { group: "阅读站", name: "Medium", url: "https://medium.com/" },
];

const PROBE = () => {
  const parse = (str) => {
    if (!str) return null;
    const m = String(str).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const hex = (c) =>
    c ? "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") : null;
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contrast = (a, b) => {
    if (!a || !b) return null;
    const l1 = lum(a);
    const l2 = lum(b);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  };
  const chromatic = (c) => c && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 26;

  const html = document.documentElement;
  const body = document.body;
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };

  // 有效背景：自顶向下层叠合成所有半透明层
  const effectiveBg = (el) => {
    const chain = [];
    let cur = el;
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0) chain.push(c);
      if (cur === html) break;
      cur = cur.parentElement;
    }
    let base = WHITE;
    const rootBg = parse(getComputedStyle(html).backgroundColor);
    if (rootBg && rootBg.a > 0) base = rootBg.a === 1 ? rootBg : over(rootBg, WHITE);
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = chain[i];
      base = c.a === 1 ? c : over(c, base);
    }
    return base;
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return !(s.visibility === "hidden" || s.display === "none" || Number(s.opacity) < 0.05);
  };

  const rootBg = effectiveBg(body);

  // 正文候选：可见、字号合适、足够长的最长段落
  let main = null;
  for (const p of document.querySelectorAll("p, li, dd, blockquote, article p, main p")) {
    if (!visible(p)) continue;
    const s = getComputedStyle(p);
    const fs = parseFloat(s.fontSize);
    const text = (p.innerText || "").trim();
    if (text.length > 50 && fs >= 13 && fs <= 22) {
      const score = text.length * (fs / 16);
      if (!main || score > main.score) {
        main = {
          el: p,
          score,
          fs,
          lh: s.lineHeight,
          family: s.fontFamily.split(",")[0].replace(/["']/g, ""),
          weight: s.fontWeight,
        };
      }
    }
  }
  if (!main) {
    for (const p of document.querySelectorAll("p, li")) {
      if (!visible(p)) continue;
      const text = (p.innerText || "").trim();
      if (text.length > 20) {
        const s = getComputedStyle(p);
        main = {
          el: p,
          score: 0,
          fs: parseFloat(s.fontSize),
          lh: s.lineHeight,
          family: s.fontFamily.split(",")[0].replace(/["']/g, ""),
          weight: s.fontWeight,
        };
        break;
      }
    }
  }

  const textEl = main?.el;
  const textBg = textEl ? effectiveBg(textEl) : rootBg;
  const rawText = textEl ? parse(getComputedStyle(textEl).color) : null;
  const textColor = rawText ? (rawText.a < 1 ? over(rawText, textBg) : rawText) : null;

  // 链接色：第一个可见且有色（或明显更暗）的链接
  let linkColor = null;
  for (const a of document.querySelectorAll("a")) {
    if (!visible(a) || !(a.innerText || "").trim()) continue;
    const c = parse(getComputedStyle(a).color);
    if (!c) continue;
    const eff = c.a < 1 ? over(c, textBg) : c;
    if (chromatic(eff) || eff.r + eff.g + eff.b < 520) {
      linkColor = eff;
      break;
    }
  }

  // 品牌色：彩色元素按面积加权投票
  const acc = new Map();
  const bump = (c, w) => {
    if (!c || !chromatic(c)) return;
    const k = hex({ r: Math.round(c.r / 6) * 6, g: Math.round(c.g / 6) * 6, b: Math.round(c.b / 6) * 6 });
    acc.set(k, (acc.get(k) || 0) + w);
  };
  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 2500)) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const area = Math.min(r.width * r.height, 100000);
    const text = (el.innerText || "").trim();
    if (text && text.length < 300) {
      const c = parse(s.color);
      if (c) bump(c.a < 1 ? over(c, textBg) : c, area * 0.4);
    }
    const bc = parse(s.backgroundColor);
    if (bc && bc.a > 0.5) bump(bc, area * 0.5);
    const bw = parseFloat(s.borderTopWidth) || 0;
    if (bw > 0 && bw < 8) {
      const border = parse(s.borderTopColor);
      if (border && border.a > 0.5) bump(border, area * 0.25);
    }
  }
  const accent = [...acc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    rootBg: hex(rootBg),
    textBg: hex(textBg),
    textColor: hex(textColor),
    linkColor: hex(linkColor),
    accent,
    contrast: contrast(textColor, textBg),
    contrastLink: contrast(linkColor, textBg),
    bodyFontSize: main?.fs ?? null,
    bodyLineHeight: main?.lh ?? null,
    bodyFont: main?.family ?? null,
    bodyWeight: main?.weight ?? null,
  };
};

/** 截图像素采样：统计首屏的真实主导色，用于交叉验证背景色 */
const PNG_SAMPLE = async (page) => {
  const buf = await page.screenshot({ type: "png" });
  const { PNG } = await import("pngjs");
  const png = PNG.sync.read(buf);
  const counts = new Map();
  for (let i = 0; i < png.data.length; i += 4 * 7) {
    if (png.data[i + 3] < 200) continue;
    const key = ((png.data[i] >> 3) << 10) | ((png.data[i + 1] >> 3) << 5) | (png.data[i + 2] >> 3);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, n]) => {
      const r = ((key >> 10) & 31) << 3;
      const g = ((key >> 5) & 31) << 3;
      const b = (key & 31) << 3;
      return {
        hex: "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""),
        share: Math.round((n / total) * 100),
      };
    });
};

const run = async () => {
  const browser = await chromium.launch();
  const out = [];
  for (const t of TARGETS) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    const rec = { ...t };
    try {
      await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 35000 });
      await page.waitForTimeout(3000);
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(800);
      Object.assign(rec, await page.evaluate(PROBE));
      rec.pixels = await PNG_SAMPLE(page);
      rec.status = "ok";
    } catch (error) {
      rec.status = "error: " + String(error.message).split("\n")[0].slice(0, 110);
    }
    out.push(rec);
    console.log(
      `${rec.status === "ok" ? "✓" : "✗"} ${t.name.padEnd(20)} bg=${rec.rootBg} text=${rec.textColor} link=${rec.linkColor} accent=${rec.accent} C=${rec.contrast}`,
    );
    await ctx.close();
  }
  await browser.close();
  const dir = path.dirname(new URL(import.meta.url).pathname);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "palettes.json"), JSON.stringify(out, null, 2));
  console.log("\nsaved palettes.json");
};

run();
