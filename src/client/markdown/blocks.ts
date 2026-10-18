import GithubSlugger from "github-slugger";
import type { Heading, List, Root, RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export type BlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "taskList"
  | "blockquote"
  | "code"
  | "table"
  | "thematicBreak"
  | "source";

export interface DocumentBlock {
  id: string;
  index: number;
  kind: BlockKind;
  markdown: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  level?: number;
  headingId?: string;
  headingText?: string;
}

const parser = unified().use(remarkParse).use(remarkGfm);

function listHasTasks(node: List): boolean {
  return node.children.some(
    (item) => item.type === "listItem" && item.checked !== null && item.checked !== undefined,
  );
}

function nodeKind(node: RootContent): BlockKind {
  switch (node.type) {
    case "heading":
      return "heading";
    case "paragraph":
      return "paragraph";
    case "blockquote":
      return "blockquote";
    case "code":
      return "code";
    case "table":
      return "table";
    case "thematicBreak":
      return "thematicBreak";
    case "list":
      return listHasTasks(node) ? "taskList" : "list";
    default:
      return "source";
  }
}

export function parseBlocks(markdown: string): DocumentBlock[] {
  const tree = parser.parse(markdown) as Root;
  const slugger = new GithubSlugger();
  const blocks: DocumentBlock[] = [];

  tree.children.forEach((node, index) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const kind = nodeKind(node);
    const block: DocumentBlock = {
      id: `block-${index}`,
      index,
      kind,
      markdown: markdown.slice(start, end),
      start,
      end,
      startLine: node.position?.start.line ?? 1,
      endLine: node.position?.end.line ?? node.position?.start.line ?? 1,
    };
    if (node.type === "heading") {
      const heading = node as Heading;
      const text = toString(node);
      const headingId = slugger.slug(text || `section-${index + 1}`);
      block.level = heading.depth;
      block.headingId = headingId;
      block.headingText = text;
      block.id = `heading-${headingId}`;
    }
    blocks.push(block);
  });

  return blocks;
}

export function replaceBlockSource(
  markdown: string,
  block: DocumentBlock,
  nextMarkdown: string,
): string {
  const normalized = nextMarkdown.replace(/\s+$/, "");
  return `${markdown.slice(0, block.start)}${normalized}${markdown.slice(block.end)}`;
}

export function blockAtLine(blocks: DocumentBlock[], line: number): DocumentBlock | undefined {
  return blocks.find((block) => line >= block.startLine && line <= block.endLine);
}

export function headingsFromBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  return blocks.filter(
    (block): block is DocumentBlock & { level: number; headingText: string } =>
      block.kind === "heading" && Boolean(block.level) && Boolean(block.headingText),
  );
}
