import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const fixtureRoot = path.resolve("test/fixtures/notes");
const workspaceRoot = path.resolve(".tmp/e2e-notes");

const openTabs = (page: Page) => page.getByRole("navigation", { name: "已打开文档" });
const docTab = (page: Page, name: string) =>
  openTabs(page).getByRole("button", { name, exact: true });
const tabCloseButtons = (page: Page) => openTabs(page).getByRole("button", { name: /^关闭 / });

test.beforeEach(async ({ page }) => {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
  await fs.cp(fixtureRoot, workspaceRoot, { recursive: true });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Lantern Notes", level: 1 })).toBeVisible();
});

test("loads the React workspace without page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Lantern Notes", level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test("loads images relative to the current Markdown document", async ({ page }) => {
  const image = page.getByRole("img", { name: "fixture lantern" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(await image.getAttribute("src")).toMatch(/^\/api\/assets\/d-/);
});

test("switches navigation modes, expands folders, and remembers the theme", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开目录" }).click();
  }
  await page.getByRole("button", { name: "列表" }).click();
  await expect(page.getByRole("button", { name: /Getting started/ })).toBeVisible();
  await page.getByRole("button", { name: "树形" }).click();
  await page.getByRole("button", { name: /guides/ }).click();
  await page.getByRole("button", { name: /deep/ }).click();
  await page.getByRole("button", { name: "Architecture" }).click();
  await expect(page.getByRole("heading", { name: "Architecture", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: /选择主题/ }).click();
  await page.getByRole("menuitem", { name: /夜读/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await page.getByRole("button", { name: /选择主题/ }).click();
  await page.getByRole("menuitem", { name: /护眼/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "eye");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "eye");
  await page.getByRole("button", { name: /选择主题/ }).click();
  await page.getByRole("menuitem", { name: /纸页/ }).click();
});

test("top search is independent from the sidebar filter", async ({ page }) => {
  const sidebarFilter = page.locator('input[aria-label="筛选文章标题或路径"]');
  await sidebarFilter.fill("guide");
  await page.getByRole("button", { name: /全文档搜索/ }).click();

  const searchInput = page.getByRole("textbox", { name: "全文档搜索" });
  await searchInput.fill("lantern phrase");
  await expect(page.getByRole("option").filter({ hasText: "Ideas" })).toBeVisible();
  await expect(sidebarFilter).toHaveValue("guide");
  await searchInput.press("Enter");
  await expect(page.getByRole("heading", { name: "Ideas", level: 1 })).toBeVisible();
});

test("favorites headings into the quick notes panel", async ({ page }) => {
  await page.getByRole("button", { name: "收藏 Today" }).click();
  await expect(page.getByRole("button", { name: /速记/ })).toContainText("1");
  await page.getByRole("button", { name: /速记/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Today");
});

test("edits a paragraph, saves, and shows the previous version in history", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "编辑文档" }).click();
  await page.getByText(/This opening paragraph/).click();
  const editor = page.getByRole("textbox", { name: "编辑内容块" });
  await editor.fill("The lantern paragraph was edited inside PageNest.");
  await editor.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toContainText("已保存");
  await expect(page.getByText(/edited inside PageNest/)).toBeVisible();

  if (testInfo.project.name !== "desktop-chromium") {
    await page.getByRole("button", { name: "打开本页目录与历史" }).click();
  }
  await page.getByRole("tab", { name: /历史/ }).click();
  const snapshot = page.getByRole("button", { name: /保存前快照/ }).first();
  await expect(snapshot).toBeVisible();
  await snapshot.click();
  await expect(page.getByRole("dialog")).toContainText("与「保存前快照」比较");
});

test("keeps images intact while editing their paragraph", async ({ page }) => {
  await page.getByRole("button", { name: "编辑文档" }).click();
  await page.getByRole("img", { name: "fixture lantern" }).click();
  const editor = page.getByRole("textbox", { name: "编辑内容块" });
  const image = editor.getByRole("img", { name: "fixture lantern" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  await image.click();
  await editor.pressSequentially(" Lit at dusk.");
  await page.getByRole("button", { name: /保存并返回/ }).click();
  await expect(page.getByRole("status")).toContainText("已保存");

  const saved = await fs.readFile(path.join(workspaceRoot, "README.md"), "utf8");
  expect(saved).toContain("![fixture lantern](assets/lantern.svg) Lit at dusk.");
  await expect(page.getByRole("img", { name: "fixture lantern" })).toBeVisible();
});

test("keeps heading typography stable while editing and exposes one edit control bar", async ({
  page,
}) => {
  const heading = page.getByRole("heading", { name: "Lantern Notes", level: 1 });
  const before = await heading.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      fontWeight: style.fontWeight,
    };
  });

  await page.getByRole("button", { name: "编辑文档" }).click();
  await expect(page.getByRole("group", { name: "编辑方式" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消更改" })).toBeVisible();
  await expect(page.getByRole("button", { name: /保存并返回/ })).toBeVisible();
  await heading.click();

  const editor = page.getByRole("textbox", { name: "编辑Lantern Notes" });
  const after = await editor.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      fontWeight: style.fontWeight,
    };
  });
  expect(after).toEqual(before);

  await editor.fill("A temporary heading");
  await page.locator('h1[contenteditable="true"]').press("Escape");
  await expect(heading).toBeVisible();

  await page.getByRole("button", { name: "Markdown 源码" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "取消更改" }).click();
  await expect(page.getByRole("button", { name: "编辑文档" })).toBeVisible();
  await expect(heading).toBeVisible();
});

test("opens source mode with CodeMirror", async ({ page }) => {
  await page.getByRole("button", { name: "编辑文档" }).click();
  await page.getByRole("button", { name: "Markdown 源码" }).click();
  await expect(page.locator(".cm-content")).toContainText("Lantern Notes");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\nA source-mode sentence.");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toContainText("已保存");
  await expect(page.getByText("A source-mode sentence.")).toBeVisible();
});

test("keeps source text readable in paper and night themes", async ({ page }) => {
  await page.getByRole("button", { name: "编辑文档" }).click();
  await page.getByRole("button", { name: "Markdown 源码" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();

  const sourceContrast = () =>
    page.evaluate(() => {
      const pane = document.querySelector<HTMLElement>('[aria-label="Markdown 源码编辑"]');
      const content = pane?.querySelector<HTMLElement>(".cm-content");
      if (!pane || !content) throw new Error("Source editor is not available");

      const channels = (color: string) =>
        color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
      const luminance = ([red, green, blue]: number[]) =>
        [red, green, blue]
          .map((value) => {
            const channel = value! / 255;
            return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          })
          .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index]!, 0);

      const foreground = channels(getComputedStyle(content).color);
      const background = channels(getComputedStyle(pane).backgroundColor);
      if (!foreground || !background) throw new Error("Could not read source editor colors");
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    });

  expect(await sourceContrast()).toBeGreaterThanOrEqual(7);
  await page.getByRole("button", { name: /选择主题/ }).click();
  await page.getByRole("menuitem", { name: /夜读/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await expect(page.locator(".cm-content")).toBeVisible();
  expect(await sourceContrast()).toBeGreaterThanOrEqual(7);
});

test("keeps fenced code readable across all themes", async ({ page }) => {
  const codeAppearance = () =>
    page.evaluate(() => {
      const pre = document.querySelector<HTMLElement>("article pre");
      const code = pre?.querySelector<HTMLElement>("code");
      if (!pre || !code) throw new Error("Fenced code block is not available");

      const channels = (color: string) =>
        color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
      const luminance = ([red, green, blue]: number[]) =>
        [red, green, blue]
          .map((value) => {
            const channel = value! / 255;
            return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          })
          .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index]!, 0);

      const foreground = channels(getComputedStyle(code).color);
      const background = channels(getComputedStyle(pre).backgroundColor);
      if (!foreground || !background) throw new Error("Could not read fenced code colors");
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      const tokenColors = Array.from(pre.querySelectorAll<HTMLElement>("span[style]"))
        .map((token) => getComputedStyle(token).color)
        .filter(Boolean);
      const tokenContrasts = tokenColors
        .map((color) => channels(color))
        .filter((color): color is number[] => Boolean(color))
        .map((color) => {
          const tokenLight = Math.max(luminance(color), luminance(background));
          const tokenDark = Math.min(luminance(color), luminance(background));
          return (tokenLight + 0.05) / (tokenDark + 0.05);
        });
      return {
        baseContrast: (light + 0.05) / (dark + 0.05),
        colors: new Set(tokenColors).size,
        minimumTokenContrast: Math.min(...tokenContrasts),
      };
    });

  const assertReadable = (appearance: Awaited<ReturnType<typeof codeAppearance>>) => {
    expect(appearance.baseContrast).toBeGreaterThanOrEqual(7);
    expect(appearance.colors).toBeGreaterThanOrEqual(3);
    expect(appearance.minimumTokenContrast).toBeGreaterThanOrEqual(4.5);
  };

  assertReadable(await codeAppearance());
  await page.getByRole("button", { name: /选择主题/ }).click();
  await page.getByRole("menuitem", { name: /护眼/ }).click();
  assertReadable(await codeAppearance());
  await page.getByRole("button", { name: /选择主题/ }).click();
  await page.getByRole("menuitem", { name: /夜读/ }).click();
  assertReadable(await codeAppearance());
});

test("keeps a consistent document rhythm around headings", async ({ page }) => {
  const gaps = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll<HTMLElement>("article [data-block-kind]"));
    const gapBefore = (element: HTMLElement) => {
      const previous = element.previousElementSibling as HTMLElement | null;
      if (!previous) return 0;
      return element.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
    };
    const heading = (level: string) =>
      blocks.find((block) => block.dataset.blockLevel === level) as HTMLElement;
    return {
      paragraph: gapBefore(
        blocks.find((block) => block.dataset.blockKind === "paragraph") as HTMLElement,
      ),
      h1: gapBefore(heading("1")),
      h2: gapBefore(heading("2")),
    };
  });

  expect(gaps.paragraph).toBeGreaterThanOrEqual(12);
  expect(gaps.h1).toBe(0);
  expect(gaps.h2).toBeGreaterThanOrEqual(32);
});

test("opens the mobile directory and page rail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile layout only");
  await page.getByRole("button", { name: "打开目录" }).click();
  await page.getByRole("button", { name: /notes/ }).click();
  await page.getByRole("button", { name: "Ideas" }).click();
  await expect(page.getByRole("heading", { name: "Ideas", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "打开本页目录与历史" }).click();
  await expect(page.getByText("本页", { exact: true })).toBeVisible();
});

test("has no serious accessibility violations on the workspace", async ({ page }) => {
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact || ""),
    ),
  ).toEqual([]);
});

test("keeps an unsaved draft when the page reloads", async ({ page }) => {
  await page.getByRole("button", { name: "编辑文档" }).click();
  await page.getByText(/This opening paragraph/).click();
  await page
    .getByRole("textbox", { name: "编辑内容块" })
    .fill("This draft survives a browser reload.");
  await page.reload();
  await expect(page.getByText("This draft survives a browser reload.")).toBeVisible();
  await expect(docTab(page, "Lantern Notes").locator("i")).toBeVisible();
});

test("opens multiple documents in tabs and closes the active tab", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开目录" }).click();
  }
  await page.getByRole("button", { name: /notes/ }).click();
  await page.getByRole("button", { name: "Ideas" }).click();
  await expect(tabCloseButtons(page)).toHaveCount(2);
  await expect(docTab(page, "Ideas")).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "关闭 Ideas" }).click();
  await expect(tabCloseButtons(page)).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Lantern Notes", level: 1 })).toBeVisible();
});

test("closes an inactive tab without switching away", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开目录" }).click();
  }
  await page.getByRole("button", { name: /notes/ }).click();
  await page.getByRole("button", { name: "Ideas" }).click();
  await expect(tabCloseButtons(page)).toHaveCount(2);
  await docTab(page, "Lantern Notes").hover();
  await page.getByRole("button", { name: "关闭 Lantern Notes" }).click();
  await expect(tabCloseButtons(page)).toHaveCount(1);
  await expect(docTab(page, "Ideas")).toHaveAttribute("aria-current", "page");
});

test("links the CLI version in the sidebar footer to GitHub", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开目录" }).click();
  }
  const repoLink = page.getByRole("link", { name: /^v\d+\.\d+\.\d+/ });
  await expect(repoLink).toBeVisible();
  await expect(repoLink).toHaveAttribute("href", "https://github.com/ATQQ/pagenest");
  await expect(page.getByText(/本地服务/)).toHaveCount(0);
});

test("shows conflict details and can load the disk version", async ({ page }) => {
  await page.getByRole("button", { name: "编辑文档" }).click();
  await page.getByText(/This opening paragraph/).click();
  await page
    .getByRole("textbox", { name: "编辑内容块" })
    .fill("A local draft that should not overwrite automatically.");
  await fs.writeFile(
    path.join(workspaceRoot, "README.md"),
    "# Lantern Notes\n\nA change written by another program.\n",
  );
  await page.keyboard.press("ControlOrMeta+s");
  const conflict = page.getByRole("alertdialog");
  await expect(conflict).toContainText("磁盘上的文件已经变化");
  await conflict.getByRole("button", { name: "查看差异" }).click();
  await expect(page.getByRole("dialog")).toContainText("本地草稿与磁盘版本");
  await page.getByRole("button", { name: "关闭差异" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("磁盘上的文件已经变化");
  await page.getByRole("alertdialog").getByRole("button", { name: "加载对方" }).click();
  await expect(page.getByText("A change written by another program.")).toBeVisible();
});

test("can deliberately keep the local draft on a disk conflict", async ({ page }) => {
  await page.getByRole("button", { name: "编辑文档" }).click();
  await page.getByText(/This opening paragraph/).click();
  await page
    .getByRole("textbox", { name: "编辑内容块" })
    .fill("Keep this local conflict resolution.");
  await fs.writeFile(
    path.join(workspaceRoot, "README.md"),
    "# Lantern Notes\n\nAn external edit.\n",
  );
  await page.keyboard.press("ControlOrMeta+s");
  await page.getByRole("alertdialog").getByRole("button", { name: "保留本地" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await expect(page.getByText("Keep this local conflict resolution.")).toBeVisible();
  const saved = await fs.readFile(path.join(workspaceRoot, "README.md"), "utf8");
  expect(saved).toContain("Keep this local conflict resolution.");
});

test("reuses gitignore and extends it from the page", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开目录" }).click();
  }
  await fs.writeFile(path.join(workspaceRoot, ".gitignore"), "private.md\n");
  await fs.writeFile(path.join(workspaceRoot, "private.md"), "# Private notes\n");
  await fs.writeFile(path.join(workspaceRoot, "scratch.draft.md"), "# Scratch notes\n");
  await page.getByRole("button", { name: "重新扫描" }).click();
  await expect(page.getByRole("button", { name: "Scratch notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Private notes" })).toHaveCount(0);

  await page.getByRole("button", { name: "忽略规则" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(".gitignore 1 条");
  await dialog.getByLabel("附加规则").fill("*.draft.md");
  await dialog.getByRole("button", { name: "保存并重新扫描" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Scratch notes" })).toHaveCount(0);
});

test("creates a new Markdown document from the sidebar", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开目录" }).click();
  }
  await page.getByRole("button", { name: "新建" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("标题").fill("Release checklist");
  await dialog.getByLabel("路径").fill("notes/release-checklist.md");
  await dialog.getByRole("button", { name: "创建文档" }).click();
  await expect(dialog).toBeHidden();
  await expect(docTab(page, "Release checklist")).toBeVisible();
  const created = await fs.readFile(path.join(workspaceRoot, "notes/release-checklist.md"), "utf8");
  expect(created).toContain("# Release checklist");
});
