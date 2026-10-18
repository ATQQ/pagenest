import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DOCUMENT_EXTENSIONS = new Set([".md", ".markdown", ".mdown"]);
const IGNORED_DIRECTORIES = new Set([".git", ".pagenest", "node_modules"]);
const VERSION_LIMIT = 200;
const MAX_DOCUMENTS = 20_000;

export class PageNestError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "PageNestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function documentIdForPath(relativePath) {
  return `d-${sha256(relativePath).slice(0, 20)}`;
}

export function deriveTitle(markdown, fallback = "Untitled") {
  const match = String(markdown).match(/^\s*#\s+(.+)$/m);
  if (!match) return fallback;
  return match[1]
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .trim();
}

function textLength(markdown) {
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
    .replace(/\s+/g, "")
    .length;
}

function versionId() {
  return `v-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function isLoopbackHost(host) {
  return ["127.0.0.1", "::1", "localhost"].includes(host);
}

async function atomicWrite(filePath, content) {
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
    if (error.code !== "ENOENT") throw error;
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
  static async open(rootDirectory) {
    const root = await fs.realpath(path.resolve(rootDirectory));
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      throw new PageNestError(400, "NOT_A_DIRECTORY", "The document root must be a directory.");
    }
    return new Library(root);
  }

  constructor(root) {
    this.root = root;
    this.stateDirectory = path.join(root, ".pagenest");
    this.historyDirectory = path.join(this.stateDirectory, "history");
  }

  normalizeDocumentPath(input, { appendExtension = false } = {}) {
    let value = String(input || "").trim().replaceAll("\\", "/");
    if (!value || value.includes("\0")) {
      throw new PageNestError(400, "INVALID_PATH", "A document path is required.");
    }
    if (path.posix.isAbsolute(value)) {
      throw new PageNestError(400, "INVALID_PATH", "Document paths must be relative.");
    }

    value = path.posix.normalize(value.replace(/^\/+/, ""));
    if (
      value === "." ||
      value === ".." ||
      value.startsWith("../") ||
      value.includes("/../")
    ) {
      throw new PageNestError(400, "INVALID_PATH", "Document path escapes the library root.");
    }

    const segments = value.split("/");
    if (
      segments.some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          segment === ".pagenest" ||
          IGNORED_DIRECTORIES.has(segment),
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

  absolutePath(relativePath) {
    const normalized = this.normalizeDocumentPath(relativePath);
    const absolute = path.resolve(this.root, ...normalized.split("/"));
    if (absolute !== this.root && !absolute.startsWith(`${this.root}${path.sep}`)) {
      throw new PageNestError(400, "INVALID_PATH", "Document path escapes the library root.");
    }
    return absolute;
  }

  async assertSafeParent(filePath) {
    const parent = await fs.realpath(path.dirname(filePath)).catch((error) => {
      if (error.code === "ENOENT") {
        throw new PageNestError(400, "PARENT_NOT_FOUND", "The parent directory does not exist.");
      }
      throw error;
    });
    if (parent !== this.root && !parent.startsWith(`${this.root}${path.sep}`)) {
      throw new PageNestError(400, "INVALID_PATH", "Document path escapes the library root.");
    }
  }

  async scanDocuments() {
    const files = [];

    const visit = async (directory) => {
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
        if (entry.isDirectory()) {
          if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) continue;
          await visit(absolute);
          continue;
        }
        if (!entry.isFile() || !DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          continue;
        }
        files.push(absolute);
      }
    };

    await visit(this.root);
    const documents = [];

    for (const absolute of files) {
      const relativePath = path.relative(this.root, absolute).split(path.sep).join("/");
      const [content, stat] = await Promise.all([
        fs.readFile(absolute, "utf8"),
        fs.stat(absolute),
      ]);
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

  async documentById(id) {
    const documents = await this.scanDocuments();
    return documents.find((document) => document.id === id) || null;
  }

  async requireDocument(id) {
    const document = await this.documentById(id);
    if (!document) {
      throw new PageNestError(404, "DOCUMENT_NOT_FOUND", "The document no longer exists.");
    }
    return document;
  }

  historyPath(docId) {
    if (!/^d-[a-f0-9]{20}$/.test(docId)) {
      throw new PageNestError(400, "INVALID_DOCUMENT_ID", "Invalid document id.");
    }
    return path.join(this.historyDirectory, docId);
  }

  async readHistoryIndex(docId) {
    const directory = this.historyPath(docId);
    try {
      const value = JSON.parse(await fs.readFile(path.join(directory, "index.json"), "utf8"));
      return Array.isArray(value) ? value : [];
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return [];
      throw error;
    }
  }

  async listVersions(docId) {
    return (await this.readHistoryIndex(docId)).slice(0, VERSION_LIMIT);
  }

  async getVersion(docId, id) {
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

  async snapshot(docId, markdown, reason, charDelta = 0) {
    const directory = this.historyPath(docId);
    const versions = await this.readHistoryIndex(docId);
    const hash = sha256(markdown);
    if (versions[0]?.hash === hash && versions[0]?.reason === reason) return null;

    const id = versionId();
    const version = {
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

  async saveDocument(id, markdown, { baseHash, force = false, reason = "手动保存" } = {}) {
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
    const doc = await this.requireDocument(id);
    return {
      doc,
      versions: await this.listVersions(id),
      saved: true,
    };
  }

  async createDocument({ path: requestedPath, title, markdown = "" }) {
    const relativePath = this.normalizeDocumentPath(requestedPath, { appendExtension: true });
    const absolute = this.absolutePath(relativePath);

    try {
      await fs.access(absolute);
      throw new PageNestError(409, "DOCUMENT_EXISTS", "A document already exists at this path.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await this.assertSafeParent(absolute);
    const safeTitle = String(title || deriveTitle(markdown, path.posix.basename(relativePath, ".md")))
      .replace(/[\r\n]+/g, " ")
      .trim();
    const content = String(markdown || `# ${safeTitle || "Untitled"}\n\n从这里开始写。\n`);
    await atomicWrite(absolute, content);
    const doc = await this.requireDocument(documentIdForPath(relativePath));
    await this.snapshot(doc.id, content, "创建文档", 0);
    return {
      doc,
      versions: await this.listVersions(doc.id),
    };
  }

  async restoreVersion(id, requestedVersionId) {
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
    return {
      doc: await this.requireDocument(id),
      versions: await this.listVersions(id),
      restored: true,
      sourceVersion: version,
    };
  }

  async search(query) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return [];
    const documents = await this.scanDocuments();
    return documents
      .filter((doc) =>
        `${doc.title} ${doc.path} ${doc.markdown}`.toLowerCase().includes(needle),
      )
      .map((doc) => ({
        id: doc.id,
        path: doc.path,
        title: doc.title,
        updatedAt: doc.updatedAt,
        hash: doc.hash,
      }));
  }

  async bootstrap() {
    const documents = await this.scanDocuments();
    const versions = Object.fromEntries(
      await Promise.all(
        documents.map(async (doc) => [doc.id, await this.listVersions(doc.id)]),
      ),
    );
    return {
      version: 1,
      rootName: path.basename(this.root),
      documentCount: documents.length,
      versionLimit: VERSION_LIMIT,
      documents,
      versions,
    };
  }
}

export { DOCUMENT_EXTENSIONS, MAX_DOCUMENTS, VERSION_LIMIT, isLoopbackHost };
