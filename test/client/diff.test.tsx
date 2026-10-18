import assert from "node:assert/strict";
import { test } from "vitest";

import { buildDiffRows } from "../../src/client/diff.js";

test("builds aligned diff rows for added and removed lines", () => {
  const rows = buildDiffRows("one\ntwo\n", "one\nthree\n");
  assert.equal(rows[0]!.type, "same");
  assert.equal(rows[1]!.type, "mixed");
  assert.equal(rows[1]!.oldLine, "two");
  assert.equal(rows[1]!.newLine, "three");
});
