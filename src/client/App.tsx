import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import type {
  DocumentModel,
  SearchResult,
  VersionDetail,
  VersionSummary,
} from "../shared/contracts";
import { api, ApiError } from "./api";
import { Article } from "./components/DocumentView";
import {
  ConflictDialog,
  ConfirmCloseDialog,
  DiffDialog,
  FavoritesDialog,
  HistoryList,
  IgnoreSettingsDialog,
  NewDocumentDialog,
  RestoreDialog,
  SearchDialog,
} from "./components/Dialogs";
import { Icon } from "./components/Icon";
import { Sidebar } from "./components/Sidebar";
import { SourceEditor } from "./components/SourceEditor";
import {
  blockAtLine,
  headingsFromBlocks,
  parseBlocks,
  replaceBlockSource,
  type DocumentBlock,
} from "./markdown/blocks";
import { isDocumentDirty, useWorkspace, workingMarkdown, type Favorite } from "./store/workspace";
import { charCount, relativeTime } from "./utils";
import styles from "./App.module.css";

interface DiffState {
  title: string;
  meta: string;
  oldText: string;
  newText: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ConflictDetails {
  current?: DocumentModel;
  versions?: VersionSummary[];
}

interface EditorSession {
  docId: string | null;
  editMode: boolean;
  sourceMode: boolean;
  editingBlockId: string | null;
}

const closedEditorSession: Omit<EditorSession, "docId"> = {
  editMode: false,
  sourceMode: false,
  editingBlockId: null,
};

const toolbarCommands: Array<{
  command: string;
  label: string;
  title: string;
  value?: string;
  className?: string;
}> = [
  { command: "bold", label: "B", title: "加粗（⌘B）" },
  { command: "italic", label: "I", title: "斜体（⌘I）", className: styles.toolbarItalic },
  { command: "strikeThrough", label: "S", title: "删除线", className: styles.toolbarStrike },
  { command: "insertUnorderedList", label: "•≡", title: "无序列表" },
  { command: "insertOrderedList", label: "1≡", title: "有序列表" },
  { command: "undo", label: "↶", title: "撤销" },
  { command: "redo", label: "↷", title: "重做" },
];

export default function App() {
  const docs = useWorkspace((state) => state.docs);
  const docOrder = useWorkspace((state) => state.docOrder);
  const versions = useWorkspace((state) => state.versions);
  const rootName = useWorkspace((state) => state.rootName);
  const settings = useWorkspace((state) => state.settings);
  const ready = useWorkspace((state) => state.ready);
  const loading = useWorkspace((state) => state.loading);
  const error = useWorkspace((state) => state.error);
  const tabs = useWorkspace((state) => state.tabs);
  const activeDocId = useWorkspace((state) => state.activeDocId);
  const drafts = useWorkspace((state) => state.drafts);
  const favorites = useWorkspace((state) => state.favorites);
  const ui = useWorkspace((state) => state.ui);
  const hydrateServer = useWorkspace((state) => state.hydrateServer);
  const setLoading = useWorkspace((state) => state.setLoading);
  const setError = useWorkspace((state) => state.setError);
  const openDocument = useWorkspace((state) => state.openDocument);
  const activateDocument = useWorkspace((state) => state.activateDocument);
  const closeTab = useWorkspace((state) => state.closeTab);
  const setDraft = useWorkspace((state) => state.setDraft);
  const discardDraft = useWorkspace((state) => state.discardDraft);
  const replaceDocument = useWorkspace((state) => state.replaceDocument);
  const setTabScroll = useWorkspace((state) => state.setTabScroll);
  const setTheme = useWorkspace((state) => state.setTheme);
  const setSidebarCollapsed = useWorkspace((state) => state.setSidebarCollapsed);
  const setFolders = useWorkspace((state) => state.setFolders);
  const setRailTab = useWorkspace((state) => state.setRailTab);
  const setNavMode = useWorkspace((state) => state.setNavMode);
  const toggleFavorite = useWorkspace((state) => state.toggleFavorite);
  const removeFavorite = useWorkspace((state) => state.removeFavorite);

  const documents = useMemo(
    () => docOrder.map((docId) => docs[docId]).filter((doc): doc is DocumentModel => Boolean(doc)),
    [docOrder, docs],
  );
  const activeDoc = activeDocId ? docs[activeDocId] : undefined;
  const markdown = workingMarkdown(activeDoc, drafts);
  const blocks = useMemo(() => parseBlocks(markdown), [markdown]);
  const headings = useMemo(() => headingsFromBlocks(blocks), [blocks]);
  const activeVersions = activeDoc ? (versions[activeDoc.id] ?? []) : [];
  const activeFavorites = activeDoc ? (favorites[activeDoc.id] ?? []) : [];
  const dirtyIds = useMemo(() => new Set(Object.keys(drafts)), [drafts]);
  const favoriteCount = Object.values(favorites).reduce((total, items) => total + items.length, 0);

  const [filter, setFilter] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [newDocumentOpen, setNewDocumentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editor, setEditor] = useState<EditorSession>({
    docId: null,
    ...closedEditorSession,
  });
  const editorSession =
    editor.docId === activeDocId ? editor : { docId: activeDocId, ...closedEditorSession };
  const { editMode, sourceMode, editingBlockId } = editorSession;
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<VersionDetail | null>(null);
  const [diff, setDiff] = useState<DiffState | null>(null);
  const [conflict, setConflict] = useState<ApiError | null>(null);
  const [conflictAfterDiff, setConflictAfterDiff] = useState<ApiError | null>(null);
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const mainScrollRef = useRef<HTMLElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const scrollTimerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2800);
  }, []);

  const loadBootstrap = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const bootstrap = await api.bootstrap(signal);
        hydrateServer(bootstrap);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "读取资料夹失败");
      }
    },
    [hydrateServer, setError, setLoading],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadBootstrap(controller.signal);
    return () => controller.abort();
  }, [loadBootstrap]);

  useEffect(() => {
    document.documentElement.dataset.theme = ui.theme;
  }, [ui.theme]);

  useEffect(() => {
    document.title = activeDoc ? `${activeDoc.title} · 页栖 PageNest` : "页栖 PageNest";
  }, [activeDoc]);

  useEffect(() => {
    if (!activeDocId) return;
    const tab = useWorkspace.getState().tabs.find((entry) => entry.docId === activeDocId);
    const timer = window.setTimeout(() => {
      if (mainScrollRef.current) mainScrollRef.current.scrollTop = tab?.scrollTop || 0;
    }, 30);
    return () => window.clearTimeout(timer);
  }, [activeDocId]);

  useEffect(() => {
    if (highlightLine === null) return;
    const timer = window.setTimeout(() => setHighlightLine(null), 2600);
    return () => window.clearTimeout(timer);
  }, [highlightLine]);

  useEffect(() => {
    if (highlightLine === null) return;
    const block = blockAtLine(blocks, highlightLine);
    if (!block) return;
    window.setTimeout(() => {
      document.getElementById(block.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
  }, [blocks, highlightLine]);

  useEffect(() => {
    if (!ready) return;
    const source = new EventSource("/api/events");
    source.addEventListener("document-updated", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          id: string;
          hash: string;
          path: string;
        };
        const state = useWorkspace.getState();
        const current = state.docs[payload.id];
        if (!current || current.hash === payload.hash) return;
        if (state.drafts[payload.id] !== undefined) {
          setToast(`磁盘文件已更新 · ${payload.path}；保存时会提示冲突`);
          return;
        }
        void api
          .document(payload.id)
          .then((response) => {
            state.replaceDocument(response.doc, response.versions);
            setToast(`磁盘文件已更新 · ${payload.path}`);
          })
          .catch(() => setToast("同步外部修改失败"));
      } catch {
        setToast("收到无法识别的文档更新事件");
      }
    });
    source.addEventListener("document-created", () => {
      void api
        .bootstrap()
        .then((bootstrap) => {
          useWorkspace.getState().hydrateServer(bootstrap);
          setToast("检测到新的 Markdown 文档");
        })
        .catch(() => setToast("同步新文档失败"));
    });
    source.addEventListener("settings-updated", () => {
      void api
        .bootstrap()
        .then((bootstrap) => {
          useWorkspace.getState().hydrateServer(bootstrap);
          setToast("忽略规则已在另一个页面更新");
        })
        .catch(() => setToast("同步忽略规则失败"));
    });
    return () => source.close();
  }, [ready]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!activeDoc) return;
        if (target?.matches("textarea, [contenteditable='true']")) {
          target.blur();
          window.setTimeout(() => void saveActiveDocument(), 0);
        } else {
          void saveActiveDocument();
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "/" && !typing) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(`.${styles.searchBox} input`)?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    const container = mainScrollRef.current;
    if (!container) return;
    const onScroll = () => {
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = window.setTimeout(() => {
        if (activeDocId) setTabScroll(activeDocId, container.scrollTop);
        const top = container.getBoundingClientRect().top + 120;
        let active: string | null = null;
        for (const heading of headings) {
          const element = document.getElementById(heading.id);
          if (element && element.getBoundingClientRect().top <= top)
            active = heading.headingId || null;
        }
        setActiveHeadingId(active);
      }, 100);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    };
  }, [activeDocId, headings, setTabScroll]);

  async function saveDocumentById(
    docId: string,
    { force = false, quiet = false }: { force?: boolean; quiet?: boolean } = {},
  ): Promise<boolean> {
    const state = useWorkspace.getState();
    const doc = state.docs[docId];
    if (!doc || saving) return false;
    const currentMarkdown = state.drafts[docId] ?? doc.markdown;
    setSaving(true);
    try {
      const result = await api.saveDocument(docId, {
        markdown: currentMarkdown,
        baseHash: doc.hash,
        force,
      });
      state.replaceDocument(result.doc, result.versions);
      setConflict(null);
      if (!quiet) showToast(result.saved ? "已保存并生成历史快照" : "内容没有变化");
      return true;
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "DOCUMENT_CHANGED") {
        setConflict(reason);
      } else {
        showToast(reason instanceof Error ? reason.message : "保存失败");
      }
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveActiveDocument(options?: { force?: boolean; quiet?: boolean }) {
    if (!activeDoc) return false;
    return saveDocumentById(activeDoc.id, options);
  }

  function requestClose(docId: string) {
    if (isDocumentDirty(docs[docId], drafts[docId])) setPendingCloseId(docId);
    else closeTab(docId);
  }

  function handleSelectSearch(result: SearchResult) {
    openDocument(result.id);
    setHighlightLine(result.line);
  }

  function selectFavorite(docId: string, favorite: Favorite) {
    openDocument(docId);
    setHighlightLine(favorite.line);
    window.setTimeout(() => {
      const state = useWorkspace.getState();
      const doc = state.docs[docId];
      if (!doc) return;
      const current = parseBlocks(state.drafts[docId] ?? doc.markdown);
      const target =
        current.find((block) => block.headingId === favorite.id) ||
        current.find((block) => block.headingText === favorite.title) ||
        current.find((block) => block.index === favorite.blockIndex);
      if (!target) {
        showToast("这个章节可能已经改名或被移除");
        return;
      }
      document.getElementById(target.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
  }

  function handleToggleFavorite(block: DocumentBlock) {
    if (!activeDoc || !block.headingId) return;
    toggleFavorite(activeDoc.id, {
      id: block.headingId,
      title: block.headingText || "未命名章节",
      level: block.level || 1,
      blockIndex: block.index,
      line: block.startLine,
    });
  }

  function commitBlock(block: DocumentBlock, nextMarkdown: string) {
    if (!activeDoc) return;
    if (nextMarkdown === block.markdown) {
      updateEditor({ editingBlockId: null });
      return;
    }
    setDraft(activeDoc.id, replaceBlockSource(markdown, block, nextMarkdown));
    updateEditor({ editingBlockId: null });
  }

  function updateEditor(patch: Partial<Omit<EditorSession, "docId">>) {
    setEditor({ ...editorSession, ...patch, docId: activeDocId });
  }

  function executeToolbarCommand(event: ReactMouseEvent<HTMLButtonElement>, command: string) {
    event.preventDefault();
    document.execCommand(command);
  }

  function insertInlineCode() {
    const selection = window.getSelection();
    const text = selection?.toString() || "代码";
    document.execCommand("insertHTML", false, `<code>${escapeHtml(text)}</code>`);
  }

  function insertLink() {
    const url = window.prompt("链接地址", "https://");
    if (!url) return;
    document.execCommand("createLink", false, url);
  }

  function insertTask() {
    document.execCommand("insertText", false, "- [ ] ");
  }

  function insertTable() {
    document.execCommand("insertText", false, "| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |");
  }

  function selectHistoryVersion(version: VersionSummary) {
    if (!activeDoc) return;
    void api
      .readVersion(activeDoc.id, version.id)
      .then((response) => {
        setDiff({
          title: `与「${version.reason || "历史版本"}」比较`,
          meta: `${relativeTime(version.createdAt)} · 恢复前会自动保存当前版本`,
          oldText: response.version.markdown,
          newText: markdown,
          actionLabel: "准备恢复",
          onAction: () => {
            setPendingRestore(response.version);
            setDiff(null);
          },
        });
      })
      .catch((reason) => showToast(reason instanceof Error ? reason.message : "读取版本失败"));
  }

  async function restorePendingVersion() {
    if (!activeDoc || !pendingRestore) return;
    try {
      const result = await api.restoreVersion(activeDoc.id, pendingRestore.id);
      replaceDocument(result.doc, result.versions);
      setPendingRestore(null);
      setDiff(null);
      showToast("历史版本已恢复，当前版本已自动存档");
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "恢复失败");
    }
  }

  async function createDocument(path: string, title: string) {
    const result = await api.createDocument({ path, title, markdown: "" });
    const bootstrap = await api.bootstrap();
    hydrateServer(bootstrap);
    openDocument(result.doc.id);
    showToast(`已创建 ${result.doc.path}`);
  }

  async function updateIgnoreSettings(patterns: string[]) {
    const result = await api.updateSettings(patterns);
    useWorkspace.setState({ settings: result.settings });
    await loadBootstrap();
    showToast(`忽略规则已更新 · ${documents.length} 篇 Markdown`);
  }

  function toggleFolder(path: string) {
    setFolders(
      ui.folders.includes(path)
        ? ui.folders.filter((item) => item !== path)
        : [...ui.folders, path],
    );
  }

  function handleConflictLoadRemote() {
    const details = conflict?.details as ConflictDetails | null;
    const current = details?.current;
    if (!current) return;
    replaceDocument(current, details?.versions ?? []);
    setConflict(null);
    showToast("已加载磁盘上的版本");
  }

  function handleConflictViewDiff() {
    if (!conflict || !activeDoc) return;
    const details = conflict.details as ConflictDetails | null;
    const remote = details?.current;
    if (!remote) return;
    const pending = conflict;
    setConflict(null);
    setConflictAfterDiff(pending);
    setDiff({
      title: "本地草稿与磁盘版本",
      meta: `${activeDoc.path} · 左侧为磁盘，右侧为本地`,
      oldText: remote.markdown,
      newText: markdown,
    });
  }

  if (loading && !ready) {
    return (
      <div className={styles.bootScreen}>
        <span className={styles.bootMark}>栖</span>
        <strong>正在打开资料夹</strong>
        <p>读取本地 Markdown 文件…</p>
      </div>
    );
  }

  if (error && !ready) {
    return (
      <div className={styles.bootScreen}>
        <span className={styles.bootMark}>!</span>
        <strong>没能打开资料夹</strong>
        <p>{error}</p>
        <button className={styles.primaryButton} type="button" onClick={() => void loadBootstrap()}>
          重新连接
        </button>
      </div>
    );
  }

  return (
    <Tooltip.Provider delayDuration={450}>
      <div className={styles.app}>
        <header className={styles.topbar}>
          <div className={styles.topbarStart}>
            <TooltipButton label={ui.sidebarCollapsed ? "展开目录" : "收起目录"}>
              <button
                className={styles.iconButton}
                type="button"
                aria-label={ui.sidebarCollapsed ? "展开目录" : "收起目录"}
                onClick={() => {
                  if (window.innerWidth < 768) setMobileSidebarOpen(true);
                  else setSidebarCollapsed(!ui.sidebarCollapsed);
                }}
              >
                <Icon name="menu" size={19} />
              </button>
            </TooltipButton>
            <div className={styles.brand}>
              <span className={styles.brandMark}>栖</span>
              <span className={styles.brandCopy}>
                <strong>页栖</strong>
                <em>PageNest</em>
              </span>
            </div>
          </div>

          <div className={styles.docCrumb}>
            <span className={styles.crumbDot} />
            <span>{activeDoc?.path || "等待文档"}</span>
          </div>

          <div className={styles.topbarActions}>
            <button className={styles.topSearch} type="button" onClick={() => setSearchOpen(true)}>
              <Icon name="search" size={16} />
              <span>全文档搜索</span>
              <kbd>⌘K</kbd>
            </button>
            <button
              className={styles.topStars}
              type="button"
              onClick={() => setFavoritesOpen(true)}
            >
              <Icon name="star" size={16} />
              <span>速记</span>
              <b>{favoriteCount}</b>
            </button>
            <span
              className={`${styles.saveState} ${
                activeDoc && isDocumentDirty(activeDoc, drafts[activeDoc.id])
                  ? styles.saveStateDirty
                  : ""
              }`}
              aria-live="polite"
            >
              {saving
                ? "保存中"
                : activeDoc && isDocumentDirty(activeDoc, drafts[activeDoc.id])
                  ? "未保存"
                  : "已保存"}
            </span>
            <TooltipButton label="整篇 Markdown 源码">
              <button
                className={`${styles.ghostButton} ${styles.sourceButton} ${
                  sourceMode ? styles.buttonActive : ""
                }`}
                type="button"
                aria-label="源码"
                aria-pressed={sourceMode}
                onClick={() => {
                  updateEditor({
                    sourceMode: !sourceMode,
                    editMode: false,
                    editingBlockId: null,
                  });
                }}
              >
                <Icon name="source" size={15} />
                <span>源码</span>
              </button>
            </TooltipButton>
            <button
              className={styles.primaryButton}
              type="button"
              aria-label={editMode ? "完成" : "编辑"}
              onClick={() => {
                updateEditor({
                  editMode: !editMode,
                  sourceMode: false,
                  editingBlockId: null,
                });
              }}
            >
              <Icon name="edit" size={15} />
              {editMode ? "完成" : "编辑"}
            </button>
            <TooltipButton label={ui.theme === "paper" ? "切换夜读主题" : "切换纸页主题"}>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="切换深浅主题"
                onClick={() => setTheme(ui.theme === "paper" ? "night" : "paper")}
              >
                <Icon name={ui.theme === "paper" ? "moon" : "sun"} size={18} />
              </button>
            </TooltipButton>
            <button
              className={`${styles.iconButton} ${styles.mobileRailButton}`}
              type="button"
              aria-label="打开本页目录与历史"
              onClick={() => setMobileRailOpen(true)}
            >
              <Icon name="outline" size={18} />
            </button>
          </div>
        </header>

        <div className={styles.workspace}>
          {(mobileSidebarOpen || mobileRailOpen) && (
            <button
              className={styles.drawerScrim}
              type="button"
              aria-label="关闭抽屉"
              onClick={() => {
                setMobileSidebarOpen(false);
                setMobileRailOpen(false);
              }}
            />
          )}
          <Sidebar
            documents={documents}
            activeDocId={activeDocId}
            navMode={ui.navMode}
            filter={filter}
            folders={ui.folders}
            collapsed={ui.sidebarCollapsed}
            mobileOpen={mobileSidebarOpen}
            rootName={rootName}
            dirtyIds={dirtyIds}
            onFilterChange={setFilter}
            onNavModeChange={setNavMode}
            onOpenDocument={(docId) => {
              openDocument(docId);
              setMobileSidebarOpen(false);
            }}
            onToggleFolder={toggleFolder}
            onNewDocument={() => setNewDocumentOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onRescan={() => void loadBootstrap()}
            onCloseMobile={() => setMobileSidebarOpen(false)}
          />

          <section className={styles.contentColumn}>
            <div className={styles.tabStrip}>
              <div className={styles.tabList} role="tablist" aria-label="已打开文档">
                {tabs.map((tab) => {
                  const doc = docs[tab.docId];
                  if (!doc) return null;
                  return (
                    <button
                      className={`${styles.tab} ${activeDocId === tab.docId ? styles.tabActive : ""}`}
                      type="button"
                      role="tab"
                      aria-selected={activeDocId === tab.docId}
                      onClick={() => activateDocument(tab.docId)}
                      key={tab.docId}
                    >
                      {dirtyIds.has(tab.docId) ? <i className={styles.dirtyDot} /> : null}
                      <span>{doc.title}</span>
                    </button>
                  );
                })}
              </div>
              {activeDoc ? (
                <button
                  className={styles.tabClose}
                  type="button"
                  aria-label={`关闭 ${activeDoc.title}`}
                  onClick={() => requestClose(activeDoc.id)}
                >
                  <Icon name="close" size={13} />
                </button>
              ) : null}
            </div>

            {editMode && !sourceMode ? (
              <div className={styles.editToolbar} aria-label="编辑工具栏">
                <div className={styles.toolbarTypes}>
                  {[
                    ["h1", "H1"],
                    ["h2", "H2"],
                    ["h3", "H3"],
                    ["p", "正文"],
                    ["blockquote", "引用"],
                  ].map(([tag, label]) => (
                    <button
                      key={tag}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        document.execCommand("formatBlock", false, `<${tag}>`);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className={styles.toolbarDivider} />
                <div className={styles.toolbarGroup}>
                  {toolbarCommands.map((item) => (
                    <button
                      key={item.command}
                      className={item.className}
                      type="button"
                      title={item.title}
                      onMouseDown={(event) => executeToolbarCommand(event, item.command)}
                    >
                      {item.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    title="行内代码"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insertInlineCode();
                    }}
                  >
                    &lt;/&gt;
                  </button>
                  <button
                    type="button"
                    title="添加链接"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insertLink();
                    }}
                  >
                    ↗
                  </button>
                  <button
                    type="button"
                    title="任务列表"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insertTask();
                    }}
                  >
                    ☑
                  </button>
                  <button
                    type="button"
                    title="插入表格"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insertTable();
                    }}
                  >
                    ▦
                  </button>
                </div>
                <span className={styles.toolbarHint}>
                  {editingBlockId ? "块编辑中 · Esc 取消 · ⌘Enter 完成" : "点击任意块开始编辑"}
                </span>
                <button
                  className={styles.saveButton}
                  type="button"
                  onClick={() => void saveActiveDocument()}
                >
                  <Icon name="save" size={15} />
                  保存 <kbd>⌘S</kbd>
                </button>
              </div>
            ) : null}

            {sourceMode ? (
              <section className={styles.sourcePane} aria-label="Markdown 源码编辑">
                <div className={styles.sourceHead}>
                  <div>
                    <span className={styles.kicker}>Source</span>
                    <strong>整篇 Markdown</strong>
                  </div>
                  <span>
                    {markdown.split("\n").length} 行 · {charCount(markdown)} 字
                  </span>
                </div>
                <SourceEditor
                  markdown={markdown}
                  dark={ui.theme === "night"}
                  onChange={(value) => activeDoc && setDraft(activeDoc.id, value)}
                  onSave={() => void saveActiveDocument()}
                />
                <div className={styles.sourceFooter}>
                  <span>源码与块编辑共享同一份草稿</span>
                  <button type="button" onClick={() => void saveActiveDocument()}>
                    保存 <kbd>⌘S</kbd>
                  </button>
                </div>
              </section>
            ) : (
              <main className={styles.mainScroll} ref={mainScrollRef}>
                {activeDoc ? (
                  <Article
                    doc={activeDoc}
                    markdown={markdown}
                    blocks={blocks}
                    editMode={editMode}
                    editingBlockId={editingBlockId}
                    favorites={activeFavorites}
                    highlightLine={highlightLine}
                    onStartEdit={(block) => updateEditor({ editingBlockId: block.id })}
                    onCommitBlock={commitBlock}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ) : (
                  <div className={styles.emptyState}>
                    <span className={styles.emptyMark}>栖</span>
                    <h1>{documents.length ? "选择一篇文章" : "资料夹里还没有 Markdown"}</h1>
                    <p>
                      {documents.length
                        ? "从左侧目录树或文档列表打开一篇文章。"
                        : "新建一篇 Markdown，或把已有文件放进当前目录后重新扫描。"}
                    </p>
                    <button
                      className={styles.primaryButton}
                      type="button"
                      onClick={() => setNewDocumentOpen(true)}
                    >
                      <Icon name="plus" size={15} />
                      新建 Markdown
                    </button>
                  </div>
                )}
              </main>
            )}
          </section>

          <aside
            className={`${styles.rail} ${mobileRailOpen ? styles.railMobileOpen : ""}`}
            aria-label="本页导航与历史"
          >
            <div className={styles.railMobileHead}>
              <strong>本页</strong>
              <button type="button" aria-label="关闭" onClick={() => setMobileRailOpen(false)}>
                <Icon name="close" size={17} />
              </button>
            </div>
            <Tabs.Root
              value={ui.railTab}
              onValueChange={(value) => setRailTab(value === "history" ? "history" : "outline")}
              className={styles.railTabs}
            >
              <Tabs.List className={styles.railTabList} aria-label="本页侧栏">
                <Tabs.Trigger value="outline">
                  <Icon name="outline" size={14} /> 目录
                </Tabs.Trigger>
                <Tabs.Trigger value="history">
                  <Icon name="history" size={14} /> 历史
                  <span>{activeVersions.length}</span>
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="outline" className={styles.railContent}>
                <div className={styles.outline}>
                  {headings.map((heading) => (
                    <button
                      key={heading.id}
                      className={`${styles.outlineItem} ${
                        activeHeadingId === heading.headingId ? styles.outlineActive : ""
                      }`}
                      style={{ paddingLeft: `${12 + ((heading.level || 1) - 1) * 13}px` }}
                      type="button"
                      onClick={() => {
                        document
                          .getElementById(heading.id)
                          ?.scrollIntoView({ block: "start", behavior: "smooth" });
                        setMobileRailOpen(false);
                      }}
                    >
                      {heading.headingText}
                    </button>
                  ))}
                  {!headings.length ? (
                    <div className={styles.railEmpty}>正文里还没有标题</div>
                  ) : null}
                </div>
                <div className={styles.pageMeta}>
                  <span>{charCount(markdown)} 字</span>
                  <span>{activeDoc ? relativeTime(activeDoc.updatedAt) : "—"} 更新</span>
                </div>
              </Tabs.Content>
              <Tabs.Content value="history" className={styles.railContent}>
                <HistoryList
                  versions={activeVersions}
                  currentCharCount={charCount(markdown)}
                  onSelect={selectHistoryVersion}
                />
              </Tabs.Content>
            </Tabs.Root>
          </aside>
        </div>

        <SearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onSelect={handleSelectSearch}
        />
        <FavoritesDialog
          open={favoritesOpen}
          docs={docs}
          favorites={favorites}
          onOpenChange={setFavoritesOpen}
          onSelect={selectFavorite}
          onRemove={removeFavorite}
        />
        <NewDocumentDialog
          open={newDocumentOpen}
          onOpenChange={setNewDocumentOpen}
          onCreate={createDocument}
        />
        <IgnoreSettingsDialog
          open={settingsOpen}
          settings={settings}
          onOpenChange={setSettingsOpen}
          onSave={updateIgnoreSettings}
        />
        <ConfirmCloseDialog
          doc={pendingCloseId ? (docs[pendingCloseId] ?? null) : null}
          onCancel={() => setPendingCloseId(null)}
          onDiscard={() => {
            if (!pendingCloseId) return;
            discardDraft(pendingCloseId);
            closeTab(pendingCloseId);
            setPendingCloseId(null);
          }}
          onSave={() => {
            if (!pendingCloseId) return;
            const docId = pendingCloseId;
            void saveDocumentById(docId).then((saved) => {
              if (!saved) return;
              closeTab(docId);
              setPendingCloseId(null);
            });
          }}
        />
        <DiffDialog
          open={Boolean(diff)}
          title={diff?.title || "版本差异"}
          meta={diff?.meta || ""}
          oldText={diff?.oldText || ""}
          newText={diff?.newText || ""}
          actionLabel={diff?.actionLabel}
          onAction={diff?.onAction}
          onOpenChange={(open) => {
            if (open) return;
            setDiff(null);
            if (conflictAfterDiff) {
              setConflict(conflictAfterDiff);
              setConflictAfterDiff(null);
            }
          }}
        />
        <RestoreDialog
          version={pendingRestore}
          onCancel={() => setPendingRestore(null)}
          onConfirm={() => void restorePendingVersion()}
        />
        <ConflictDialog
          conflict={conflict}
          onLoadRemote={handleConflictLoadRemote}
          onKeepLocal={() => {
            if (activeDoc) void saveActiveDocument({ force: true });
          }}
          onViewDiff={handleConflictViewDiff}
          onClose={() => setConflict(null)}
        />
        {toast ? (
          <div className={styles.toast} role="status">
            {toast}
          </div>
        ) : null}
      </div>
    </Tooltip.Provider>
  );
}

function TooltipButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={styles.tooltip} sideOffset={7}>
          {label}
          <Tooltip.Arrow className={styles.tooltipArrow} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

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
