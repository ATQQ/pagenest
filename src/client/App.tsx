import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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
import { themeKindOf, themeOptions } from "./themes";
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
  mode: EditorMode;
  editingBlockId: string | null;
}

type EditorMode = "read" | "rich" | "source";

const closedEditorSession: Omit<EditorSession, "docId"> = {
  mode: "read",
  editingBlockId: null,
};

const themeGroups: string[] = [...new Set(themeOptions.map((option) => option.group))];

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
  const setRailCollapsed = useWorkspace((state) => state.setRailCollapsed);
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
  const { mode, editingBlockId } = editorSession;
  const richMode = mode === "rich";
  const sourceMode = mode === "source";
  const editing = mode !== "read";
  const activeDirty = Boolean(activeDoc && isDocumentDirty(activeDoc, drafts[activeDoc.id]));
  const activeTheme = themeOptions.find((option) => option.value === ui.theme) ?? themeOptions[0]!;
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<VersionDetail | null>(null);
  const [diff, setDiff] = useState<DiffState | null>(null);
  const [conflict, setConflict] = useState<ApiError | null>(null);
  const [conflictAfterDiff, setConflictAfterDiff] = useState<ApiError | null>(null);
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [readProgress, setReadProgress] = useState(0);
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
    document.documentElement.dataset.themeKind = themeKindOf(ui.theme);
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
        if (editing) void saveAndFinishEditing();
        else void saveActiveDocument();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        setSidebarCollapsed(!useWorkspace.getState().ui.sidebarCollapsed);
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

  useEffect(() => {
    const container = mainScrollRef.current;
    if (!container) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const max = container.scrollHeight - container.clientHeight;
        setReadProgress(max > 0 ? Math.min(1, container.scrollTop / max) : 0);
      });
    };
    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(container);
    if (container.firstElementChild) resizeObserver.observe(container.firstElementChild);
    container.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      container.removeEventListener("scroll", update);
    };
  }, [activeDocId, sourceMode]);

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

  function changeBlockDraft(block: DocumentBlock, nextMarkdown: string) {
    if (!activeDoc || nextMarkdown === block.markdown) return;
    setDraft(activeDoc.id, replaceBlockSource(markdown, block, nextMarkdown));
  }

  function updateEditor(patch: Partial<Omit<EditorSession, "docId">>) {
    setEditor({ ...editorSession, ...patch, docId: activeDocId });
  }

  function beginEditing() {
    if (!activeDoc) return;
    updateEditor({ mode: "rich", editingBlockId: null });
  }

  function switchEditorMode(nextMode: Exclude<EditorMode, "read">) {
    if (!activeDoc || nextMode === mode) return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    updateEditor({ mode: nextMode, editingBlockId: null });
  }

  function cancelEditing() {
    if (!activeDoc) return;
    discardDraft(activeDoc.id);
    updateEditor({ mode: "read", editingBlockId: null });
    showToast("已取消本次修改");
  }

  async function saveAndFinishEditing() {
    if (!activeDoc) return;
    const docId = activeDoc.id;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();

    // Let contenteditable blur handlers fold the current block back into the draft first.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    const saved = await saveDocumentById(docId);
    if (!saved) return;
    setEditor((current) =>
      current.docId === docId ? { docId, mode: "read", editingBlockId: null } : current,
    );
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
        {activeDoc && !sourceMode ? (
          <div className={styles.readProgress} aria-hidden="true">
            <span style={{ transform: `scaleX(${readProgress})` }} />
          </div>
        ) : null}
        <header className={styles.topbar}>
          <div className={styles.topbarStart}>
            <button
              className={`${styles.iconButton} ${styles.mobileMenuButton}`}
              type="button"
              aria-label="打开目录"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Icon name="menu" size={19} />
            </button>
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
              {saving ? "保存中" : activeDirty ? "未保存" : "已保存"}
            </span>
            {editing ? (
              <span className={styles.modeLive} aria-live="polite">
                <i />
                {sourceMode ? "源码编辑中" : "富文本编辑中"}
              </span>
            ) : (
              <button
                className={styles.primaryButton}
                type="button"
                aria-label="编辑文档"
                onClick={beginEditing}
                disabled={!activeDoc}
              >
                <Icon name="edit" size={15} />
                编辑文档
              </button>
            )}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className={styles.themeControl}
                  type="button"
                  aria-label={`选择主题：${activeTheme.label}`}
                  title={`当前主题：${activeTheme.label}`}
                >
                  <Icon name={activeTheme.icon} size={16} />
                  <span>{activeTheme.label}</span>
                  <Icon className={styles.themeChevron} name="chevron" size={11} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className={styles.themeMenu}
                  sideOffset={8}
                  align="end"
                  aria-label="阅读主题"
                >
                  <DropdownMenu.Label className={styles.themeMenuLabel}>
                    阅读主题
                  </DropdownMenu.Label>
                  {themeGroups.map((group) => (
                    <DropdownMenu.Group key={group}>
                      <DropdownMenu.Label className={styles.themeGroupLabel}>
                        {group}
                      </DropdownMenu.Label>
                      {themeOptions
                        .filter((option) => option.group === group)
                        .map((option) => (
                          <DropdownMenu.Item
                            className={styles.themeMenuItem}
                            key={option.value}
                            onSelect={() => setTheme(option.value)}
                          >
                            <span
                              className={styles.themeSwatch}
                              style={{
                                background: `linear-gradient(135deg, ${option.swatch[0]} 0 52%, ${option.swatch[1]} 52% 100%)`,
                              }}
                            />
                            <span className={styles.themeMenuCopy}>
                              <strong>{option.label}</strong>
                              <small>{option.description}</small>
                            </span>
                            {ui.theme === option.value ? (
                              <Icon className={styles.themeCheck} name="check" size={15} />
                            ) : null}
                          </DropdownMenu.Item>
                        ))}
                    </DropdownMenu.Group>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
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

        <div
          className={`${styles.workspace} ${
            ui.sidebarCollapsed ? styles.workspaceSidebarClosed : styles.workspaceSidebarOpen
          } ${ui.railCollapsed ? styles.workspaceRailClosed : styles.workspaceRailOpen}`}
        >
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
          <TooltipButton label={ui.sidebarCollapsed ? "展开资料夹" : "收起资料夹"} side="right">
            <button
              className={`${styles.panelToggle} ${styles.panelToggleLeft}`}
              type="button"
              aria-label={ui.sidebarCollapsed ? "展开资料夹" : "收起资料夹"}
              aria-pressed={!ui.sidebarCollapsed}
              onClick={() => setSidebarCollapsed(!ui.sidebarCollapsed)}
            >
              <Icon name={ui.sidebarCollapsed ? "chevronRight" : "chevronLeft"} size={13} />
            </button>
          </TooltipButton>

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
            onCollapse={() => setSidebarCollapsed(true)}
            onCloseMobile={() => setMobileSidebarOpen(false)}
          />

          <section className={styles.contentColumn}>
            <div className={styles.tabStrip}>
              {ui.sidebarCollapsed ? (
                <button
                  className={styles.sidebarExpandButton}
                  type="button"
                  aria-label="展开侧栏"
                  title="展开侧栏（⌘\）"
                  onClick={() => setSidebarCollapsed(false)}
                >
                  <Icon name="sidebar" size={17} />
                </button>
              ) : null}
              <nav className={styles.tabList} aria-label="已打开文档">
                {tabs.map((tab) => {
                  const doc = docs[tab.docId];
                  if (!doc) return null;
                  const selected = activeDocId === tab.docId;
                  return (
                    <div
                      className={`${styles.tab} ${selected ? styles.tabActive : ""}`}
                      onAuxClick={(event) => {
                        if (event.button === 1) requestClose(tab.docId);
                      }}
                      key={tab.docId}
                    >
                      <button
                        className={styles.tabMain}
                        type="button"
                        aria-current={selected ? "page" : undefined}
                        title={doc.path}
                        onClick={() => activateDocument(tab.docId)}
                      >
                        {dirtyIds.has(tab.docId) ? <i className={styles.dirtyDot} /> : null}
                        <span>{doc.title}</span>
                      </button>
                      <button
                        className={styles.tabClose}
                        type="button"
                        aria-label={`关闭 ${doc.title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          requestClose(tab.docId);
                        }}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  );
                })}
              </nav>
              {ui.railCollapsed ? (
                <button
                  className={styles.railExpandButton}
                  type="button"
                  aria-label="展开本页侧栏"
                  title="展开本页侧栏"
                  onClick={() => setRailCollapsed(false)}
                >
                  <Icon name="sidebarRight" size={17} />
                </button>
              ) : null}
            </div>

            {editing ? (
              <div className={styles.editorModeBar} aria-label="文档编辑控制">
                <div className={styles.editorModeIntro}>
                  <span className={styles.editorModeDot} />
                  <div>
                    <span>当前模式</span>
                    <strong>{sourceMode ? "源码编辑" : "富文本编辑"}</strong>
                  </div>
                </div>
                <div className={styles.editorModeSwitch} role="group" aria-label="编辑方式">
                  <button
                    className={richMode ? styles.editorModeActive : ""}
                    type="button"
                    aria-pressed={richMode}
                    onClick={() => switchEditorMode("rich")}
                  >
                    <Icon name="edit" size={14} />
                    富文本
                  </button>
                  <button
                    className={sourceMode ? styles.editorModeActive : ""}
                    type="button"
                    aria-pressed={sourceMode}
                    onClick={() => switchEditorMode("source")}
                  >
                    <Icon name="source" size={14} />
                    Markdown 源码
                  </button>
                </div>
                <span className={styles.editorModeHint}>
                  {richMode
                    ? "点击正文中的段落开始编辑，文字样式和版式保持不变"
                    : "直接编辑整篇 Markdown，修改自动保留为本地草稿"}
                </span>
                <span
                  className={`${styles.editorDraftState} ${
                    activeDirty ? styles.editorDraftStateDirty : ""
                  }`}
                  aria-live="polite"
                >
                  <i />
                  {activeDirty ? "有未保存修改" : "没有待保存修改"}
                </span>
                <div className={styles.editorModeActions}>
                  <button className={styles.cancelEditButton} type="button" onClick={cancelEditing}>
                    取消更改
                  </button>
                  <button
                    className={styles.saveButton}
                    type="button"
                    onClick={() => void saveAndFinishEditing()}
                    disabled={saving}
                  >
                    <Icon name="save" size={15} />
                    {saving ? "保存中…" : "保存并返回"} <kbd>⌘S</kbd>
                  </button>
                </div>
              </div>
            ) : null}

            {richMode ? (
              <div className={styles.editToolbar} aria-label="富文本格式工具">
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
                  {editingBlockId
                    ? "当前块编辑中 · Esc 取消 · ⌘Enter 完成"
                    : "点击任意段落开始编辑"}
                </span>
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
                  dark={themeKindOf(ui.theme) === "dark"}
                  onChange={(value) => activeDoc && setDraft(activeDoc.id, value)}
                  onSave={() => void saveAndFinishEditing()}
                />
                <div className={styles.sourceFooter}>
                  <span>源码与富文本共享同一份草稿</span>
                  <span>⌘S 保存并返回 · 取消更改会舍弃本次草稿</span>
                </div>
              </section>
            ) : (
              <main className={styles.mainScroll} ref={mainScrollRef}>
                {activeDoc ? (
                  <Article
                    doc={activeDoc}
                    markdown={markdown}
                    blocks={blocks}
                    editMode={richMode}
                    editingBlockId={editingBlockId}
                    favorites={activeFavorites}
                    highlightLine={highlightLine}
                    onStartEdit={(block) => updateEditor({ editingBlockId: String(block.index) })}
                    onDraftChange={changeBlockDraft}
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
            className={`${styles.rail} ${ui.railCollapsed ? styles.railCollapsed : ""} ${
              mobileRailOpen ? styles.railMobileOpen : ""
            }`}
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
              <div className={styles.railHead}>
                <Tabs.List className={styles.railTabList} aria-label="本页侧栏">
                  <Tabs.Trigger value="outline">
                    <Icon name="outline" size={14} /> 目录
                  </Tabs.Trigger>
                  <Tabs.Trigger value="history">
                    <Icon name="history" size={14} /> 历史
                    <span>{activeVersions.length}</span>
                  </Tabs.Trigger>
                </Tabs.List>
                <button
                  className={styles.railCollapseButton}
                  type="button"
                  aria-label="收起本页侧栏"
                  title="收起本页侧栏"
                  onClick={() => setRailCollapsed(true)}
                >
                  <Icon name="sidebarRight" size={17} />
                </button>
              </div>
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

          <TooltipButton label={ui.railCollapsed ? "展开本页导航" : "收起本页导航"} side="left">
            <button
              className={`${styles.panelToggle} ${styles.panelToggleRight}`}
              type="button"
              aria-label={ui.railCollapsed ? "展开本页导航" : "收起本页导航"}
              aria-pressed={!ui.railCollapsed}
              onClick={() => setRailCollapsed(!ui.railCollapsed)}
            >
              <Icon name={ui.railCollapsed ? "chevronLeft" : "chevronRight"} size={13} />
            </button>
          </TooltipButton>
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

function TooltipButton({
  label,
  side,
  children,
}: {
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={styles.tooltip} side={side} sideOffset={7}>
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
