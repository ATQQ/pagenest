import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";

import {
  defaultTheme,
  isThemeId,
  themeIds,
  themeKindOf,
  themeOptions,
} from "../src/client/themes.js";

const globalCss = readFileSync(
  path.resolve(import.meta.dirname, "../src/client/styles/global.css"),
  "utf8",
);

test("exposes a book-reader theme for every id with a unique label", () => {
  assert.ok(themeIds.length >= 8);
  assert.equal(new Set(themeIds).size, themeIds.length);
  const labels = themeOptions.map((option) => option.label);
  assert.equal(new Set(labels).size, labels.length);
  for (const option of themeOptions) {
    assert.ok(option.description.length > 0);
    assert.ok(["light", "dark"].includes(option.kind));
  }
});

test("classifies light and dark themes and rejects unknown ids", () => {
  assert.equal(themeKindOf("paper"), "light");
  assert.equal(themeKindOf("sepia"), "light");
  assert.equal(themeKindOf("night"), "dark");
  assert.equal(themeKindOf("amoled"), "dark");
  assert.equal(isThemeId("paper"), true);
  assert.equal(isThemeId("solarized"), false);
  assert.equal(isThemeId(undefined), false);
});

test("defines a colour block for every theme and keeps the default valid", () => {
  assert.equal(isThemeId(defaultTheme), true);
  for (const id of themeIds) {
    assert.ok(
      globalCss.includes(`:root[data-theme="${id}"]`),
      `global.css is missing a block for theme "${id}"`,
    );
  }
  assert.ok(globalCss.includes(':root[data-theme="night"],'));
});

test("every theme defines the reader tokens the reading view depends on", () => {
  const required = [
    "--reader-bg",
    "--reader-ink",
    "--reader-heading",
    "--reader-link",
    "--reader-muted",
    "--reader-rule",
    "--reader-code-bg",
    "--reader-quote-bg",
  ];
  const blocks = themeIds.map(
    (id) => globalCss.match(new RegExp(`:root\\[data-theme="${id}"\\] \\{[^}]*\\}`))?.[0] ?? "",
  );
  for (const block of blocks) {
    assert.ok(block.length > 0, "a theme has no colour block");
    for (const token of required) {
      assert.ok(block.includes(`${token}:`), `theme block is missing ${token}`);
    }
  }
});

test("filled accent surfaces fall back to the theme accent and dim themselves at night", () => {
  const rootBlock = globalCss.match(/:root,\s*:root\[data-theme="paper"\] \{[^}]*\}/)?.[0] ?? "";
  for (const token of [
    "--accent-fill",
    "--accent-fill-ink",
    "--accent-fill-hover",
    "--brand-fill",
    "--brand-ink",
  ]) {
    assert.ok(rootBlock.includes(`${token}:`), `base theme block is missing ${token}`);
  }

  // Night themes must override the filled surfaces, otherwise a saturated slab
  // of colour stays at full brightness on a dark page.
  for (const id of ["night", "dark", "amoled"]) {
    const block =
      globalCss.match(new RegExp(`:root\\[data-theme="${id}"\\] \\{[^}]*\\}`))?.[0] ?? "";
    assert.ok(block.includes("--accent-fill:"), `${id} is missing --accent-fill`);
    assert.ok(block.includes("--brand-fill:"), `${id} is missing --brand-fill`);
  }
});
