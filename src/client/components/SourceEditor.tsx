import { useEffect, useRef, useState } from "react";

import styles from "../App.module.css";

interface SourceEditorProps {
  markdown: string;
  dark: boolean;
  onChange: (markdown: string) => void;
  onSave: () => void;
}

export function SourceEditor({ markdown, dark, onChange, onSave }: SourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef(onSave);
  const changeRef = useRef(onChange);
  const viewRef = useRef<import("@codemirror/view").EditorView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    saveRef.current = onSave;
    changeRef.current = onChange;
  }, [onChange, onSave]);

  useEffect(() => {
    let cancelled = false;
    let view: import("@codemirror/view").EditorView | null = null;

    void Promise.all([
      import("@codemirror/state"),
      import("@codemirror/view"),
      import("@codemirror/commands"),
      import("@codemirror/search"),
      import("@codemirror/lang-markdown"),
      import("@codemirror/language"),
      import("@lezer/highlight"),
    ]).then(
      ([
        { EditorState },
        {
          EditorView,
          keymap,
          lineNumbers,
          highlightActiveLineGutter,
          highlightActiveLine,
          drawSelection,
          dropCursor,
        },
        { defaultKeymap, history, historyKeymap, indentWithTab },
        { searchKeymap, highlightSelectionMatches },
        { markdown: markdownLanguage },
        { syntaxHighlighting, HighlightStyle },
        { tags },
      ]) => {
        if (cancelled || !hostRef.current) return;
        const markdownHighlight = HighlightStyle.define([
          {
            tag: [
              tags.heading1,
              tags.heading2,
              tags.heading3,
              tags.heading4,
              tags.heading5,
              tags.heading6,
            ],
            color: "var(--source-syntax-heading)",
            fontWeight: "650",
          },
          {
            tag: tags.strong,
            color: "var(--source-text-strong)",
            fontWeight: "700",
          },
          {
            tag: tags.emphasis,
            color: "var(--source-text)",
            fontStyle: "italic",
          },
          {
            tag: [tags.link, tags.url],
            color: "var(--source-syntax-link)",
            textDecoration: "underline",
          },
          {
            tag: [tags.monospace, tags.string, tags.labelName],
            color: "var(--source-syntax-code)",
            backgroundColor: "var(--source-code-bg)",
          },
          {
            tag: tags.quote,
            color: "var(--source-syntax-quote)",
          },
          {
            tag: tags.strikethrough,
            color: "var(--source-muted)",
            textDecoration: "line-through",
          },
          {
            tag: [tags.processingInstruction, tags.comment, tags.contentSeparator],
            color: "var(--source-syntax-marker)",
          },
        ]);
        view = new EditorView({
          parent: hostRef.current,
          state: EditorState.create({
            doc: markdown,
            extensions: [
              lineNumbers(),
              highlightActiveLineGutter(),
              highlightActiveLine(),
              drawSelection(),
              dropCursor(),
              history(),
              highlightSelectionMatches(),
              markdownLanguage(),
              syntaxHighlighting(markdownHighlight),
              keymap.of([
                {
                  key: "Mod-s",
                  run: () => {
                    saveRef.current();
                    return true;
                  },
                },
                ...searchKeymap,
                ...historyKeymap,
                ...defaultKeymap,
                indentWithTab,
              ]),
              EditorView.lineWrapping,
              EditorView.updateListener.of((update) => {
                if (update.docChanged) changeRef.current(update.state.doc.toString());
              }),
              EditorView.theme(
                {
                  "&": {
                    height: "100%",
                    backgroundColor: "var(--source-bg)",
                    color: "var(--source-text)",
                    fontSize: "14px",
                  },
                  ".cm-scroller": {
                    fontFamily: '"SFMono-Regular", "Cascadia Code", "Noto Sans Mono", monospace',
                    lineHeight: "1.7",
                    overflow: "auto",
                  },
                  ".cm-content": {
                    padding: "28px 32px 80px",
                    caretColor: "var(--source-caret)",
                  },
                  ".cm-gutters": {
                    backgroundColor: "var(--source-gutter)",
                    color: "var(--source-muted)",
                    borderRight: "1px solid var(--source-line)",
                    paddingLeft: "8px",
                  },
                  ".cm-activeLine, .cm-activeLineGutter": {
                    backgroundColor: "var(--source-active)",
                  },
                  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
                    backgroundColor: "var(--selection) !important",
                  },
                  ".cm-cursor, .cm-dropCursor": {
                    borderLeftColor: "var(--source-caret)",
                  },
                  ".cm-panels": {
                    color: "var(--source-text)",
                    backgroundColor: "var(--source-head-bg)",
                  },
                  ".cm-searchMatch": {
                    backgroundColor: "var(--source-search)",
                  },
                  ".cm-searchMatch.cm-searchMatch-selected": {
                    backgroundColor: "var(--source-search-selected)",
                  },
                  "&.cm-focused": { outline: "none" },
                },
                { dark },
              ),
            ],
          }),
        });
        viewRef.current = view;
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      view?.destroy();
      viewRef.current = null;
    };
    // The editor gets the document's starting value; later changes are guarded below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === markdown) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: markdown },
    });
  }, [markdown]);

  return (
    <div className={styles.sourceEditor}>
      {loading ? <div className={styles.sourceLoading}>正在准备源码编辑器…</div> : null}
      <div ref={hostRef} className={styles.sourceEditorHost} />
    </div>
  );
}
