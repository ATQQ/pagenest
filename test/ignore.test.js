import assert from "node:assert/strict";
import test from "node:test";

import {
  createIgnoreMatcher,
  normalizeIgnorePatterns,
  parseIgnoreRules,
} from "../src/ignore.js";

test("matches common gitignore directory, glob, and negation rules", () => {
  const matcher = createIgnoreMatcher({
    gitignoreText: `
# dependencies
node_modules/
*.draft.md
/private/
docs/*
!docs/keep.md
**/archive/
photos/[ab].png
`,
  });

  assert.equal(matcher.isIgnored("node_modules/pkg/readme.md"), true);
  assert.equal(matcher.isIgnored("notes/draft.draft.md"), true);
  assert.equal(matcher.isIgnored("private/secret.md"), true);
  assert.equal(matcher.isIgnored("nested/private/public.md"), false);
  assert.equal(matcher.isIgnored("docs/remove.md"), true);
  assert.equal(matcher.isIgnored("docs/keep.md"), false);
  assert.equal(matcher.isIgnored("deep/nested/archive/old.md"), true);
  assert.equal(matcher.isIgnored("photos/a.png"), true);
  assert.equal(matcher.isIgnored("photos/c.png"), false);
});

test("directory-only rules do not hide same-named files", () => {
  const matcher = createIgnoreMatcher({ patterns: ["build/"] });

  assert.equal(matcher.isIgnored("build", { isDirectory: true }), true);
  assert.equal(matcher.isIgnored("build", { isDirectory: false }), false);
  assert.equal(matcher.isIgnored("packages/app/build/output.md"), true);
});

test("normalizes comments and duplicate custom rules", () => {
  assert.deepEqual(
    normalizeIgnorePatterns(["drafts/\n# comment\nprivate/", "drafts/", ""]),
    ["drafts/", "private/"],
  );
  assert.equal(parseIgnoreRules("# comment\ndrafts/\n").length, 1);
});
