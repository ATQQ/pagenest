/**
 * 参考主题核对：打开每个站点的真实文章页，只在正文容器内取色。
 *
 * 用法：node docs/color-audit/verify.mjs [站点 id ...]
 * 输出：逐站打印取色结果，截图在 .tmp/verify/
 *
 * 与 probe.mjs 的区别：
 *  - 进入文章页而不是首页（首页需要跳转的，从首页找第一篇文章链接）；
 *  - 正文、链接、标题都限定在 article / main 等正文容器里；
 *  - 额外记录实心按钮的底色，作为界面强调色的候选。
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const TARGETS = [
  {
    id: "github",
    url: "https://docs.github.com/en/get-started/start-your-journey/about-github-and-git",
  },
  { id: "github-repo", url: "https://github.com/microsoft/vscode" },
  { id: "astro", url: "https://docs.astro.build/en/concepts/why-astro/" },
  { id: "vercel", url: "https://vercel.com/docs/getting-started-with-vercel" },
  { id: "mkdocs", url: "https://squidfunk.github.io/mkdocs-material/getting-started/" },
  { id: "anthropic", url: "https://docs.anthropic.com/en/docs/intro-to-claude" },
  { id: "stripe", url: "https://docs.stripe.com/payments/checkout" },
  { id: "nextjs", url: "https://nextjs.org/docs/app/getting-started/installation" },
  { id: "mdn", url: "https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix" },
  {
    id: "yuque",
    url: "https://www.yuque.com/yuque/changelog",
    follow: 'a[href*="/yuque/changelog/"]',
  },
  { id: "sspai", url: "https://sspai.com/", follow: 'a[href*="/post/"]' },
  { id: "gutenberg", url: "https://www.gutenberg.org/cache/epub/1342/pg1342-images.html" },
  { id: "douban", url: "https://book.douban.com/", follow: 'a[href*="/review/"]' },
  {
    id: "fanqie",
    url: "https://fanqienovel.com/",
    follow: 'a[href*="/page/"]',
    then: 'a[href*="/reader/"]',
  },
  { id: "v2ex", url: "https://www.v2ex.com/", follow: 'a[href^="/t/"]' },
];

const PROBE = () => {
  const parse = (str) => {
    const m = String(str || "").match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]
      .split(/[,\s/]+/)
      .filter(Boolean)
      .map(parseFloat);
    return p.length < 3 ? null : { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const hex = (c) =>
    c
      ? "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")
      : null;
  const effectiveBg = (el) => {
    const chain = [];
    for (let cur = el; cur; cur = cur.parentElement) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0) chain.push(c);
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = chain.length - 1; i >= 0; i--)
      base = chain[i].a === 1 ? chain[i] : over(chain[i], base);
    return base;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 4 && r.height > 4 && s.visibility !== "hidden" && s.display !== "none";
  };
  const colorOf = (el, bg) => {
    const c = parse(getComputedStyle(el).color);
    return c && c.a < 1 ? over(c, bg) : c;
  };

  let para = null;
  for (const p of document.querySelectorAll(
    "p, .topic_content, .reply_content, .ne-p, .ne-viewer-body div",
  )) {
    if (!visible(p) || p.closest("nav, header, footer, aside")) continue;
    const len = (p.innerText || "").trim().length;
    const fs = parseFloat(getComputedStyle(p).fontSize);
    if (len > 60 && fs >= 13 && fs <= 24 && (!para || len > para.len)) para = { el: p, len, fs };
  }
  if (!para) return { error: "no article paragraph", title: document.title, url: location.href };

  const scope =
    para.el.closest(
      "article, .markdown-body, main, [role=main], .topic_content, .ne-viewer-body",
    ) || para.el.parentElement;
  const bg = effectiveBg(para.el);
  const s = getComputedStyle(para.el);

  const inline = (a) => {
    const b = parse(getComputedStyle(a).backgroundColor);
    return visible(a) && (a.innerText || "").trim().length > 1 && !(b && b.a > 0.5);
  };
  const link =
    [...scope.querySelectorAll("p a, .topic_content a, .ne-p a")].find(inline) ||
    [...scope.querySelectorAll("li a")].find(inline) ||
    null;
  const heading =
    [...scope.querySelectorAll("h1, h2")].find(visible) ||
    [...document.querySelectorAll("main h1, article h1, h1")].find(visible);

  const chromatic = (c) => c && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 30;
  const buttons = new Map();
  for (const el of document.querySelectorAll("button, a, [role=button]")) {
    if (!visible(el)) continue;
    const c = parse(getComputedStyle(el).backgroundColor);
    if (!c || c.a < 0.9) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 80) continue;
    const key = hex(c);
    if (key === hex(bg)) continue;
    buttons.set(key, (buttons.get(key) || 0) + r.width * r.height);
  }

  return {
    title: document.title,
    url: location.href,
    bg: hex(bg),
    ink: hex(colorOf(para.el, bg)),
    link: link ? hex(colorOf(link, bg)) : null,
    linkDecoration: link ? getComputedStyle(link).textDecorationLine : null,
    heading: heading ? hex(colorOf(heading, bg)) : null,
    fontSize: para.fs,
    fontFamily: s.fontFamily.split(",")[0].replace(/["']/g, ""),
    buttons: [...buttons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([c]) => c)
      .filter(
        (c) =>
          chromatic(
            parse(
              `rgb(${parseInt(c.slice(1, 3), 16)},${parseInt(c.slice(3, 5), 16)},${parseInt(c.slice(5, 7), 16)})`,
            ),
          ) ||
          c === "#000000" ||
          c === "#171717" ||
          c === "#1f2328",
      ),
  };
};

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const shots = path.join(root, ".tmp/verify");
mkdirSync(shots, { recursive: true });

const only = process.argv.slice(2);
const browser = await chromium.launch();
for (const t of TARGETS.filter((target) => !only.length || only.includes(target.id))) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    locale: "zh-CN",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  const rec = { id: t.id };
  try {
    await page.goto(t.url, { waitUntil: "commit", timeout: 60000 });
    await page.waitForTimeout(6000);
    for (const selector of [t.follow, t.then].filter(Boolean)) {
      const href = await page.$eval(selector, (a) => a.href).catch(() => null);
      if (!href) throw new Error(`no link for ${selector}`);
      await page.goto(href, { waitUntil: "domcontentloaded", timeout: 40000 });
      await page.waitForTimeout(2500);
    }
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(shots, `${t.id}.jpg`), type: "jpeg", quality: 70 });
    Object.assign(rec, await page.evaluate(PROBE));
  } catch (error) {
    rec.error = String(error.message).split("\n")[0].slice(0, 140);
  }
  console.log(
    rec.error
      ? `✗ ${t.id.padEnd(10)} ${rec.error} ${rec.url ?? ""}`
      : `✓ ${t.id.padEnd(10)} bg=${rec.bg} ink=${rec.ink} link=${rec.link}(${rec.linkDecoration}) h=${rec.heading} btn=${rec.buttons.join(",")} ${rec.url}`,
  );
  await ctx.close();
}
await browser.close();
