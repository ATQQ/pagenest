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
        { syntaxHighlighting, defaultHighlightStyle },
      ]) => {
        if (cancelled || !hostRef.current) return;
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
              syntaxHighlighting(defaultHighlightStyle),
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
                    color: "var(--text)",
                    fontSize: "14px",
                  },
                  ".cm-scroller": {
                    fontFamily: '"SFMono-Regular", "Cascadia Code", "Noto Sans Mono", monospace',
                    lineHeight: "1.75",
                    overflow: "auto",
                  },
                  ".cm-content": { padding: "28px 32px 80px" },
                  ".cm-gutters": {
                    backgroundColor: "var(--source-gutter)",
                    color: "var(--muted)",
                    border: "none",
                    paddingLeft: "8px",
                  },
                  ".cm-activeLine, .cm-activeLineGutter": {
                    backgroundColor: "var(--source-active)",
                  },
                  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
                    backgroundColor: "var(--selection) !important",
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
