import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type {
  BootstrapResponse,
  DocumentModel,
  Settings,
  VersionSummary,
} from "../../shared/contracts";

export const UI_STORAGE_KEY = "pagenest.ui.v2";
export const LEGACY_STORAGE_KEY = "pagenest.ui.v1";

export interface Favorite {
  id: string;
  title: string;
  level: number;
  blockIndex: number;
  line: number;
}

export interface TabState {
  docId: string;
  scrollTop: number;
}

export interface WorkspaceUi {
  theme: "paper" | "night";
  sidebarCollapsed: boolean;
  folders: string[];
  railTab: "outline" | "history";
  navMode: "tree" | "list";
}

interface PersistedWorkspace {
  tabs: TabState[];
  activeDocId: string | null;
  drafts: Record<string, string>;
  favorites: Record<string, Favorite[]>;
  ui: WorkspaceUi;
}

interface WorkspaceState extends PersistedWorkspace {
  docs: Record<string, DocumentModel>;
  docOrder: string[];
  versions: Record<string, VersionSummary[]>;
  rootName: string;
  versionLimit: number;
  settings: Settings;
  ready: boolean;
  loading: boolean;
  error: string;
  hydrateServer: (bootstrap: BootstrapResponse) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string) => void;
  openDocument: (docId: string) => void;
  activateDocument: (docId: string) => void;
  closeTab: (docId: string) => void;
  setDraft: (docId: string, markdown: string) => void;
  discardDraft: (docId: string) => void;
  replaceDocument: (doc: DocumentModel, versions: VersionSummary[]) => void;
  replaceVersions: (docId: string, versions: VersionSummary[]) => void;
  removeDocument: (docId: string) => void;
  setTabScroll: (docId: string, scrollTop: number) => void;
  setTheme: (theme: WorkspaceUi["theme"]) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setFolders: (folders: string[]) => void;
  setRailTab: (tab: WorkspaceUi["railTab"]) => void;
  setNavMode: (mode: WorkspaceUi["navMode"]) => void;
  toggleFavorite: (docId: string, favorite: Favorite) => void;
  removeFavorite: (docId: string, favoriteId: string) => void;
}

const defaultUi: WorkspaceUi = {
  theme: "paper",
  sidebarCollapsed: false,
  folders: [],
  railTab: "outline",
  navMode: "tree",
};

const emptySettings: Settings = {
  ignorePatterns: [],
  cliIgnorePatterns: [],
  gitignore: { exists: false, ruleCount: 0 },
};

function objectRecord<T>(value: unknown): Record<string, T> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, T>)
    : {};
}

function migrateLegacy(raw: string): string | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 1) return null;
    const tabs = Array.isArray(value.tabs)
      ? value.tabs
          .map((tab) => {
            if (!tab || typeof tab !== "object") return null;
            const entry = tab as Record<string, unknown>;
            const docId = String(entry.docId || "");
            if (!docId) return null;
            return {
              docId,
              scrollTop: Number(entry.scrollTop) || 0,
            };
          })
          .filter((tab): tab is TabState => Boolean(tab))
      : [];
    const legacyUi = objectRecord<unknown>(value.ui);
    const legacyFavorites = objectRecord<unknown[]>(value.favorites);
    const normalizedFavorites: Record<string, Favorite[]> = {};
    for (const [docId, entries] of Object.entries(legacyFavorites)) {
      if (!Array.isArray(entries)) continue;
      normalizedFavorites[docId] = entries
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const item = entry as Record<string, unknown>;
          const id = String(item.id || "");
          if (!id) return null;
          return {
            id,
            title: String(item.title || "未命名章节"),
            level: Number(item.level) || 1,
            blockIndex: Number(item.blockIndex) || 0,
            line: Number(item.line) || 1,
          };
        })
        .filter((item): item is Favorite => Boolean(item));
    }
    const state: PersistedWorkspace = {
      tabs,
      activeDocId: typeof value.activeDocId === "string" ? value.activeDocId : null,
      drafts: objectRecord<string>(value.drafts),
      favorites: normalizedFavorites,
      ui: {
        theme: legacyUi.theme === "night" ? "night" : "paper",
        sidebarCollapsed: Boolean(legacyUi.sidebarCollapsed),
        folders: Array.isArray(legacyUi.folders)
          ? legacyUi.folders.filter((item): item is string => typeof item === "string")
          : [],
        railTab: legacyUi.railTab === "history" ? "history" : "outline",
        navMode: legacyUi.navMode === "list" ? "list" : "tree",
      },
    };
    return JSON.stringify({ state, version: 2 });
  } catch {
    return null;
  }
}

const storage = createJSONStorage<PersistedWorkspace>(() => ({
  getItem: (name: string) => {
    if (typeof localStorage === "undefined") return null;
    const current = localStorage.getItem(name);
    if (current) return current;
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    const migrated = legacy ? migrateLegacy(legacy) : null;
    if (migrated) localStorage.setItem(name, migrated);
    return migrated;
  },
  setItem: (name: string, value: string) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(name, value);
  },
  removeItem: (name: string) => {
    if (typeof localStorage !== "undefined") localStorage.removeItem(name);
  },
}));

function sortDocumentIds(docs: Record<string, DocumentModel>): string[] {
  return Object.keys(docs).sort((a, b) =>
    docs[a]!.path.localeCompare(docs[b]!.path, "zh-CN", { numeric: true }),
  );
}

export function preferredDocumentId(documents: DocumentModel[]): string | null {
  const rootReadme = documents.find((document) => document.path.toLowerCase() === "readme.md");
  return rootReadme?.id ?? documents[0]?.id ?? null;
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      docs: {},
      docOrder: [],
      versions: {},
      rootName: "",
      versionLimit: 200,
      settings: emptySettings,
      ready: false,
      loading: true,
      error: "",
      tabs: [],
      activeDocId: null,
      drafts: {},
      favorites: {},
      ui: defaultUi,

      hydrateServer: (bootstrap) => {
        const docs = Object.fromEntries(
          bootstrap.documents.map((document) => [document.id, document]),
        );
        const docIds = new Set(bootstrap.documents.map((document) => document.id));
        const current = get();
        const tabs = current.tabs.filter((tab) => docIds.has(tab.docId));
        let activeDocId =
          current.activeDocId && docIds.has(current.activeDocId) ? current.activeDocId : null;
        if (!activeDocId && tabs[0]) activeDocId = tabs[0].docId;
        if (!activeDocId) {
          activeDocId = preferredDocumentId(bootstrap.documents);
        }
        if (activeDocId && !tabs.some((tab) => tab.docId === activeDocId)) {
          tabs.push({ docId: activeDocId, scrollTop: 0 });
        }
        set({
          docs,
          docOrder: sortDocumentIds(docs),
          versions: bootstrap.versions,
          rootName: bootstrap.rootName,
          versionLimit: bootstrap.versionLimit,
          settings: bootstrap.settings,
          tabs,
          activeDocId,
          ready: true,
          loading: false,
          error: "",
        });
      },
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error, loading: false }),
      openDocument: (docId) => {
        if (!get().docs[docId]) return;
        set((state) => {
          const exists = state.tabs.some((tab) => tab.docId === docId);
          return {
            tabs: exists ? state.tabs : [...state.tabs, { docId, scrollTop: 0 }],
            activeDocId: docId,
          };
        });
      },
      activateDocument: (docId) => {
        if (get().docs[docId]) set({ activeDocId: docId });
      },
      closeTab: (docId) =>
        set((state) => {
          const index = state.tabs.findIndex((tab) => tab.docId === docId);
          const tabs = state.tabs.filter((tab) => tab.docId !== docId);
          let activeDocId = state.activeDocId;
          if (state.activeDocId === docId) {
            activeDocId = tabs[Math.min(index, tabs.length - 1)]?.docId ?? tabs[0]?.docId ?? null;
          }
          return { tabs, activeDocId };
        }),
      setDraft: (docId, markdown) =>
        set((state) => {
          const drafts = { ...state.drafts };
          if (state.docs[docId]?.markdown === markdown) delete drafts[docId];
          else drafts[docId] = markdown;
          return { drafts };
        }),
      discardDraft: (docId) =>
        set((state) => {
          const drafts = { ...state.drafts };
          delete drafts[docId];
          return { drafts };
        }),
      replaceDocument: (doc, versions) =>
        set((state) => {
          const docs = { ...state.docs, [doc.id]: doc };
          const drafts = { ...state.drafts };
          delete drafts[doc.id];
          return {
            docs,
            docOrder: sortDocumentIds(docs),
            versions: { ...state.versions, [doc.id]: versions },
            drafts,
          };
        }),
      replaceVersions: (docId, versions) =>
        set((state) => ({
          versions: { ...state.versions, [docId]: versions },
        })),
      removeDocument: (docId) =>
        set((state) => {
          const docs = { ...state.docs };
          delete docs[docId];
          return {
            docs,
            docOrder: sortDocumentIds(docs),
            tabs: state.tabs.filter((tab) => tab.docId !== docId),
            activeDocId: state.activeDocId === docId ? null : state.activeDocId,
          };
        }),
      setTabScroll: (docId, scrollTop) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.docId === docId ? { ...tab, scrollTop } : tab)),
        })),
      setTheme: (theme) => set((state) => ({ ui: { ...state.ui, theme } })),
      setSidebarCollapsed: (sidebarCollapsed) =>
        set((state) => ({ ui: { ...state.ui, sidebarCollapsed } })),
      setFolders: (folders) => set((state) => ({ ui: { ...state.ui, folders } })),
      setRailTab: (railTab) => set((state) => ({ ui: { ...state.ui, railTab } })),
      setNavMode: (navMode) => set((state) => ({ ui: { ...state.ui, navMode } })),
      toggleFavorite: (docId, favorite) =>
        set((state) => {
          const existing = state.favorites[docId] ?? [];
          const next = existing.some((item) => item.id === favorite.id)
            ? existing.filter((item) => item.id !== favorite.id)
            : [...existing, favorite];
          const favorites = { ...state.favorites };
          if (next.length) favorites[docId] = next;
          else delete favorites[docId];
          return { favorites };
        }),
      removeFavorite: (docId, favoriteId) =>
        set((state) => {
          const next = (state.favorites[docId] ?? []).filter((item) => item.id !== favoriteId);
          const favorites = { ...state.favorites };
          if (next.length) favorites[docId] = next;
          else delete favorites[docId];
          return { favorites };
        }),
    }),
    {
      name: UI_STORAGE_KEY,
      version: 2,
      storage,
      partialize: (state): PersistedWorkspace => ({
        tabs: state.tabs,
        activeDocId: state.activeDocId,
        drafts: state.drafts,
        favorites: state.favorites,
        ui: state.ui,
      }),
    },
  ),
);

export function isDocumentDirty(
  doc: DocumentModel | undefined,
  draft: string | undefined,
): boolean {
  return Boolean(doc && draft !== undefined && draft !== doc.markdown);
}

export function workingMarkdown(
  doc: DocumentModel | undefined,
  drafts: Record<string, string>,
): string {
  if (!doc) return "";
  return drafts[doc.id] ?? doc.markdown;
}
