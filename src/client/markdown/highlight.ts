import type { Element, Root, RootContent } from "hast";
import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import css from "shiki/langs/css.mjs";
import diff from "shiki/langs/diff.mjs";
import go from "shiki/langs/go.mjs";
import html from "shiki/langs/html.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import jsx from "shiki/langs/jsx.mjs";
import markdown from "shiki/langs/markdown.mjs";
import python from "shiki/langs/python.mjs";
import rust from "shiki/langs/rust.mjs";
import shell from "shiki/langs/shell.mjs";
import sql from "shiki/langs/sql.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import githubDark from "shiki/themes/github-dark-high-contrast.mjs";
import githubLight from "shiki/themes/github-light-high-contrast.mjs";

const highlighter = createHighlighterCoreSync({
  engine: createJavaScriptRegexEngine(),
  themes: [githubLight, githubDark],
  langs: [
    bash,
    css,
    diff,
    go,
    html,
    javascript,
    json,
    jsx,
    markdown,
    python,
    rust,
    shell,
    sql,
    tsx,
    typescript,
    yaml,
  ],
  warnings: false,
});

const loadedLanguages = new Set(highlighter.getLoadedLanguages());
const languageAliases: Record<string, string> = {
  console: "bash",
  cts: "typescript",
  htm: "html",
  less: "css",
  md: "markdown",
  mjs: "javascript",
  node: "javascript",
  plaintext: "text",
  py: "python",
  rs: "rust",
  sass: "css",
  scss: "css",
  sh: "bash",
  svg: "html",
  terminal: "bash",
  yml: "yaml",
  zsh: "bash",
};

function textContent(node: RootContent): string {
  if (node.type === "text") return node.value;
  if (!("children" in node)) return "";
  return node.children.map(textContent).join("");
}

function codeLanguage(code: Element): string | null {
  const className = code.properties.className;
  const classes = Array.isArray(className) ? className.join(" ") : String(className || "");
  const match = classes.match(/(?:^|\s)language-([^\s]+)/i);
  if (!match?.[1]) return null;

  const requested = match[1].toLocaleLowerCase();
  const language = languageAliases[requested] || requested;
  return loadedLanguages.has(language) ? language : null;
}

function highlightedPre(pre: Element): Element | null {
  const code = pre.children.find(
    (child): child is Element => child.type === "element" && child.tagName === "code",
  );
  if (!code) return null;

  const language = codeLanguage(code);
  if (!language || language === "text") return null;

  try {
    const highlighted = highlighter.codeToHast(textContent(code).replace(/\n$/, ""), {
      lang: language,
      themes: {
        light: "github-light-high-contrast",
        dark: "github-dark-high-contrast",
      },
      defaultColor: false,
      rootStyle: false,
    });
    return (
      highlighted.children.find(
        (child): child is Element => child.type === "element" && child.tagName === "pre",
      ) ?? null
    );
  } catch {
    // Unknown or malformed grammars should never prevent the document from rendering.
    return null;
  }
}

function highlightTree(parent: Root | Element): void {
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index];
    if (child?.type !== "element") continue;

    if (child.tagName === "pre") {
      const highlighted = highlightedPre(child);
      if (highlighted) {
        parent.children[index] = highlighted;
        continue;
      }
    }
    highlightTree(child);
  }
}

export function rehypeSyntaxHighlight() {
  return (tree: Root) => {
    highlightTree(tree);
  };
}
