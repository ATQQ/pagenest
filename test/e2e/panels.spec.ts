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

/**
 * 面板收合时，正文必须始终相对视口居中，不能随着侧栏 / 右栏的宽度变化而左右漂移。
 */
const articleBox = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const article = document.querySelector("article");
    if (!article) throw new Error("Article is not available");
    const rect = article.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      viewportCenter: Math.round(document.documentElement.clientWidth / 2),
      articleCenter: Math.round(rect.left + rect.width / 2),
    };
  });

test("keeps the reading page centred while the side panels collapse", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Divider buttons only exist when both panels are docked",
  );

  const open = await articleBox(page);
  expect(open.articleCenter).toBe(open.viewportCenter);
  const anchor = { left: open.left, right: open.right };

  await page.getByRole("button", { name: "收起资料夹" }).click();
  await expect(page.getByRole("button", { name: "展开资料夹" })).toBeVisible();
  await page.waitForTimeout(400);

  const sidebarClosed = await articleBox(page);
  expect(sidebarClosed.articleCenter).toBe(sidebarClosed.viewportCenter);
  expect(sidebarClosed.left).toBe(anchor.left);
  expect(sidebarClosed.right).toBe(anchor.right);

  await page.getByRole("button", { name: "收起本页导航" }).click();
  await expect(page.getByRole("button", { name: "展开本页导航" })).toBeVisible();
  await page.waitForTimeout(400);

  const bothClosed = await articleBox(page);
  expect(bothClosed.articleCenter).toBe(bothClosed.viewportCenter);
  expect(bothClosed.left).toBe(anchor.left);
  expect(bothClosed.right).toBe(anchor.right);

  await page.getByRole("button", { name: "展开本页导航" }).click();
  await page.getByRole("button", { name: "展开资料夹" }).click();
  await page.waitForTimeout(400);

  const restored = await articleBox(page);
  expect(restored.left).toBe(anchor.left);
  expect(restored.right).toBe(anchor.right);
});

test("remembers the collapsed panels across a reload", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Divider buttons only exist when both panels are docked",
  );

  await page.getByRole("button", { name: "收起资料夹" }).click();
  await page.getByRole("button", { name: "收起本页导航" }).click();
  await page.waitForTimeout(300);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Lantern Notes", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "展开资料夹" })).toBeVisible();
  await expect(page.getByRole("button", { name: "展开本页导航" })).toBeVisible();

  const closed = await articleBox(page);
  expect(closed.articleCenter).toBe(closed.viewportCenter);
});

/**
 * 折叠按钮用圆形箭头指示方向：箭头朝向面板将要移动的方向。
 */
test("points the divider arrow at the direction each panel will move", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Divider buttons only exist when both panels are docked",
  );

  const arrow = (label: string) => page.locator(`button[aria-label="${label}"] svg path`);

  // 展开态：箭头指向收起方向
  await expect(arrow("收起资料夹")).toHaveAttribute("d", "m15 6-6 6 6 6");
  await expect(arrow("收起本页导航")).toHaveAttribute("d", "m9 6 6 6-6 6");

  await page.getByRole("button", { name: "收起资料夹" }).click();
  await page.getByRole("button", { name: "收起本页导航" }).click();
  await expect(page.getByRole("button", { name: "展开资料夹" })).toBeVisible();
  await expect(page.getByRole("button", { name: "展开本页导航" })).toBeVisible();

  // 收起态：箭头反向，指向重新展开的方向
  await expect(arrow("展开资料夹")).toHaveAttribute("d", "m9 6 6 6-6 6");
  await expect(arrow("展开本页导航")).toHaveAttribute("d", "m15 6-6 6 6 6");
});
