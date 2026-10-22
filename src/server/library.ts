import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createIgnoreMatcher, normalizeIgnorePatterns, parseIgnoreRules } from "./ignore.js";
import type {
  BootstrapResponse,
  CreateDocumentRequest,
  CreateDocumentResponse,
  DocumentModel,
  RestoreVersionResponse,
  SaveDocumentResponse,
  SearchResult,
  Settings,
  VersionDetail,
  VersionSummary,
} from "../shared/contracts.js";

const DOCUMENT_EXTENSIONS = new Set([".md", ".markdown", ".mdown"]);
const ASSET_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);
const HARD_IGNORED_DIRECTORIES = new Set([".git", ".pagenest"]);
const VERSION_LIMIT = 200;
const MAX_DOCUMENTS = 20_000;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 100;

const SEARCH_FIELDS = [
  { key: "title", weight: 120 },
  { key: "path", weight: 90 },
  { key: "markdown", weight: 55 },
] as const;

type SearchField = (typeof SEARCH_FIELDS)[number]["key"];
type MatchKind = "exact" | "typo" | "ordered";

interface FieldMatch {
  field: SearchField;
  index: number;
  length: number;
  kind: MatchKind;
  distance: number;
  score: number;
}

interface SearchIndexDocument {
  doc: DocumentModel;
  fields: Record<SearchField, string>;
  words: Record<SearchField, Array<{ text: string; index: number }>>;
}

interface LibraryOptions {
  ignorePatterns?: unknown;
}

interface PersistedSettings {
  version: 1;
  ignorePatterns: string[];
}

interface SaveDocumentOptions {
  baseHash?: string;
  force?: boolean;
  reason?: string;
}

interface DocumentAsset {
  content: Buffer;
  relativePath: string;
}

export class PageNestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = "PageNestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function documentIdForPath(relativePath: string): string {
  return `d-${sha256(relativePath).slice(0, 20)}`;
}

export function deriveTitle(markdown: string, fallback = "Untitled"): string {
  const match = String(markdown).match(/^\s*#\s+(.+)$/m);
  if (!match) return fallback;
  return match[1]!
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .trim();
}

function textLength(markdown: string): number {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, ""),
    )
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~>-]/g, "")
    .replace(/\s+/g, "").length;
}

function versionId(): string {
  return `v-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function searchTerms(query: unknown): string[] {
  return String(query || "")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
}

function wordSpans(value: string): Array<{ text: string; index: number }> {
  return Array.from(value.matchAll(/[\p{Script=Latin}\p{N}_-]+/gu), (match) => ({
    text: match[0].toLocaleLowerCase(),
    index: match.index,
  }));
}

function uniqueWordSpans(value: string): Array<{ text: string; index: number }> {
  const seen = new Set<string>();
  const words: Array<{ text: string; index: number }> = [];
  for (const word of wordSpans(value)) {
    if (seen.has(word.text)) continue;
    seen.add(word.text);
    words.push(word);
  }
  return words;
}

function typoDistanceLimit(term: string): number {
  if (term.length < 3) return 0;
  return term.length >= 9 ? 2 : 1;
}

function damerauLevenshtein(left: string, right: string, limit: number): number {
  const a = Array.from(left);
  const b = Array.from(right);
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previousPrevious: number[] | null = null;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      let value = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
      if (previousPrevious && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, previousPrevious[j - 2]! + 1);
      }
      current[j] = value;
    }
    previousPrevious = previous;
    previous = current;
  }
  return previous[b.length]!;
}

function findOrderedMatch(value: string, term: string): { index: number; length: number } | null {
  if (Array.from(term).length < 3) return null;
  let cursor = 0;
  let first = -1;
  let last = -1;
  for (let index = 0; index < value.length && cursor < term.length; index += 1) {
    if (value[index] !== term[cursor]) continue;
    if (first < 0) first = index;
    last = index;
    cursor += 1;
  }
  if (cursor < term.length || first < 0) return null;
  const maxSpan = Math.max(40, Array.from(term).length * 10);
  if (last - first + 1 > maxSpan) return null;
  return { index: first, length: last - first + 1 };
}

function findFieldMatch(
  lowerValue: string,
  field: SearchField,
  fieldWeight: number,
  term: string,
  words: Array<{ text: string; index: number }>,
): FieldMatch | null {
  const exactIndex = lowerValue.indexOf(term);
  if (exactIndex >= 0) {
    return {
      field,
      index: exactIndex,
      length: term.length,
      kind: "exact",
      distance: 0,
      score: fieldWeight + 80,
    };
  }

  const typoLimit = typoDistanceLimit(term);
  if (typoLimit && /^[\p{Script=Latin}\p{N}_-]+$/u.test(term)) {
    let best: FieldMatch | null = null;
    for (const word of words) {
      if (Math.abs(word.text.length - term.length) > typoLimit) continue;
      const distance = damerauLevenshtein(term, word.text, typoLimit);
      if (distance > typoLimit) continue;
      const score = fieldWeight * 0.65 + 42 - distance * 8;
      if (!best || score > best.score) {
        best = {
          field,
          index: word.index,
          length: word.text.length,
          kind: "typo",
          distance,
          score,
        };
      }
      if (distance === 1) break;
    }
    if (best) return best;
  }

  const ordered = findOrderedMatch(lowerValue, term);
  if (!ordered) return null;
  return {
    field,
    index: ordered.index,
    length: ordered.length,
    kind: "ordered",
    distance: 0,
    score: fieldWeight * 0.45 + 15,
  };
}

export function isLoopbackHost(host: string): boolean {
  return ["127.0.0.1", "::1", "localhost"].includes(host);
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  );
  let mode = 0o644;
  try {
    mode = (await fs.stat(filePath)).mode & 0o777;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }

  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", mode });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export class Library {
  readonly root: string;
  readonly stateDirectory: string;
  readonly historyDirectory: string;
  readonly settingsPath: string;
  readonly cliIgnorePatterns: string[];
  private searchIndex: SearchIndexDocument[] | null = null;

  static async open(
    rootDirectory: string,
    { ignorePatterns = [] }: LibraryOptions = {},
  ): Promise<Library> {
    const root = await fs.realpath(path.resolve(rootDirectory));
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      throw new PageNestError(400, "NOT_A_DIRECTORY", "The document root must be a directory.");
    }
    return new Library(root, { ignorePatterns });
  }

  constructor(root: string, { ignorePatterns = [] }: LibraryOptions = {}) {
    this.root = root;
    this.stateDirectory = path.join(root, ".pagenest");
    this.historyDirectory = path.join(this.stateDirectory, "history");
    this.settingsPath = path.join(this.stateDirectory, "settings.json");
    this.cliIgnorePatterns = normalizeIgnorePatterns(ignorePatterns);
  }

  private createSearchIndex(documents: DocumentModel[]): SearchIndexDocument[] {
    return documents.map((doc) => ({
      doc,
      fields: {
        title: doc.title.toLocaleLowerCase(),
        path: doc.path.toLocaleLowerCase(),
        markdown: doc.markdown.toLocaleLowerCase(),
      },
      words: {
        title: uniqueWordSpans(doc.title),
        path: uniqueWordSpans(doc.path),
        markdown: uniqueWordSpans(doc.markdown),
      },
    }));
  }

  private invalidateSearchIndex(): void {
    this.searchIndex = null;
  }

  private async getSearchIndex(): Promise<SearchIndexDocument[]> {
    if (!this.searchIndex) {
      this.searchIndex = this.createSearchIndex(await this.scanDocuments());
    }
    return this.searchIndex;
  }

  normalizeDocumentPath(
    input: unknown,
    { appendExtension = false }: { appendExtension?: boolean } = {},
  ): string {
    let value = String(input || "")
      .trim()
      .replaceAll("\\", "/");
    if (!value || value.includes("\0")) {
      throw new PageNestError(400, "INVALID_PATH", "A document path is required.");
    }
    if (path.posix.isAbsolute(value)) {
      throw new PageNestError(400, "INVALID_PATH", "Document paths must be relative.");
    }

    value = path.posix.normalize(value.replace(/^\/+/, ""));
    if (value === "." || value === ".." || value.startsWith("../") || value.includes("/../")) {
      throw new PageNestError(400, "INVALID_PATH", "Document path escapes the library root.");
    }

    const segments = value.split("/");
    if (
      segments.some(
        (segment) =>
          !segment || segment === "." || segment === ".." || HARD_IGNORED_DIRECTORIES.has(segment),
      )
    ) {
      throw new PageNestError(400, "INVALID_PATH", "Document path is not allowed.");
    }

    let extension = path.posix.extname(value).toLowerCase();
    if (!extension && appendExtension) {
      value += ".md";
      extension = ".md";
    }
    if (!DOCUMENT_EXTENSIONS.has(extension)) {
      throw new PageNestError(400, "INVALID_PATH", "Only Markdown files are supported.");
    }
    return value;
  }

  absolutePath(relativePath: string): string {
    const normalized = this.normalizeDocumentPath(relativePath);
    const absolute = path.resolve(this.root, ...normalized.split("/"));
    if (absolute !== this.root && !absolute.startsWith(`${this.root}${path.sep}`)) {
      throw new PageNestError(400, "INVALID_PATH", "Document path escapes the library root.");
    }
    return absolute;
  }

  async assertSafeParent(filePath: string): Promise<void> {
    const parent = await fs.realpath(path.dirname(filePath)).catch((error) => {
      if (errorCode(error) === "ENOENT") {
        throw new PageNestError(400, "PARENT_NOT_FOUND", "The parent directory does not exist.");
      }
      throw error;
    });
    if (parent !== this.root && !parent.startsWith(`${this.root}${path.sep}`)) {
      throw new PageNestError(400, "INVALID_PATH", "Document path escapes the library root.");
    }
  }

  async readSettings(): Promise<PersistedSettings> {
    try {
      const value = JSON.parse(await fs.readFile(this.settingsPath, "utf8")) as {
        ignorePatterns?: unknown;
      };
      return {
        version: 1,
        ignorePatterns: normalizeIgnorePatterns(value?.ignorePatterns),
      };
    } catch (error) {
      if (
        errorCode(error) === "ENOENT" ||
        error instanceof SyntaxError ||
        errorMessage(error).startsWith("Ignore patterns must") ||
        errorMessage(error).startsWith("At most")
      ) {
        return { version: 1, ignorePatterns: [] };
      }
      throw error;
    }
  }

  async readGitignore(): Promise<{ exists: boolean; text: string }> {
    try {
      const text = await fs.readFile(path.join(this.root, ".gitignore"), "utf8");
      return { exists: true, text };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { exists: false, text: "" };
      throw error;
    }
  }

  async ignoreContext() {
    const [settings, gitignore] = await Promise.all([this.readSettings(), this.readGitignore()]);
    const patterns = [...settings.ignorePatterns, ...this.cliIgnorePatterns];
    return {
      settings,
      gitignore,
      matcher: createIgnoreMatcher({
        gitignoreText: gitignore.text,
        patterns,
      }),
    };
  }

  async getSettings(): Promise<Settings> {
    const [settings, gitignore] = await Promise.all([this.readSettings(), this.readGitignore()]);
    return {
      ignorePatterns: settings.ignorePatterns,
      cliIgnorePatterns: this.cliIgnorePatterns,
      gitignore: {
        exists: gitignore.exists,
        ruleCount: parseIgnoreRules(gitignore.text).length,
      },
    };
  }

  async updateIgnorePatterns(ignorePatterns: unknown): Promise<Settings> {
    let normalized: string[];
    try {
      normalized = normalizeIgnorePatterns(ignorePatterns);
    } catch (error) {
      throw new PageNestError(400, "INVALID_IGNORE_PATTERNS", errorMessage(error));
    }
    await atomicWrite(
      this.settingsPath,
      `${JSON.stringify({ version: 1, ignorePatterns: normalized }, null, 2)}\n`,
    );
    this.invalidateSearchIndex();
    return this.getSettings();
  }

  async scanDocuments(): Promise<DocumentModel[]> {
    const files: string[] = [];
    const { matcher } = await this.ignoreContext();

    const visit = async (directory: string, prefix = ""): Promise<void> => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name, "en"));

      for (const entry of entries) {
        if (files.length >= MAX_DOCUMENTS) {
          throw new PageNestError(
            500,
            "TOO_MANY_DOCUMENTS",
            `PageNest supports up to ${MAX_DOCUMENTS} Markdown files at a time.`,
          );
        }
        if (entry.isSymbolicLink()) continue;

        const absolute = path.join(directory, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (HARD_IGNORED_DIRECTORIES.has(entry.name) || matcher.canPruneDirectory(relativePath)) {
            continue;
          }
          await visit(absolute, relativePath);
          continue;
        }
        if (!entry.isFile() || !DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          continue;
        }
        if (matcher.isIgnored(relativePath)) continue;
        files.push(absolute);
      }
    };

    await visit(this.root);
    const documents: DocumentModel[] = [];

    for (const absolute of files) {
      const relativePath = path.relative(this.root, absolute).split(path.sep).join("/");
      const [content, stat] = await Promise.all([fs.readFile(absolute, "utf8"), fs.stat(absolute)]);
      documents.push({
        id: documentIdForPath(relativePath),
        path: relativePath,
        title: deriveTitle(content, path.posix.basename(relativePath, path.extname(relativePath))),
        markdown: content,
        updatedAt: Math.round(stat.mtimeMs),
        size: Buffer.byteLength(content),
        hash: sha256(content),
      });
    }

    return documents.sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true }));
  }

  async documentById(id: string): Promise<DocumentModel | null> {
    const documents = await this.scanDocuments();
    return documents.find((document) => document.id === id) || null;
  }

  async requireDocument(id: string): Promise<DocumentModel> {
    const document = await this.documentById(id);
    if (!document) {
      throw new PageNestError(404, "DOCUMENT_NOT_FOUND", "The document no longer exists.");
    }
    return document;
  }

  async readAsset(docId: string, input: unknown): Promise<DocumentAsset> {
    const document = await this.requireDocument(docId);
    let requestedPath = String(input || "")
      .trim()
      .replaceAll("\\", "/");
    if (!requestedPath || requestedPath.includes("\0")) {
      throw new PageNestError(400, "INVALID_ASSET_PATH", "An asset path is required.");
    }

    const rootRelative = requestedPath.startsWith("/");
    requestedPath = requestedPath.replace(/^\/+/, "");
    const joinedPath = rootRelative
      ? requestedPath
      : path.posix.join(path.posix.dirname(document.path), requestedPath);
    const relativePath = path.posix.normalize(joinedPath);
    if (
      relativePath === "." ||
      relativePath === ".." ||
      relativePath.startsWith("../") ||
      path.posix.isAbsolute(relativePath)
    ) {
      throw new PageNestError(400, "INVALID_ASSET_PATH", "Asset path escapes the library root.");
    }

    const segments = relativePath.split("/");
    if (
      segments.some((segment) => !segment || segment === "." || segment === "..") ||
      segments.some((segment) => HARD_IGNORED_DIRECTORIES.has(segment))
    ) {
      throw new PageNestError(400, "INVALID_ASSET_PATH", "Asset path is not allowed.");
    }
    if (!ASSET_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase())) {
      throw new PageNestError(415, "UNSUPPORTED_ASSET", "This asset type is not supported.");
    }

    const { matcher } = await this.ignoreContext();
    if (matcher.isIgnored(relativePath)) {
      throw new PageNestError(404, "ASSET_NOT_FOUND", "The asset was not found.");
    }

    const absolute = path.resolve(this.root, ...relativePath.split("/"));
    let realPath: string;
    try {
      realPath = await fs.realpath(absolute);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new PageNestError(404, "ASSET_NOT_FOUND", "The asset was not found.");
      }
      throw error;
    }
    if (realPath !== this.root && !realPath.startsWith(`${this.root}${path.sep}`)) {
      throw new PageNestError(400, "INVALID_ASSET_PATH", "Asset path escapes the library root.");
    }

    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      throw new PageNestError(404, "ASSET_NOT_FOUND", "The asset was not found.");
    }
    if (stat.size > MAX_ASSET_BYTES) {
      throw new PageNestError(413, "ASSET_TOO_LARGE", "The asset is too large.");
    }
    return {
      content: await fs.readFile(realPath),
      relativePath,
    };
  }

  historyPath(docId: string): string {
    if (!/^d-[a-f0-9]{20}$/.test(docId)) {
      throw new PageNestError(400, "INVALID_DOCUMENT_ID", "Invalid document id.");
    }
    return path.join(this.historyDirectory, docId);
  }

  async readHistoryIndex(docId: string): Promise<VersionSummary[]> {
    const directory = this.historyPath(docId);
    try {
      const value = JSON.parse(
        await fs.readFile(path.join(directory, "index.json"), "utf8"),
      ) as unknown;
      return Array.isArray(value) ? (value as VersionSummary[]) : [];
    } catch (error) {
      if (errorCode(error) === "ENOENT" || error instanceof SyntaxError) return [];
      throw error;
    }
  }

  async listVersions(docId: string): Promise<VersionSummary[]> {
    return (await this.readHistoryIndex(docId)).slice(0, VERSION_LIMIT);
  }

  async getVersion(docId: string, id: string): Promise<VersionDetail> {
    if (!/^[\w.-]+$/.test(id)) {
      throw new PageNestError(400, "INVALID_VERSION_ID", "Invalid version id.");
    }
    const summaries = await this.readHistoryIndex(docId);
    const summary = summaries.find((version) => version.id === id);
    if (!summary) {
      throw new PageNestError(404, "VERSION_NOT_FOUND", "The saved version was not found.");
    }
    const markdown = await fs.readFile(path.join(this.historyPath(docId), `${id}.md`), "utf8");
    return { ...summary, markdown };
  }

  async snapshot(
    docId: string,
    markdown: string,
    reason: string,
    charDelta = 0,
  ): Promise<VersionSummary | null> {
    const directory = this.historyPath(docId);
    const versions = await this.readHistoryIndex(docId);
    const hash = sha256(markdown);
    if (versions[0]?.hash === hash && versions[0]?.reason === reason) return null;

    const id = versionId();
    const version: VersionSummary = {
      id,
      docId,
      createdAt: Date.now(),
      reason,
      charDelta: Number(charDelta) || 0,
      hash,
      size: Buffer.byteLength(markdown),
    };
    await fs.mkdir(directory, { recursive: true });
    await atomicWrite(path.join(directory, `${id}.md`), markdown);
    const next = [version, ...versions]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, VERSION_LIMIT);
    await atomicWrite(path.join(directory, "index.json"), `${JSON.stringify(next, null, 2)}\n`);

    const retained = new Set(next.map((entry) => entry.id));
    for (const stale of versions) {
      if (!retained.has(stale.id)) {
        await fs.rm(path.join(directory, `${stale.id}.md`), { force: true }).catch(() => {});
      }
    }
    return version;
  }

  async saveDocument(
    id: string,
    markdown: unknown,
    { baseHash, force = false, reason = "手动保存" }: SaveDocumentOptions = {},
  ): Promise<SaveDocumentResponse> {
    if (typeof markdown !== "string") {
      throw new PageNestError(400, "INVALID_MARKDOWN", "Markdown content must be a string.");
    }
    const current = await this.requireDocument(id);
    if (!force && !baseHash) {
      throw new PageNestError(
        428,
        "BASE_HASH_REQUIRED",
        "Reload the document before saving because its base version is missing.",
      );
    }
    if (!force && baseHash !== current.hash) {
      throw new PageNestError(
        409,
        "DOCUMENT_CHANGED",
        "The file changed on disk after you opened it.",
        {
          current,
          versions: await this.listVersions(id),
        },
      );
    }
    if (markdown === current.markdown) {
      return {
        doc: current,
        versions: await this.listVersions(id),
        saved: false,
      };
    }

    const absolute = this.absolutePath(current.path);
    await this.assertSafeParent(absolute);
    await this.snapshot(
      id,
      current.markdown,
      reason === "手动保存" ? "保存前快照" : reason,
      textLength(markdown) - textLength(current.markdown),
    );
    await atomicWrite(absolute, markdown);
    this.invalidateSearchIndex();
    const doc = await this.requireDocument(id);
    return {
      doc,
      versions: await this.listVersions(id),
      saved: true,
    };
  }

  async createDocument({
    path: requestedPath,
    title,
    markdown = "",
  }: CreateDocumentRequest): Promise<CreateDocumentResponse> {
    const relativePath = this.normalizeDocumentPath(requestedPath, { appendExtension: true });
    const absolute = this.absolutePath(relativePath);
    const { matcher } = await this.ignoreContext();
    if (matcher.isIgnored(relativePath)) {
      throw new PageNestError(
        400,
        "IGNORED_PATH",
        "该路径已被 .gitignore 或 PageNest 忽略规则排除。",
      );
    }

    try {
      await fs.access(absolute);
      throw new PageNestError(409, "DOCUMENT_EXISTS", "A document already exists at this path.");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }

    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await this.assertSafeParent(absolute);
    const safeTitle = String(
      title || deriveTitle(markdown, path.posix.basename(relativePath, ".md")),
    )
      .replace(/[\r\n]+/g, " ")
      .trim();
    const content = String(markdown || `# ${safeTitle || "Untitled"}\n\n从这里开始写。\n`);
    await atomicWrite(absolute, content);
    this.invalidateSearchIndex();
    const doc = await this.requireDocument(documentIdForPath(relativePath));
    await this.snapshot(doc.id, content, "创建文档", 0);
    return {
      doc,
      versions: await this.listVersions(doc.id),
    };
  }

  async restoreVersion(id: string, requestedVersionId: string): Promise<RestoreVersionResponse> {
    const [doc, version] = await Promise.all([
      this.requireDocument(id),
      this.getVersion(id, requestedVersionId),
    ]);
    if (doc.markdown === version.markdown) {
      return {
        doc,
        versions: await this.listVersions(id),
        restored: false,
        sourceVersion: version,
      };
    }

    await this.snapshot(id, doc.markdown, "恢复前自动存档", 0);
    await atomicWrite(this.absolutePath(doc.path), version.markdown);
    this.invalidateSearchIndex();
    return {
      doc: await this.requireDocument(id),
      versions: await this.listVersions(id),
      restored: true,
      sourceVersion: version,
    };
  }

  async search(query: unknown): Promise<SearchResult[]> {
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const phrase = terms.join(" ");
    const index = await this.getSearchIndex();
    return index
      .map(({ doc, fields, words }) => {
        const values: Record<SearchField, string> = {
          title: doc.title,
          path: doc.path,
          markdown: doc.markdown,
        };
        const matches: FieldMatch[] = [];
        for (const term of terms) {
          let best: FieldMatch | null = null;
          for (const field of SEARCH_FIELDS) {
            const match = findFieldMatch(
              fields[field.key],
              field.key,
              field.weight,
              term,
              words[field.key],
            );
            if (match && (!best || match.score > best.score)) best = match;
          }
          if (best) matches.push(best);
        }

        const requiredTerms = terms.length <= 2 ? 1 : Math.ceil(terms.length * 0.6);
        if (matches.length < requiredTerms) return null;
        const strongest = matches.reduce((best, match) =>
          match.score > best.score ? match : best,
        );
        const lowerCombined = `${doc.title} ${doc.path} ${doc.markdown}`.toLocaleLowerCase();
        const phraseBonus = lowerCombined.includes(phrase) ? 220 : 0;
        const allTermsBonus = matches.length === terms.length ? 110 : 0;
        const score =
          matches.reduce((total, match) => total + match.score, 0) + phraseBonus + allTermsBonus;

        const value = values[strongest.field];
        const start = Math.max(0, strongest.index - 48);
        const end = Math.min(value.length, strongest.index + strongest.length + 80);
        const snippet = value.slice(start, end).replace(/\s+/g, " ").trim();
        const line =
          strongest.field === "markdown" ? value.slice(0, strongest.index).split("\n").length : 1;
        return {
          score,
          result: {
            id: doc.id,
            path: doc.path,
            title: doc.title,
            updatedAt: doc.updatedAt,
            hash: doc.hash,
            snippet: `${start > 0 ? "…" : ""}${snippet}${end < value.length ? "…" : ""}`,
            line,
          } satisfies SearchResult,
        };
      })
      .filter((entry): entry is { score: number; result: SearchResult } => entry !== null)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.result.updatedAt - left.result.updatedAt ||
          left.result.title.localeCompare(right.result.title, "zh-CN"),
      )
      .slice(0, MAX_SEARCH_RESULTS)
      .map((entry) => entry.result);
  }

  async bootstrap(): Promise<BootstrapResponse> {
    const documents = await this.scanDocuments();
    this.searchIndex = this.createSearchIndex(documents);
    const versions = Object.fromEntries(
      await Promise.all(documents.map(async (doc) => [doc.id, await this.listVersions(doc.id)])),
    );
    return {
      version: 1,
      rootName: path.basename(this.root),
      documentCount: documents.length,
      versionLimit: VERSION_LIMIT,
      documents,
      versions,
      settings: await this.getSettings(),
    };
  }
}

export { DOCUMENT_EXTENSIONS, HARD_IGNORED_DIRECTORIES, MAX_DOCUMENTS, VERSION_LIMIT };
