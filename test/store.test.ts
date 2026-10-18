// @vitest-environment jsdom

import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

test("migrates pagenest.ui.v1 drafts and UI preferences into v2", async () => {
  localStorage.setItem(
    "pagenest.ui.v1",
    JSON.stringify({
      version: 1,
      tabs: [
        { docId: "d-one", dirty: true, scrollTop: 120 },
        { docId: "d-two", dirty: false, scrollTop: 0 },
      ],
      activeDocId: "d-one",
      drafts: { "d-one": "# Unsaved\n" },
      favorites: {
        "d-one": [{ id: "intro", title: "Intro", level: 2, blockIndex: 3 }],
      },
      ui: {
        theme: "night",
        sidebarCollapsed: true,
        folders: ["guides"],
        railTab: "history",
        navMode: "list",
      },
    }),
  );

  const { useWorkspace } = await import("../src/client/store/workspace.js");
  const state = useWorkspace.getState();
  assert.deepEqual(state.tabs, [
    { docId: "d-one", scrollTop: 120 },
    { docId: "d-two", scrollTop: 0 },
  ]);
  assert.equal(state.drafts["d-one"], "# Unsaved\n");
  assert.equal(state.favorites["d-one"]![0]!.line, 1);
  assert.equal(state.ui.theme, "night");
  assert.equal(state.ui.navMode, "list");
  assert.ok(localStorage.getItem("pagenest.ui.v2"));
});

test("derives dirty state and clears drafts when content matches disk", async () => {
  const { isDocumentDirty, useWorkspace } = await import("../src/client/store/workspace.js");
  const doc = {
    id: "d-test",
    path: "test.md",
    title: "Test",
    markdown: "# Test\n",
    updatedAt: 1,
    size: 7,
    hash: "hash",
  };
  useWorkspace.setState({
    docs: { [doc.id]: doc },
    docOrder: [doc.id],
    tabs: [{ docId: doc.id, scrollTop: 0 }],
    activeDocId: doc.id,
  });
  useWorkspace.getState().setDraft(doc.id, "# Changed\n");
  assert.equal(isDocumentDirty(doc, useWorkspace.getState().drafts[doc.id]), true);
  useWorkspace.getState().setDraft(doc.id, doc.markdown);
  assert.equal(useWorkspace.getState().drafts[doc.id], undefined);
  assert.equal(isDocumentDirty(doc, useWorkspace.getState().drafts[doc.id]), false);
});

test("prefers a root README when opening a workspace without a saved tab", async () => {
  const { useWorkspace } = await import("../src/client/store/workspace.js");
  const documents = [
    {
      id: "d-guide",
      path: "guides/getting-started.md",
      title: "Getting started",
      markdown: "# Getting started\n",
      updatedAt: 1,
      size: 18,
      hash: "guide",
    },
    {
      id: "d-readme",
      path: "readme.md",
      title: "Home",
      markdown: "# Home\n",
      updatedAt: 1,
      size: 7,
      hash: "readme",
    },
  ];

  useWorkspace.getState().hydrateServer({
    version: 1,
    rootName: "notes",
    documentCount: documents.length,
    versionLimit: 200,
    documents,
    versions: {},
    settings: {
      ignorePatterns: [],
      cliIgnorePatterns: [],
      gitignore: { exists: false, ruleCount: 0 },
    },
  });

  assert.equal(useWorkspace.getState().activeDocId, "d-readme");
  assert.deepEqual(useWorkspace.getState().tabs, [{ docId: "d-readme", scrollTop: 0 }]);
});
