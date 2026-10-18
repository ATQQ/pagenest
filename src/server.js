import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Library, PageNestError } from "./library.js";

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIRECTORY = path.resolve(SOURCE_DIRECTORY, "../public");
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const TOKEN_COOKIE = "pagenest_token";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendText(response, status, value) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(value);
}

async function readJson(request) {
  const length = Number(request.headers["content-length"] || 0);
  if (length > MAX_JSON_BYTES) {
    throw new PageNestError(413, "BODY_TOO_LARGE", "Request body is too large.");
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_JSON_BYTES) {
      throw new PageNestError(413, "BODY_TOO_LARGE", "Request body is too large.");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PageNestError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function cookieValue(request, name) {
  const cookies = String(request.headers.cookie || "").split(";");
  for (const entry of cookies) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(entry.slice(separator + 1).trim());
  }
  return "";
}

function securityHeaders() {
  return {
    "content-security-policy":
      "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function sameOrigin(request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return true;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function isTokenAuthorized(request, url, token) {
  if (!token) return true;
  const queryToken = url.searchParams.get("token");
  const headerToken = request.headers["x-pagenest-token"];
  const storedToken = cookieValue(request, TOKEN_COOKIE);
  return queryToken === token || headerToken === token || storedToken === token;
}

function tokenRedirect(url) {
  const next = new URL(url);
  next.searchParams.delete("token");
  return `${next.pathname}${next.search}${next.hash}`;
}

async function serveStatic(request, response, url, publicDirectory) {
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    throw new PageNestError(400, "INVALID_PATH", "Invalid URL path.");
  }

  if (pathname === "/") pathname = "/index.html";
  const absolute = path.resolve(publicDirectory, `.${pathname}`);
  if (
    absolute !== publicDirectory &&
    !absolute.startsWith(`${publicDirectory}${path.sep}`)
  ) {
    throw new PageNestError(403, "FORBIDDEN", "Static path is outside the public directory.");
  }

  let content;
  try {
    content = await fs.readFile(absolute);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      throw new PageNestError(404, "NOT_FOUND", "Not found.");
    }
    throw error;
  }

  const type = MIME_TYPES.get(path.extname(absolute).toLowerCase()) || "application/octet-stream";
  response.writeHead(200, {
    "content-type": type,
    "content-length": content.length,
    "cache-control": "no-cache",
  });
  if (request.method === "HEAD") response.end();
  else response.end(content);
}

function apiRoute(pathname) {
  const version = pathname.match(/^\/api\/docs\/([^/]+)\/versions\/([^/]+)$/);
  if (version) {
    return {
      name: "version",
      docId: decodeURIComponent(version[1]),
      versionId: decodeURIComponent(version[2]),
    };
  }
  const restore = pathname.match(/^\/api\/docs\/([^/]+)\/versions\/([^/]+)\/restore$/);
  if (restore) {
    return {
      name: "restore",
      docId: decodeURIComponent(restore[1]),
      versionId: decodeURIComponent(restore[2]),
    };
  }
  const versions = pathname.match(/^\/api\/docs\/([^/]+)\/versions$/);
  if (versions) {
    return { name: "versions", docId: decodeURIComponent(versions[1]) };
  }
  const document = pathname.match(/^\/api\/docs\/([^/]+)$/);
  if (document) {
    return { name: "document", docId: decodeURIComponent(document[1]) };
  }
  if (pathname === "/api/docs") return { name: "documents" };
  if (pathname === "/api/bootstrap") return { name: "bootstrap" };
  if (pathname === "/api/search") return { name: "search" };
  if (pathname === "/api/events") return { name: "events" };
  if (pathname === "/api/health") return { name: "health" };
  return null;
}

function createEventsHub() {
  const clients = new Set();
  return {
    connect(request, response) {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      response.write("event: ready\ndata: {}\n\n");
      clients.add(response);
      const heartbeat = setInterval(() => {
        response.write(": heartbeat\n\n");
      }, 20_000);
      request.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(response);
      });
    },
    broadcast(type, payload) {
      const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const response of clients) response.write(message);
    },
  };
}

export async function createPageNestServer({
  root,
  token = "",
  publicDirectory = DEFAULT_PUBLIC_DIRECTORY,
}) {
  const library = await Library.open(root);
  const publicRoot = await fs.realpath(publicDirectory);
  const events = createEventsHub();

  const server = http.createServer(async (request, response) => {
    for (const [name, value] of Object.entries(securityHeaders())) {
      response.setHeader(name, value);
    }

    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      if (!sameOrigin(request)) {
        throw new PageNestError(403, "INVALID_ORIGIN", "Cross-origin requests are not allowed.");
      }
      if (!isTokenAuthorized(request, url, token)) {
        throw new PageNestError(401, "UNAUTHORIZED", "A valid PageNest access token is required.");
      }
      if (token && url.searchParams.get("token") === token) {
        response.setHeader(
          "set-cookie",
          `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`,
        );
        response.writeHead(302, { location: tokenRedirect(url), ...securityHeaders() });
        response.end();
        return;
      }

      const route = apiRoute(url.pathname);
      if (!route) {
        if (!["GET", "HEAD"].includes(request.method)) {
          throw new PageNestError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
        }
        await serveStatic(request, response, url, publicRoot);
        return;
      }

      if (route.name === "health" && request.method === "GET") {
        sendJson(response, 200, { ok: true, rootName: path.basename(library.root) });
        return;
      }

      if (route.name === "bootstrap" && request.method === "GET") {
        sendJson(response, 200, await library.bootstrap());
        return;
      }

      if (route.name === "search" && request.method === "GET") {
        sendJson(response, 200, {
          query: url.searchParams.get("q") || "",
          results: await library.search(url.searchParams.get("q") || ""),
        });
        return;
      }

      if (route.name === "events" && request.method === "GET") {
        events.connect(request, response);
        return;
      }

      if (route.name === "versions" && request.method === "GET") {
        sendJson(response, 200, {
          versions: await library.listVersions(route.docId),
        });
        return;
      }

      if (route.name === "version" && request.method === "GET") {
        sendJson(response, 200, {
          version: await library.getVersion(route.docId, route.versionId),
        });
        return;
      }

      if (route.name === "document" && request.method === "GET") {
        sendJson(response, 200, {
          doc: await library.requireDocument(route.docId),
          versions: await library.listVersions(route.docId),
        });
        return;
      }

      if (route.name === "document" && request.method === "PUT") {
        const body = await readJson(request);
        const result = await library.saveDocument(route.docId, body.markdown, {
          baseHash: body.baseHash,
          force: Boolean(body.force),
          reason: body.force ? "冲突：保留本地" : "手动保存",
        });
        if (result.saved) {
          events.broadcast("document-updated", {
            id: result.doc.id,
            path: result.doc.path,
            hash: result.doc.hash,
            updatedAt: result.doc.updatedAt,
          });
        }
        sendJson(response, 200, result);
        return;
      }

      if (route.name === "documents" && request.method === "POST") {
        const body = await readJson(request);
        const result = await library.createDocument(body);
        events.broadcast("document-created", {
          id: result.doc.id,
          path: result.doc.path,
          hash: result.doc.hash,
          updatedAt: result.doc.updatedAt,
        });
        sendJson(response, 201, result);
        return;
      }

      if (route.name === "restore" && request.method === "POST") {
        const result = await library.restoreVersion(route.docId, route.versionId);
        if (result.restored) {
          events.broadcast("document-updated", {
            id: result.doc.id,
            path: result.doc.path,
            hash: result.doc.hash,
            updatedAt: result.doc.updatedAt,
          });
        }
        sendJson(response, 200, result);
        return;
      }

      throw new PageNestError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
    } catch (error) {
      const normalized =
        error instanceof PageNestError
          ? error
          : new PageNestError(500, "INTERNAL_ERROR", "Unexpected server error.");
      if (!(error instanceof PageNestError)) {
        console.error(error);
      }
      if (!response.headersSent) {
        sendJson(response, normalized.status, {
          error: {
            code: normalized.code,
            message: normalized.message,
            details: normalized.details,
          },
        });
      } else {
        response.end();
      }
    }
  });

  return { server, library, publicDirectory: publicRoot };
}

export async function startPageNestServer(options) {
  const { server, library } = await createPageNestServer(options);
  const host = options.host || "127.0.0.1";
  const port = Number(options.port ?? 4321);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    library,
    address: server.address(),
  };
}

export { DEFAULT_PUBLIC_DIRECTORY, MAX_JSON_BYTES };
