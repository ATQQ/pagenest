import {
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type { DocumentModel } from "../../shared/contracts";
import type { DocumentBlock } from "../markdown/blocks";
import { MarkdownAssetProvider, renderMarkdown } from "../markdown/render";
import type { Favorite } from "../store/workspace";
import { Icon } from "./Icon";
import styles from "../App.module.css";

const richEditableKinds = new Set(["heading", "paragraph", "blockquote"]);
const headingEditorClasses: Record<number, string> = {
  1: styles.richEditorH1 ?? "",
  2: styles.richEditorH2 ?? "",
  3: styles.richEditorH3 ?? "",
  4: styles.richEditorH4 ?? "",
  5: styles.richEditorH5 ?? "",
  6: styles.richEditorH6 ?? "",
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function inlineMarkdownToHtml(markdown: string): string {
  let html = escapeHtml(markdown);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1");
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  return html.replace(/\n/g, "<br>");
}

function inlineNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (!(node instanceof HTMLElement)) return "";
  const children = [...node.childNodes].map(inlineNodeToMarkdown).join("");
  switch (node.tagName) {
    case "BR":
      return "\n";
    case "STRONG":
    case "B":
      return `**${children}**`;
    case "EM":
    case "I":
      return `*${children}*`;
    case "DEL":
    case "S":
    case "STRIKE":
      return `~~${children}~~`;
    case "CODE":
      return `\`${children}\``;
    case "A": {
      const href = node.getAttribute("href") || "#";
      return `[${children}](${href})`;
    }
    case "DIV":
    case "P":
      return `${children}\n`;
    default:
      return children;
  }
}

function editableHtml(block: DocumentBlock): string {
  if (block.kind === "heading") {
    return inlineMarkdownToHtml(block.markdown.replace(/^#{1,6}\s+/, ""));
  }
  if (block.kind === "blockquote") {
    return inlineMarkdownToHtml(
      block.markdown
        .split("\n")
        .map((line) => line.replace(/^>\s?/, ""))
        .join("\n"),
    );
  }
  return inlineMarkdownToHtml(block.markdown);
}

function commitRichBlock(block: DocumentBlock, element: HTMLElement): string {
  const markdown = [...element.childNodes]
    .map(inlineNodeToMarkdown)
    .join("")
    .replace(/\u00a0/g, " ")
    .trim();
  if (block.kind === "heading") {
    return `${"#".repeat(block.level || 1)} ${markdown.replace(/\s*\n+\s*/g, " ")}`;
  }
  if (block.kind === "blockquote") {
    return markdown
      .split("\n")
      .map((line) => `> ${line}`.trimEnd())
      .join("\n");
  }
  return markdown;
}

interface BlockViewProps {
  block: DocumentBlock;
  editMode: boolean;
  editing: boolean;
  favorite: boolean;
  highlighted: boolean;
  onStartEdit: (block: DocumentBlock) => void;
  onDraftChange: (block: DocumentBlock, markdown: string) => void;
  onCommit: (block: DocumentBlock, markdown: string) => void;
  onToggleFavorite: (block: DocumentBlock) => void;
}

function BlockView({
  block,
  editMode,
  editing,
  favorite,
  highlighted,
  onStartEdit,
  onDraftChange,
  onCommit,
  onToggleFavorite,
}: BlockViewProps) {
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const committedRef = useRef(false);
  const sourceCommittedRef = useRef(false);
  const [originalMarkdown] = useState(block.markdown);
  const [source, setSource] = useState(block.markdown);
  const [initialHtml] = useState(() => editableHtml(block));
  const rich = richEditableKinds.has(block.kind);

  function commitRich(element: HTMLElement) {
    if (!editing || !rich || committedRef.current) return;
    committedRef.current = true;
    onCommit(block, commitRichBlock(block, element));
  }

  function commitSource() {
    if (!editing || rich || sourceCommittedRef.current) return;
    sourceCommittedRef.current = true;
    onCommit(block, source.trim());
  }

  function handleRichKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      committedRef.current = true;
      onCommit(block, originalMarkdown);
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      commitRich(event.currentTarget);
    }
  }

  const headingLevel = Math.min(6, Math.max(1, block.level || 1));
  const richEditorTag =
    block.kind === "heading"
      ? (`h${headingLevel}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
      : block.kind === "blockquote"
        ? "blockquote"
        : "p";
  const richEditorProps = {
    className: `${styles.richEditor} ${
      block.kind === "heading"
        ? headingEditorClasses[headingLevel]
        : block.kind === "blockquote"
          ? styles.richEditorQuote
          : styles.richEditorParagraph
    }`,
    contentEditable: true,
    suppressContentEditableWarning: true,
    role: "textbox",
    "aria-multiline": block.kind !== "heading",
    "aria-label": block.kind === "heading" ? `编辑${block.headingText || "标题"}` : "编辑内容块",
    dangerouslySetInnerHTML: { __html: initialHtml },
    onBlur: (event: ReactFocusEvent<HTMLElement>) => commitRich(event.currentTarget),
    onInput: (event: ReactFormEvent<HTMLElement>) => {
      if (!committedRef.current) {
        onDraftChange(block, commitRichBlock(block, event.currentTarget));
      }
    },
    onKeyDown: handleRichKeyDown,
  };
  let richEditor;
  if (block.kind === "heading") {
    const HeadingTag = richEditorTag as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    richEditor = <HeadingTag {...richEditorProps} />;
  } else if (block.kind === "blockquote") {
    richEditor = <blockquote {...richEditorProps} />;
  } else {
    richEditor = <p {...richEditorProps} />;
  }

  const wrapperClass = `${styles.block} ${editMode ? styles.blockEditable : ""} ${
    editing ? styles.blockEditing : ""
  } ${highlighted ? styles.blockHighlighted : ""}`;

  return (
    <div
      id={block.id}
      className={wrapperClass}
      data-block-index={block.index}
      data-block-kind={block.kind}
      data-block-level={block.level}
      onClick={() => {
        if (editMode && !editing) onStartEdit(block);
      }}
    >
      {block.kind === "heading" ? (
        <button
          className={`${styles.headingFavorite} ${favorite ? styles.headingFavoriteOn : ""}`}
          type="button"
          aria-label={`${favorite ? "取消收藏" : "收藏"} ${block.headingText || "章节"}`}
          aria-pressed={favorite}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(block);
          }}
        >
          <Icon name="star" size={15} />
        </button>
      ) : null}

      {editing && rich ? (
        richEditor
      ) : editing && !rich ? (
        <div className={styles.blockSourceEditor}>
          <div className={styles.blockSourceLabel}>
            <span>
              {block.kind === "table" ? "表格" : block.kind === "code" ? "代码" : "Markdown 片段"}
            </span>
            <span>复杂结构使用源码编辑</span>
          </div>
          <textarea
            ref={sourceRef}
            value={source}
            autoFocus
            spellCheck={false}
            onChange={(event) => setSource(event.target.value)}
            onBlur={commitSource}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                sourceCommittedRef.current = true;
                onCommit(block, originalMarkdown);
              }
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                commitSource();
              }
            }}
            aria-label="编辑 Markdown 片段"
          />
          <div className={styles.blockSourceActions}>
            <button type="button" onClick={() => onCommit(block, originalMarkdown)}>
              取消
            </button>
            <button className={styles.smallPrimary} type="button" onClick={commitSource}>
              完成
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.renderedBlock}>{renderMarkdown(block.markdown)}</div>
      )}
    </div>
  );
}

interface ArticleProps {
  doc: DocumentModel;
  markdown: string;
  blocks: DocumentBlock[];
  editMode: boolean;
  editingBlockId: string | null;
  favorites: Favorite[];
  highlightLine: number | null;
  onStartEdit: (block: DocumentBlock) => void;
  onDraftChange: (block: DocumentBlock, markdown: string) => void;
  onCommitBlock: (block: DocumentBlock, markdown: string) => void;
  onToggleFavorite: (block: DocumentBlock) => void;
}

export function Article({
  doc,
  markdown,
  blocks,
  editMode,
  editingBlockId,
  favorites,
  highlightLine,
  onStartEdit,
  onDraftChange,
  onCommitBlock,
  onToggleFavorite,
}: ArticleProps) {
  const favoriteIds = new Set(favorites.map((favorite) => favorite.id));
  return (
    <MarkdownAssetProvider document={doc}>
      <article className={styles.article} aria-label="文档正文">
        {blocks.map((block) => (
          <BlockView
            key={`${block.index}:${editingBlockId === String(block.index) ? "editing" : "reading"}`}
            block={block}
            editMode={editMode}
            editing={editingBlockId === String(block.index)}
            favorite={Boolean(block.headingId && favoriteIds.has(block.headingId))}
            highlighted={Boolean(
              highlightLine && highlightLine >= block.startLine && highlightLine <= block.endLine,
            )}
            onStartEdit={onStartEdit}
            onDraftChange={onDraftChange}
            onCommit={onCommitBlock}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
        {!blocks.length && markdown.trim() ? (
          <div className={styles.sourceFallback}>{markdown}</div>
        ) : null}
        {!markdown.trim() ? (
          <div className={styles.emptyDocument}>
            <span>空白页</span>
            <p>进入编辑模式，点击这里开始写。</p>
          </div>
        ) : null}
      </article>
    </MarkdownAssetProvider>
  );
}
