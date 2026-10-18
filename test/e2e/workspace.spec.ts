import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const fixtureRoot = path.resolve("test/fixtures/notes");
const workspaceRoot = path.resolve(".tmp/e2e-notes");

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

test("switches navigation modes, expands folders, and remembers the theme", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "收起目录" }).click();
  }
  await page.getByRole("button", { name: "列表" }).click();
  await expect(page.getByRole("button", { name: /Getting started/ })).toBeVisible();
  await page.getByRole("button", { name: "树形" }).click();
  await page.getByRole("button", { name: /guides/ }).click();
  await page.getByRole("button", { name: /deep/ }).click();
  await page.getByRole("button", { name: "Architecture" }).click();
  await expect(page.getByRole("heading", { name: "Architecture", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "切换深浅主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await page.getByRole("button", { name: "切换深浅主题" }).click();
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
  await page.getByRole("button", { name: "收藏 Today" }).click({ force: true });
  await expect(page.getByRole("button", { name: /速记/ })).toContainText("1");
  await page.getByRole("button", { name: /速记/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Today");
});

test("edits a paragraph, saves, and shows the previous version in history", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "编辑" }).click();
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

test("opens source mode with CodeMirror", async ({ page }) => {
  await page.getByRole("button", { name: "源码" }).click();
  await expect(page.locator(".cm-content")).toContainText("Lantern Notes");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\nA source-mode sentence.");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toContainText("已保存");
  await expect(page.locator(".cm-content")).toContainText("A source-mode sentence.");
});

test("opens the mobile directory and page rail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile layout only");
  await page.getByRole("button", { name: "收起目录" }).click();
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
  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByText(/This opening paragraph/).click();
  await page
    .getByRole("textbox", { name: "编辑内容块" })
    .fill("This draft survives a browser reload.");
  await page.getByRole("button", { name: "完成" }).click();
  await page.reload();
  await expect(page.getByText("This draft survives a browser reload.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Lantern Notes" }).locator("i")).toBeVisible();
});

test("opens multiple documents in tabs and closes the active tab", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "收起目录" }).click();
  }
  await page.getByRole("button", { name: /notes/ }).click();
  await page.getByRole("button", { name: "Ideas" }).click();
  const docTabs = page.getByRole("tablist", { name: "已打开文档" }).getByRole("tab");
  await expect(docTabs).toHaveCount(2);
  await expect(page.getByRole("tab", { name: "Ideas" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "关闭 Ideas" }).click();
  await expect(docTabs).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Lantern Notes", level: 1 })).toBeVisible();
});

test("shows conflict details and can load the disk version", async ({ page }) => {
  await page.getByRole("button", { name: "编辑" }).click();
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
  await page.getByRole("button", { name: "编辑" }).click();
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
    await page.getByRole("button", { name: "收起目录" }).click();
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
    await page.getByRole("button", { name: "收起目录" }).click();
  }
  await page.getByRole("button", { name: "新建" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("标题").fill("Release checklist");
  await dialog.getByLabel("路径").fill("notes/release-checklist.md");
  await dialog.getByRole("button", { name: "创建文档" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tab", { name: "Release checklist" })).toBeVisible();
  const created = await fs.readFile(path.join(workspaceRoot, "notes/release-checklist.md"), "utf8");
  expect(created).toContain("# Release checklist");
});
