import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import type { BootstrapResponse, SearchResponse } from "../src/shared/contracts.js";
import { createPageNestServer } from "../src/server/server.js";

async function start(
  root: string,
  token = "",
  options: { ignorePatterns?: string[]; publicDirectory?: string } = {},
) {
  const app = await createPageNestServer({ root, token, ...options });
  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
  const { port } = address;
  return { ...app, base: `http://127.0.0.1:${port}` };
}

test("serves bootstrap and saves a document through the API", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pagenest-server-"));
  await fs.writeFile(path.join(root, "README.md"), "# Home\n\nInitial.\n");
  const app = await start(root);
  t.onTestFinished(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const bootstrap = (await fetch(`${app.base}/api/bootstrap`).then((response) =>
    response.json(),
  )) as BootstrapResponse;
  assert.equal(bootstrap.documents.length, 1);
  const document = bootstrap.documents[0]!;

  const response = await fetch(`${app.base}/api/docs/${document.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      markdown: "# Home\n\nUpdated through API.\n",
      baseHash: document.hash,
    }),
  });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.saved, true);
  assert.match(await fs.readFile(path.join(root, "README.md"), "utf8"), /through API/);
});

test("serves workspace-local images and blocks path traversal", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pagenest-assets-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "pagenest-outside-"));
  await fs.mkdir(path.join(root, "images"), { recursive: true });
  await fs.writeFile(
    path.join(root, "images", "lantern.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>\n',
  );
  await fs.writeFile(path.join(root, "README.md"), "# Home\n\n![Lantern](images/lantern.svg)\n");
  await fs.writeFile(path.join(outside, "secret.svg"), "<svg></svg>\n");
  const app = await start(root);
  t.onTestFinished(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  const bootstrap = (await fetch(`${app.base}/api/bootstrap`).then((response) =>
    response.json(),
  )) as BootstrapResponse;
  const document = bootstrap.documents[0]!;
  const asset = await fetch(
    `${app.base}/api/assets/${document.id}?path=${encodeURIComponent("images/lantern.svg")}`,
  );
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "image/svg+xml");
  assert.match(await asset.text(), /<svg/);

  const traversal = await fetch(
    `${app.base}/api/assets/${document.id}?path=${encodeURIComponent("../secret.svg")}`,
  );
  assert.equal(traversal.status, 400);
});

test("requires the access token when configured", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pagenest-token-"));
  await fs.writeFile(path.join(root, "README.md"), "# Home\n");
  const app = await start(root, "secret-token");
  t.onTestFinished(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  assert.equal((await fetch(`${app.base}/api/health`)).status, 401);
  assert.equal(
    (
      await fetch(`${app.base}/api/health`, {
        headers: { "x-pagenest-token": "secret-token" },
      })
    ).status,
    200,
  );
});

test("redirects a query token into an HttpOnly cookie", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pagenest-cookie-"));
  await fs.writeFile(path.join(root, "README.md"), "# Home\n");
  const app = await start(root, "secret-token");
  t.onTestFinished(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const redirect = await fetch(`${app.base}/api/health?token=secret-token`, {
    redirect: "manual",
  });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "/api/health");
  assert.match(redirect.headers.get("set-cookie") || "", /HttpOnly/);
  assert.match(redirect.headers.get("set-cookie") || "", /SameSite=Strict/);

  const cookie = (redirect.headers.get("set-cookie") || "").split(";")[0] || "";
  const health = await fetch(`${app.base}/api/health`, {
    headers: { cookie },
  });
  assert.equal(health.status, 200);
});

test("serves document details, history, and restores an earlier version", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pagenest-history-"));
  await fs.writeFile(path.join(root, "README.md"), "# Home\n\nFirst.\n");
  const app = await start(root);
  t.onTestFinished(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const bootstrap = (await fetch(`${app.base}/api/bootstrap`).then((response) =>
    response.json(),
  )) as BootstrapResponse;
  const original = bootstrap.documents[0]!;
  const details = await fetch(`${app.base}/api/docs/${original.id}`).then((response) =>
    response.json(),
  );
  assert.equal(details.doc.markdown, original.markdown);
  assert.deepEqual(details.versions, []);

  const saved = await fetch(`${app.base}/api/docs/${original.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      markdown: "# Home\n\nSecond version.\n",
      baseHash: original.hash,
    }),
  }).then((response) => response.json());
  assert.equal(saved.versions.length, 1);

  const versions = await fetch(`${app.base}/api/docs/${original.id}/versions`).then((response) =>
    response.json(),
  );
  assert.equal(versions.versions.length, 1);
  assert.equal(versions.versions[0].reason, "保存前快照");

  const version = await fetch(
    `${app.base}/api/docs/${original.id}/versions/${versions.versions[0].id}`,
  ).then((response) => response.json());
  assert.match(version.version.markdown, /First/);

  const restored = await fetch(
    `${app.base}/api/docs/${original.id}/versions/${versions.versions[0].id}/restore`,
    { method: "POST" },
  ).then((response) => response.json());
  assert.equal(restored.restored, true);
  assert.match(await fs.readFile(path.join(root, "README.md"), "utf8"), /First/);
  assert.equal(restored.versions[0].reason, "恢复前自动存档");
});

test("returns a usable empty bootstrap for a directory without Markdown", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pagenest-empty-"));
  const app = await start(root);
  t.onTestFinished(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const response = await fetch(`${app.base}/api/bootstrap`);
  assert.equal(response.status, 200);
  const bootstrap = (await response.json()) as BootstrapResponse;
  assert.equal(bootstrap.documentCount, 0);
  assert.deepEqual(bootstrap.documents, []);
  assert.deepEqual(bootstrap.versions, {});
  assert.equal(bootstrap.rootName, path.basename(root));
});

test("reads and updates ignore settings through the API", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pagenest-settings-"));
  await fs.mkdir(path.join(root, "private"), { recursive: true });
  await fs.mkdir(path.join(root, "drafts"), { recursive: true });
  await fs.writeFile(path.join(root, ".gitignore"), "private/\n");
  await fs.writeFile(path.join(root, "README.md"), "# Home\n");
  await fs.writeFile(path.join(root, "private", "secret.md"), "# Secret\n");
  await fs.writeFile(path.join(root, "drafts", "idea.md"), "# Idea\n");
  const app = await start(root);
  t.onTestFinished(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const initial = (await fetch(`${app.base}/api/bootstrap`).then((response) =>
    response.json(),
  )) as BootstrapResponse;
  assert.deepEqual(
    initial.documents.map((document) => document.path),
    ["drafts/idea.md", "README.md"],
  );
  assert.equal(initial.settings.gitignore.exists, true);

  const updated = await fetch(`${app.base}/api/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ignorePatterns: ["drafts/"] }),
  }).then((response) => response.json());
  assert.deepEqual(updated.settings.ignorePatterns, ["drafts/"]);

  const bootstrap = (await fetch(`${app.base}/api/bootstrap`).then((response) =>
    response.json(),
  )) as BootstrapResponse;
  assert.deepEqual(
    bootstrap.documents.map((document) => document.path),
    ["README.md"],
  );
  const stored = JSON.parse(
    await fs.readFile(path.join(root, ".pagenest", "settings.json"), "utf8"),
  );
  assert.deepEqual(stored.ignorePatterns, ["drafts/"]);
});

test("applies CLI ignore rules to the server scan", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pagenest-cli-ignore-"));
  await fs.mkdir(path.join(root, "private"), { recursive: true });
  await fs.writeFile(path.join(root, "README.md"), "# Home\n");
  await fs.writeFile(path.join(root, "private", "secret.md"), "# Secret\n");
  const app = await start(root, "", { ignorePatterns: ["private/"] });
  t.onTestFinished(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const bootstrap = (await fetch(`${app.base}/api/bootstrap`).then((response) =>
    response.json(),
  )) as BootstrapResponse;
  assert.deepEqual(
    bootstrap.documents.map((document) => document.path),
    ["README.md"],
  );
  assert.deepEqual(bootstrap.settings.cliIgnorePatterns, ["private/"]);
});

test("returns bounded search snippets and line numbers", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pagenest-search-"));
  await fs.writeFile(
    path.join(root, "README.md"),
    "# Home\n\nFirst line.\n\nThe lantern phrase lives here.\n\nLast line.\n",
  );
  const app = await start(root);
  t.onTestFinished(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const search = (await fetch(`${app.base}/api/search?q=lantern`).then((response) =>
    response.json(),
  )) as SearchResponse;
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0]!.line, 5);
  assert.match(search.results[0]!.snippet, /lantern phrase/);
});

test("supports multi-term and typo-tolerant search with relevance ranking", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pagenest-fuzzy-search-"));
  await fs.writeFile(
    path.join(root, "README.md"),
    "# Lantern Notes\n\nA quiet phrase lives by the garden.\n",
  );
  await fs.writeFile(
    path.join(root, "garden.md"),
    "# Garden Notes\n\nThe lantern phrase waits by the window.\n",
  );
  await fs.writeFile(path.join(root, "fuzzy.md"), "# 搜索设计\n\n页面支持模糊的全文搜索。\n");
  const app = await start(root);
  t.onTestFinished(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  const typoSearch = (await fetch(
    `${app.base}/api/search?q=${encodeURIComponent("lantren phrase")}`,
  ).then((response) => response.json())) as SearchResponse;
  assert.deepEqual(
    typoSearch.results.map((result) => result.title),
    ["Lantern Notes", "Garden Notes"],
  );

  const orderedSearch = (await fetch(
    `${app.base}/api/search?q=${encodeURIComponent("模糊搜索")}`,
  ).then((response) => response.json())) as SearchResponse;
  assert.equal(orderedSearch.results[0]!.title, "搜索设计");
});
