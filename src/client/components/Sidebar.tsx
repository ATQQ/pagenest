import * as ScrollArea from "@radix-ui/react-scroll-area";
import { useMemo } from "react";

import type { DocumentModel } from "../../shared/contracts";
import type { WorkspaceUi } from "../store/workspace";
import { Icon } from "./Icon";
import styles from "../App.module.css";

interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: NavNode[];
}

interface DocumentNode {
  type: "document";
  name: string;
  document: DocumentModel;
}

type NavNode = FolderNode | DocumentNode;

function buildTree(documents: DocumentModel[]): FolderNode {
  const root: FolderNode = { type: "folder", name: "", path: "", children: [] };
  for (const document of documents) {
    const parts = document.path.split("/");
    const fileName = parts.pop()!;
    let current = root;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      const folderPath = parts.slice(0, index + 1).join("/");
      let folder = current.children.find(
        (child): child is FolderNode => child.type === "folder" && child.path === folderPath,
      );
      if (!folder) {
        folder = { type: "folder", name: part, path: folderPath, children: [] };
        current.children.push(folder);
      }
      current = folder;
    }
    current.children.push({ type: "document", name: fileName, document });
  }

  const sortNodes = (node: FolderNode) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
    });
    for (const child of node.children) {
      if (child.type === "folder") sortNodes(child);
    }
  };
  sortNodes(root);
  return root;
}

interface SidebarProps {
  documents: DocumentModel[];
  activeDocId: string | null;
  navMode: WorkspaceUi["navMode"];
  filter: string;
  folders: string[];
  collapsed: boolean;
  mobileOpen: boolean;
  rootName: string;
  dirtyIds: Set<string>;
  onFilterChange: (value: string) => void;
  onNavModeChange: (mode: WorkspaceUi["navMode"]) => void;
  onOpenDocument: (docId: string, newTab?: boolean) => void;
  onToggleFolder: (path: string) => void;
  onNewDocument: () => void;
  onOpenSettings: () => void;
  onRescan: () => void;
  onCloseMobile: () => void;
}

export function Sidebar({
  documents,
  activeDocId,
  navMode,
  filter,
  folders,
  collapsed,
  mobileOpen,
  rootName,
  dirtyIds,
  onFilterChange,
  onNavModeChange,
  onOpenDocument,
  onToggleFolder,
  onNewDocument,
  onOpenSettings,
  onRescan,
  onCloseMobile,
}: SidebarProps) {
  const query = filter.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      documents.filter((document) =>
        `${document.title} ${document.path}`.toLowerCase().includes(query),
      ),
    [documents, query],
  );
  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const openFolders = useMemo(
    () => new Set(query ? collectFolderPaths(tree) : folders),
    [folders, query, tree],
  );

  function renderNode(node: NavNode): React.ReactNode {
    if (node.type === "document") {
      const document = node.document;
      return (
        <button
          className={`${styles.navItem} ${activeDocId === document.id ? styles.navItemActive : ""}`}
          key={document.id}
          type="button"
          title={document.path}
          aria-current={activeDocId === document.id ? "page" : undefined}
          onClick={(event) => onOpenDocument(document.id, event.metaKey || event.ctrlKey)}
        >
          <Icon name="file" size={15} />
          <span>{document.title || node.name}</span>
          {dirtyIds.has(document.id) ? <i className={styles.dirtyDot} aria-label="未保存" /> : null}
        </button>
      );
    }

    const open = openFolders.has(node.path);
    return (
      <div className={styles.treeGroup} key={node.path}>
        <button
          className={styles.folderItem}
          type="button"
          aria-expanded={open}
          onClick={() => onToggleFolder(node.path)}
        >
          <Icon className={open ? styles.chevronOpen : ""} name="chevron" size={14} />
          <Icon name={open ? "folderOpen" : "folder"} size={15} />
          <span>{node.name}</span>
        </button>
        {open ? (
          <div className={styles.treeChildren}>
            {node.children.map((child) => renderNode(child))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <aside
      className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ""} ${
        mobileOpen ? styles.sidebarMobileOpen : ""
      }`}
      aria-label="文档目录"
    >
      <div className={styles.sidebarHead}>
        <div>
          <span className={styles.kicker}>Library</span>
          <strong>资料夹</strong>
        </div>
        <div className={styles.sidebarHeadActions}>
          <button className={styles.miniButton} type="button" onClick={onNewDocument}>
            <Icon name="plus" size={14} />
            新建
          </button>
          <button
            className={styles.mobileClose}
            type="button"
            aria-label="关闭目录"
            onClick={onCloseMobile}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      </div>

      <div className={styles.navModeSwitch} role="group" aria-label="导航形式">
        <button
          className={navMode === "tree" ? styles.navModeActive : ""}
          type="button"
          aria-pressed={navMode === "tree"}
          onClick={() => onNavModeChange("tree")}
        >
          <Icon name="tree" size={15} />
          树形
        </button>
        <button
          className={navMode === "list" ? styles.navModeActive : ""}
          type="button"
          aria-pressed={navMode === "list"}
          onClick={() => onNavModeChange("list")}
        >
          <Icon name="list" size={15} />
          列表
        </button>
      </div>

      <label className={styles.searchBox}>
        <Icon name="search" size={16} />
        <input
          value={filter}
          type="search"
          placeholder="筛选文章标题或路径…"
          autoComplete="off"
          onChange={(event) => onFilterChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onFilterChange("");
          }}
          aria-label="筛选文章标题或路径"
        />
        <kbd>/</kbd>
      </label>

      <ScrollArea.Root className={styles.treeScroll}>
        <ScrollArea.Viewport className={styles.scrollViewport}>
          <nav className={styles.treePanel} aria-label="Markdown 文档">
            {!filtered.length ? (
              <div className={styles.navEmpty}>
                {documents.length ? "没有匹配的文章" : "这个目录还没有 Markdown"}
              </div>
            ) : navMode === "tree" ? (
              tree.children.map((node) => renderNode(node))
            ) : (
              filtered.map((document) => (
                <button
                  className={`${styles.flatItem} ${
                    activeDocId === document.id ? styles.navItemActive : ""
                  }`}
                  key={document.id}
                  type="button"
                  onClick={(event) => onOpenDocument(document.id, event.metaKey || event.ctrlKey)}
                >
                  <Icon name="file" size={15} />
                  <span className={styles.flatMain}>
                    <strong>{document.title}</strong>
                    <small>{document.path}</small>
                  </span>
                  {dirtyIds.has(document.id) ? (
                    <i className={styles.dirtyDot} aria-label="未保存" />
                  ) : null}
                </button>
              ))
            )}
          </nav>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className={styles.scrollbar} orientation="vertical">
          <ScrollArea.Thumb className={styles.scrollThumb} />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>

      <div className={styles.sidebarFoot}>
        <div className={styles.localNote}>
          <span className={styles.localDot} />
          <span title={rootName}>本地服务 · {rootName || "正在读取"}</span>
        </div>
        <div className={styles.sidebarFootActions}>
          <button type="button" onClick={onOpenSettings}>
            <Icon name="settings" size={13} />
            忽略规则
          </button>
          <button type="button" onClick={onRescan}>
            <Icon name="refresh" size={13} />
            重新扫描
          </button>
        </div>
      </div>
    </aside>
  );
}

function collectFolderPaths(root: FolderNode): string[] {
  const paths: string[] = [];
  const visit = (node: FolderNode) => {
    for (const child of node.children) {
      if (child.type === "folder") {
        paths.push(child.path);
        visit(child);
      }
    }
  };
  visit(root);
  return paths;
}
