import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";

import type { DocumentModel, SearchResult, Settings, VersionSummary } from "../../shared/contracts";
import { api, ApiError } from "../api";
import { buildDiffRows } from "../diff";
import { relativeTime } from "../utils";
import { Icon } from "./Icon";
import styles from "../App.module.css";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (result: SearchResult, newTab: boolean) => void;
}

export function SearchDialog({ open, onOpenChange, onSelect }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      onOpenChange(false);
      return;
    }
    setQuery("");
    setResults([]);
    setError("");
    setActiveIndex(0);
    onOpenChange(true);
  }

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery);
    setResults([]);
    setLoading(false);
    setError("");
    setActiveIndex(0);
  }

  useEffect(() => {
    const needle = query.trim();
    if (!needle) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void api
        .search(needle, controller.signal)
        .then((response) => {
          setResults(response.results);
          setActiveIndex(0);
          setError("");
        })
        .catch((reason) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          setError(reason instanceof Error ? reason.message : "搜索失败");
        })
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function choose(result: SearchResult, newTab: boolean) {
    onSelect(result, newTab);
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.searchDialog}`}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Dialog.Title className={styles.srOnly}>全文档搜索</Dialog.Title>
          <Dialog.Description className={styles.srOnly}>
            搜索所有 Markdown 的标题、路径和正文
          </Dialog.Description>
          <div className={styles.searchDialogTop}>
            <Icon name="search" size={20} />
            <input
              ref={inputRef}
              value={query}
              placeholder="搜索标题、路径和正文…"
              onChange={(event) => changeQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.min(index + 1, results.length - 1));
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.max(index - 1, 0));
                }
                if (event.key === "Enter" && results[activeIndex]) {
                  choose(results[activeIndex], event.metaKey || event.ctrlKey);
                }
              }}
              aria-label="全文档搜索"
            />
            <kbd>ESC</kbd>
          </div>
          <div className={styles.searchDialogHint}>
            全文档搜索与左侧筛选相互独立；⌘/Ctrl + Enter 在新标签打开
          </div>
          <div className={styles.searchResults} role="listbox" aria-label="搜索结果">
            {loading ? <div className={styles.dialogEmpty}>正在翻找资料夹…</div> : null}
            {!loading && error ? <div className={styles.dialogError}>{error}</div> : null}
            {!loading && !error && query.trim() && !results.length ? (
              <div className={styles.dialogEmpty}>没有找到“{query.trim()}”</div>
            ) : null}
            {!query.trim() ? (
              <div className={styles.searchWelcome}>
                <span className={styles.searchWelcomeMark}>⌕</span>
                <strong>从整座资料夹里找一句话</strong>
                <p>服务端会匹配标题、路径和正文，并返回命中的上下文。</p>
              </div>
            ) : null}
            {results.map((result, index) => (
              <button
                key={result.id}
                className={`${styles.searchResult} ${
                  index === activeIndex ? styles.searchResultActive : ""
                }`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={(event) => choose(result, event.metaKey || event.ctrlKey)}
              >
                <span className={styles.searchResultIcon}>
                  <Icon name="file" size={17} />
                </span>
                <span className={styles.searchResultMain}>
                  <strong>{result.title}</strong>
                  <small>{result.path}</small>
                  <span>{result.snippet}</span>
                </span>
                <span className={styles.searchResultLine}>L{result.line}</span>
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface DiffDialogProps {
  open: boolean;
  title: string;
  meta: string;
  oldText: string;
  newText: string;
  onOpenChange: (open: boolean) => void;
  actionLabel?: string;
  onAction?: () => void;
}

export function DiffDialog({
  open,
  title,
  meta,
  oldText,
  newText,
  onOpenChange,
  actionLabel,
  onAction,
}: DiffDialogProps) {
  const rows = useMemo(() => buildDiffRows(oldText, newText), [newText, oldText]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={`${styles.dialogContent} ${styles.diffDialog}`}>
          <div className={styles.dialogHead}>
            <div>
              <span className={styles.kicker}>History diff</span>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{meta}</Dialog.Description>
            </div>
            <div className={styles.dialogHeadActions}>
              {actionLabel && onAction ? (
                <button className={styles.primaryButton} type="button" onClick={onAction}>
                  {actionLabel}
                </button>
              ) : null}
              <Dialog.Close className={styles.iconButton} aria-label="关闭差异">
                <Icon name="close" size={18} />
              </Dialog.Close>
            </div>
          </div>
          <div className={styles.diffTable}>
            <div className={styles.diffHead}>
              <span>旧版本</span>
              <span>当前 / 新版本</span>
            </div>
            {rows.map((row, index) => (
              <div className={`${styles.diffRow} ${styles[`diff_${row.type}`]}`} key={index}>
                <div className={styles.diffCell}>
                  <span className={styles.lineNumber}>{row.oldNumber ?? ""}</span>
                  <code>{row.oldLine}</code>
                </div>
                <div className={styles.diffCell}>
                  <span className={styles.lineNumber}>{row.newNumber ?? ""}</span>
                  <code>{row.newLine}</code>
                </div>
              </div>
            ))}
            {!rows.length ? <div className={styles.dialogEmpty}>内容相同</div> : null}
          </div>
          <div className={styles.mobileDiff}>
            {rows.map((row, index) => (
              <div className={`${styles.diffRow} ${styles[`diff_${row.type}`]}`} key={index}>
                <span className={styles.lineNumber}>
                  {row.type === "add" ? `+${row.newNumber}` : row.oldNumber}
                </span>
                <code>{row.type === "add" ? row.newLine : row.oldLine}</code>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface HistorySheetProps {
  versions: VersionSummary[];
  currentCharCount: number;
  onSelect: (version: VersionSummary) => void;
}

export function HistoryList({ versions, currentCharCount, onSelect }: HistorySheetProps) {
  return (
    <div className={styles.historyList}>
      <div className={styles.historyCurrent}>
        <span className={styles.historyDot} />
        <span>
          <strong>当前正文</strong>
          <small>{currentCharCount} 字 · 工作区版本</small>
        </span>
      </div>
      {versions.map((version) => {
        const delta = version.charDelta;
        return (
          <button
            key={version.id}
            className={styles.historyItem}
            type="button"
            onClick={() => onSelect(version)}
          >
            <span className={styles.historyDot} />
            <span className={styles.historyMain}>
              <strong>{version.reason || "历史版本"}</strong>
              <small>
                {relativeTime(version.createdAt)} · {version.size} B
              </small>
            </span>
            {delta ? (
              <span
                className={`${styles.historyDelta} ${
                  delta > 0 ? styles.deltaUp : styles.deltaDown
                }`}
              >
                {delta > 0 ? "+" : ""}
                {delta}
              </span>
            ) : null}
          </button>
        );
      })}
      {!versions.length ? (
        <div className={styles.railEmpty}>下一次保存后，旧正文会出现在这里。</div>
      ) : null}
    </div>
  );
}

interface NewDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (path: string, title: string) => Promise<void>;
}

interface FavoritesDialogProps {
  open: boolean;
  docs: Record<string, DocumentModel>;
  favorites: Record<string, import("../store/workspace").Favorite[]>;
  onOpenChange: (open: boolean) => void;
  onSelect: (docId: string, favorite: import("../store/workspace").Favorite) => void;
  onRemove: (docId: string, favoriteId: string) => void;
}

export function FavoritesDialog({
  open,
  docs,
  favorites,
  onOpenChange,
  onSelect,
  onRemove,
}: FavoritesDialogProps) {
  const groups = Object.entries(favorites)
    .map(([docId, items]) => ({ doc: docs[docId], docId, items }))
    .filter((group) => group.doc && group.items.length);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          className={`${styles.dialogContent} ${styles.formDialog} ${styles.favoritesDialog}`}
        >
          <div className={styles.dialogHead}>
            <div>
              <span className={styles.kicker}>Quick notes</span>
              <Dialog.Title>我的速记</Dialog.Title>
              <Dialog.Description>收藏的章节会按文档聚合，点击即可跳回原文。</Dialog.Description>
            </div>
            <Dialog.Close className={styles.iconButton} aria-label="关闭速记">
              <Icon name="close" size={18} />
            </Dialog.Close>
          </div>
          <div className={styles.favoriteGroups}>
            {groups.map((group) => (
              <section className={styles.favoriteGroup} key={group.docId}>
                <button
                  className={styles.favoriteDoc}
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    if (group.doc) onSelect(group.docId, group.items[0]!);
                  }}
                >
                  <Icon name="file" size={15} />
                  <span>
                    <strong>{group.doc?.title}</strong>
                    <small>{group.doc?.path}</small>
                  </span>
                </button>
                {group.items.map((favorite) => (
                  <div className={styles.favoriteRow} key={favorite.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenChange(false);
                        onSelect(group.docId, favorite);
                      }}
                    >
                      <span>H{favorite.level}</span>
                      {favorite.title}
                    </button>
                    <button
                      className={styles.favoriteRemove}
                      type="button"
                      aria-label={`移除 ${favorite.title}`}
                      onClick={() => onRemove(group.docId, favorite.id)}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                ))}
              </section>
            ))}
            {!groups.length ? (
              <div className={styles.dialogEmpty}>
                在文章里点击标题左侧的星标，就能把章节收进这里。
              </div>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function NewDocumentDialog({ open, onOpenChange, onCreate }: NewDocumentDialogProps) {
  const [path, setPath] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setPath("");
      setTitle("");
      setError("");
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={`${styles.dialogContent} ${styles.formDialog}`}>
          <div className={styles.dialogHead}>
            <div>
              <span className={styles.kicker}>New page</span>
              <Dialog.Title>新建 Markdown</Dialog.Title>
              <Dialog.Description>路径相对当前资料夹，可自动创建父目录。</Dialog.Description>
            </div>
            <Dialog.Close className={styles.iconButton} aria-label="关闭">
              <Icon name="close" size={18} />
            </Dialog.Close>
          </div>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              void onCreate(path, title)
                .then(() => onOpenChange(false))
                .catch((reason) => setError(reason instanceof Error ? reason.message : "创建失败"))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              <span>标题</span>
              <input
                value={title}
                placeholder="例如：设计笔记"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              <span>路径</span>
              <input
                value={path}
                required
                placeholder="notes/design-notes.md"
                onChange={(event) => setPath(event.target.value)}
              />
            </label>
            {error ? <p className={styles.formError}>{error}</p> : null}
            <div className={styles.formActions}>
              <Dialog.Close type="button" className={styles.ghostButton}>
                取消
              </Dialog.Close>
              <button className={styles.primaryButton} type="submit" disabled={busy}>
                {busy ? "创建中…" : "创建文档"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface IgnoreSettingsDialogProps {
  open: boolean;
  settings: Settings;
  onOpenChange: (open: boolean) => void;
  onSave: (patterns: string[]) => Promise<void>;
}

export function IgnoreSettingsDialog({
  open,
  settings,
  onOpenChange,
  onSave,
}: IgnoreSettingsDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setValue(settings.ignorePatterns.join("\n"));
      setError("");
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={`${styles.dialogContent} ${styles.formDialog}`}>
          <div className={styles.dialogHead}>
            <div>
              <span className={styles.kicker}>Scan rules</span>
              <Dialog.Title>忽略规则</Dialog.Title>
              <Dialog.Description>
                页面规则保存到 .pagenest/settings.json，并与根目录 .gitignore 和 CLI 规则合并。
              </Dialog.Description>
            </div>
            <Dialog.Close className={styles.iconButton} aria-label="关闭">
              <Icon name="close" size={18} />
            </Dialog.Close>
          </div>
          <div className={styles.ruleSummary}>
            <span>
              .gitignore{" "}
              {settings.gitignore.exists ? `${settings.gitignore.ruleCount} 条` : "未发现"}
            </span>
            <span>CLI {settings.cliIgnorePatterns.length} 条</span>
          </div>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              void onSave(value.split(/\r?\n/))
                .then(() => onOpenChange(false))
                .catch((reason) => setError(reason instanceof Error ? reason.message : "保存失败"))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              <span>附加规则</span>
              <textarea
                value={value}
                rows={8}
                placeholder={"drafts/\n**/archive/\n*.private.md"}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            <p className={styles.formHint}>支持注释、否定规则、目录规则、*、**、? 和字符类。</p>
            {error ? <p className={styles.formError}>{error}</p> : null}
            <div className={styles.formActions}>
              <Dialog.Close type="button" className={styles.ghostButton}>
                取消
              </Dialog.Close>
              <button className={styles.primaryButton} type="submit" disabled={busy}>
                {busy ? "重新扫描中…" : "保存并重新扫描"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ConfirmCloseDialogProps {
  doc: DocumentModel | null;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

export function ConfirmCloseDialog({ doc, onCancel, onDiscard, onSave }: ConfirmCloseDialogProps) {
  return (
    <AlertDialog.Root open={Boolean(doc)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={styles.dialogOverlay} />
        <AlertDialog.Content className={`${styles.dialogContent} ${styles.alertDialog}`}>
          <AlertDialog.Title>这篇文档还没保存</AlertDialog.Title>
          <AlertDialog.Description>
            “{doc?.title}”有未保存修改。可以先保存，或放弃这次修改后关闭标签。
          </AlertDialog.Description>
          <div className={styles.formActions}>
            <AlertDialog.Cancel className={styles.ghostButton}>继续编辑</AlertDialog.Cancel>
            <button className={styles.dangerButton} type="button" onClick={onDiscard}>
              放弃修改
            </button>
            <button className={styles.primaryButton} type="button" onClick={onSave}>
              保存并关闭
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

interface RestoreDialogProps {
  version: VersionSummary | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RestoreDialog({ version, onCancel, onConfirm }: RestoreDialogProps) {
  return (
    <AlertDialog.Root open={Boolean(version)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={styles.dialogOverlay} />
        <AlertDialog.Content className={`${styles.dialogContent} ${styles.alertDialog}`}>
          <AlertDialog.Title>恢复这个历史版本？</AlertDialog.Title>
          <AlertDialog.Description>
            恢复前会先把当前正文自动存为“恢复前自动存档”，因此之后仍可撤回。
          </AlertDialog.Description>
          <div className={styles.formActions}>
            <AlertDialog.Cancel className={styles.ghostButton}>取消</AlertDialog.Cancel>
            <button className={styles.primaryButton} type="button" onClick={onConfirm}>
              确认恢复
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

interface ConflictDialogProps {
  conflict: ApiError | null;
  onLoadRemote: () => void;
  onKeepLocal: () => void;
  onViewDiff: () => void;
  onClose: () => void;
}

export function ConflictDialog({
  conflict,
  onLoadRemote,
  onKeepLocal,
  onViewDiff,
  onClose,
}: ConflictDialogProps) {
  return (
    <AlertDialog.Root open={Boolean(conflict)} onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={styles.dialogOverlay} />
        <AlertDialog.Content className={`${styles.dialogContent} ${styles.alertDialog}`}>
          <AlertDialog.Title>磁盘上的文件已经变化</AlertDialog.Title>
          <AlertDialog.Description>
            保存前发现文件被其他程序修改。页面里的草稿仍保留，请选择处理方式。
          </AlertDialog.Description>
          <div className={styles.conflictActions}>
            <button className={styles.ghostButton} type="button" onClick={onViewDiff}>
              查看差异
            </button>
            <button className={styles.dangerButton} type="button" onClick={onLoadRemote}>
              加载对方
            </button>
            <button className={styles.primaryButton} type="button" onClick={onKeepLocal}>
              保留本地
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
