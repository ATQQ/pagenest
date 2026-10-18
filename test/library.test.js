import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Library, PageNestError } from "../src/library.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pagenest-library-"));
  await fs.mkdir(path.join(root, "guides"), { recursive: true });
  await fs.writeFile(path.join(root, "README.md"), "# Home\n\nFirst copy.\n");
  await fs.writeFile(path.join(root, "guides", "start.md"), "# Start\n\nGuide.\n");
  await fs.writeFile(path.join(root, "ignore.txt"), "not markdown");
  return root;
}

test("scans Markdown files and ignores non-document paths", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = await Library.open(root);
  const documents = await library.scanDocuments();

  assert.deepEqual(
    documents.map((document) => document.path),
    ["guides/start.md", "README.md"],
  );
  assert.equal(documents[1].title, "Home");
  assert.match(documents[1].id, /^d-[a-f0-9]{20}$/);
});

test("rejects path traversal and unsupported extensions", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = await Library.open(root);

  assert.throws(
    () => library.normalizeDocumentPath("../secret.md"),
    (error) => error instanceof PageNestError && error.code === "INVALID_PATH",
  );
  assert.throws(
    () => library.normalizeDocumentPath(".pagenest/state.md"),
    (error) => error instanceof PageNestError && error.code === "INVALID_PATH",
  );
  assert.throws(
    () => library.normalizeDocumentPath("notes.txt"),
    (error) => error instanceof PageNestError && error.code === "INVALID_PATH",
  );
});

test("detects external changes and refuses a stale save", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = await Library.open(root);
  const document = (await library.scanDocuments()).find((item) => item.path === "README.md");
  const absolute = path.join(root, document.path);

  await fs.writeFile(absolute, "# Home\n\nChanged elsewhere.\n");
  await assert.rejects(
    library.saveDocument(document.id, "# Home\n\nMy local edit.\n", {
      baseHash: document.hash,
    }),
    (error) =>
      error instanceof PageNestError &&
      error.status === 409 &&
      error.details.current.markdown.includes("Changed elsewhere"),
  );
  assert.match(await fs.readFile(absolute, "utf8"), /Changed elsewhere/);
});

test("saves atomically, snapshots the previous version, and restores it", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = await Library.open(root);
  const document = (await library.scanDocuments()).find((item) => item.path === "README.md");

  const saved = await library.saveDocument(
    document.id,
    "# Home\n\nSecond copy with more detail.\n",
    { baseHash: document.hash },
  );
  assert.equal(saved.saved, true);
  assert.match(await fs.readFile(path.join(root, document.path), "utf8"), /Second copy/);
  assert.equal(saved.versions[0].reason, "保存前快照");

  const restored = await library.restoreVersion(document.id, saved.versions[0].id);
  assert.equal(restored.restored, true);
  assert.match(await fs.readFile(path.join(root, document.path), "utf8"), /First copy/);
  assert.equal(restored.versions[0].reason, "恢复前自动存档");
});

test("creates nested Markdown documents", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = await Library.open(root);

  const created = await library.createDocument({
    path: "notes/ideas",
    title: "Ideas",
    markdown: "",
  });
  assert.equal(created.doc.path, "notes/ideas.md");
  assert.equal(created.doc.title, "Ideas");
  assert.match(await fs.readFile(path.join(root, "notes", "ideas.md"), "utf8"), /# Ideas/);
  assert.equal(created.versions[0].reason, "创建文档");
});
