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

const globalCss = ["global.css", "reference-themes.css"]
  .map((file) =>
    readFileSync(path.resolve(import.meta.dirname, "../src/client/styles", file), "utf8"),
  )
  .join("\n");

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

test("the pre-paint theme script knows every theme and its kind", () => {
  const init = readFileSync(
    path.resolve(import.meta.dirname, "../src/client/public/theme-init.js"),
    "utf8",
  );
  const list = (name: string) =>
    [
      ...(init.match(new RegExp(`var ${name} = \\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(
        /"([^"]+)"/g,
      ),
    ].map((match) => match[1]);
  assert.deepEqual(list("THEMES"), themeIds, "run `pnpm themes:gen` to refresh theme-init.js");
  assert.deepEqual(
    list("DARK"),
    themeIds.filter((id) => themeKindOf(id) === "dark"),
  );
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

/** 侧栏面板底色：paper-deep 以 58% 叠在 paper 上 */
function panelBackground(
  paper: [number, number, number],
  paperDeep: [number, number, number],
): [number, number, number] {
  const mixed = [0, 1, 2].map((channel) =>
    Math.round(paperDeep[channel]! * 0.58 + paper[channel]! * 0.42),
  );
  return [mixed[0]!, mixed[1]!, mixed[2]!];
}

function luminance(rgb: [number, number, number]): number {
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const first = luminance(a);
  const second = luminance(b);
  const [light, dark] = first > second ? [first, second] : [second, first];
  return (light + 0.05) / (dark + 0.05);
}

function tokenOf(block: string, token: string): [number, number, number] {
  const value = block.match(new RegExp(`${token}:\\s*#([0-9a-f]{6})`, "i"))?.[1];
  if (!value) throw new Error(`theme block is missing ${token}`);
  const channels = [0, 1, 2].map((channel) =>
    parseInt(value.slice(channel * 2, channel * 2 + 2), 16),
  );
  return [channels[0]!, channels[1]!, channels[2]!];
}

/**
 * 侧栏与右栏的文字必须读得清：正文级文字至少 AA（4.5:1），
 * 更弱的辅助色也承载文字（占位符、计数、时间），同样不低于 4.5:1。
 */
test("every theme keeps sidebar text legible against the panel surface", () => {
  for (const id of themeIds) {
    const block =
      globalCss.match(new RegExp(`:root\\[data-theme="${id}"\\] \\{[^}]*\\}`))?.[0] ?? "";
    const background = panelBackground(tokenOf(block, "--paper"), tokenOf(block, "--paper-deep"));

    for (const token of ["--text", "--text-soft", "--muted"]) {
      const ratio = contrast(tokenOf(block, token), background);
      assert.ok(
        ratio >= 4.5,
        `${id}: ${token} only reaches ${ratio.toFixed(2)}:1 against the panel`,
      );
    }

    const faint = contrast(tokenOf(block, "--faint"), background);
    assert.ok(faint >= 4.5, `${id}: --faint only reaches ${faint.toFixed(2)}:1 against the panel`);
  }
});
