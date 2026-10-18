import assert from "node:assert/strict";
import { test } from "vitest";

import {
  blockAtLine,
  headingsFromBlocks,
  parseBlocks,
  replaceBlockSource,
} from "../src/client/markdown/blocks.js";

const markdown = `# Alpha

First paragraph with **bold** text.

## Alpha

- [ ] one
- [x] two

| A | B |
| - | - |
| 1 | 2 |

\`\`\`ts
const value = 1;
\`\`\`
`;

test("parses GFM into source-preserving top-level blocks", () => {
  const blocks = parseBlocks(markdown);
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["heading", "paragraph", "heading", "taskList", "table", "code"],
  );
  assert.equal(blocks[0]!.headingText, "Alpha");
  assert.equal(blocks[2]!.headingId, "alpha-1");
  assert.equal(
    blocks.map((block) => markdown.slice(block.start, block.end)).join("\n"),
    blocks.map((block) => block.markdown).join("\n"),
  );
});

test("replaces only the selected block source", () => {
  const blocks = parseBlocks(markdown);
  const paragraph = blocks[1]!;
  const updated = replaceBlockSource(
    markdown,
    paragraph,
    "Changed paragraph without touching the rest.",
  );
  assert.match(updated, /^# Alpha/);
  assert.match(updated, /Changed paragraph without touching the rest\./);
  assert.match(updated, /## Alpha/);
  assert.ok(!updated.includes("First paragraph"));
});

test("finds headings and search lines", () => {
  const blocks = parseBlocks(markdown);
  assert.deepEqual(
    headingsFromBlocks(blocks).map((block) => block.headingId),
    ["alpha", "alpha-1"],
  );
  assert.equal(blockAtLine(blocks, 10)?.kind, "table");
});
