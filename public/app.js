(function () {
  "use strict";

  const STORAGE_KEY = "pagenest.ui.v1";
  const UI_STATE_VERSION = 1;

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );

  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function slugify(text) {
    return (
      String(text)
        .toLowerCase()
        .replace(/[`*_~]/g, "")
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 64) || "section"
    );
  }

  function stripInlineMarkdown(text) {
    return String(text)
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_~]/g, "")
      .trim();
  }

  function plainText(markdown) {
    return String(markdown)
      .replace(/```[\s\S]*?```/g, (block) =>
        block.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, " "),
      )
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/[*_~>-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function charCount(markdown) {
    return plainText(markdown).replace(/\s/g, "").length;
  }

  function formatClock(timestamp) {
    const date = new Date(timestamp);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(
      2,
      "0",
    )}`;
  }

  function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const sameYear = date.getFullYear() === now.getFullYear();
    return `${sameYear ? "" : `${date.getFullYear()}/`}${date.getMonth() + 1}/${date.getDate()} ${formatClock(
      timestamp,
    )}`;
  }

  function relativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 45_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
    return formatDateTime(timestamp);
  }

  function safeUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "#";
    if (/^(javascript|data|vbscript):/i.test(value)) return "#";
    return value;
  }

  /* ------------------------------- 状态 ------------------------------- */

  const state = {
    docs: [],
    versions: {},
    tabs: [],
    drafts: {},
    favorites: {},
    activeDocId: null,
    ui: {
      theme: "paper",
      sidebarCollapsed: false,
      folders: [],
      railTab: "outline",
      navMode: "tree",
    },
    blocksByDoc: {},
    headingsByDoc: {},
    editMode: false,
    sourceMode: false,
    editingBlock: null,
    searchQuery: "",
    globalSearchQuery: "",
    globalSearchOpener: null,
    toastTimer: null,
    savedStateTimer: null,
    pendingRestore: null,
    conflictRemote: "",
    conflictDocId: null,
    conflictCurrent: null,
    lastSavedMarkdown: "",
    starsOpener: null,
    server: {
      rootName: "",
      versionLimit: 200,
    },
    eventSource: null,
    ready: false,
  };

  function loadUiState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (error) {
      saved = null;
    }

    const data = saved && saved.version === UI_STATE_VERSION ? saved : {};
    state.tabs = Array.isArray(data.tabs) ? data.tabs : [];
    state.drafts = data.drafts && typeof data.drafts === "object" ? data.drafts : {};
    state.favorites =
      data.favorites && typeof data.favorites === "object" ? data.favorites : {};
    state.activeDocId = data.activeDocId || null;
    state.ui = {
      theme: data.ui?.theme === "night" ? "night" : "paper",
      sidebarCollapsed: Boolean(data.ui?.sidebarCollapsed),
      folders: Array.isArray(data.ui?.folders) ? data.ui.folders : [],
      railTab: data.ui?.railTab === "history" ? "history" : "outline",
      navMode: data.ui?.navMode === "list" ? "list" : "tree",
    };
  }

  function persistNow() {
    const payload = {
      version: UI_STATE_VERSION,
      tabs: state.tabs,
      activeDocId: state.activeDocId,
      drafts: state.drafts,
      favorites: state.favorites,
      ui: state.ui,
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      /* UI 状态无法持久化时仍允许继续阅读和编辑。 */
    }
  }

  const persistSoon = debounce(persistNow, 160);

  class ApiError extends Error {
    constructor(message, { status = 0, code = "REQUEST_FAILED", details = null } = {}) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  async function apiRequest(url, { method = "GET", body = null } = {}) {
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(payload?.error?.message || `请求失败（${response.status}）`, {
        status: response.status,
        code: payload?.error?.code || "REQUEST_FAILED",
        details: payload?.error?.details || null,
      });
    }
    return payload;
  }

  function ensureFoldersVisible() {
    const folders = new Set(state.ui.folders);
    for (const doc of state.docs) {
      const segments = doc.path.split("/").slice(0, -1);
      segments.forEach((_, index) => {
        folders.add(segments.slice(0, index + 1).join("/"));
      });
    }
    state.ui.folders = [...folders];
  }

  function applyBootstrap(data) {
    state.docs = Array.isArray(data.documents) ? data.documents : [];
    state.versions = data.versions && typeof data.versions === "object" ? data.versions : {};
    state.server.rootName = data.rootName || "";
    state.server.versionLimit = Number(data.versionLimit) || 200;
    $("serverRootLabel").textContent = `${state.server.rootName || "本地目录"} · ${state.docs.length} 篇 Markdown`;

    state.tabs = state.tabs.filter((tab) =>
      state.docs.some((doc) => doc.id === tab.docId),
    );
    if (!state.tabs.length && state.docs.length) {
      const preferred =
        state.docs.find((doc) => /^readme\.md$/i.test(doc.path)) || state.docs[0];
      state.tabs.push({ docId: preferred.id, dirty: false, scrollTop: 0 });
    }
    for (const tab of state.tabs) {
      tab.dirty = workingMarkdown(tab.docId) !== docById(tab.docId)?.markdown;
      tab.scrollTop = Number(tab.scrollTop) || 0;
    }

    if (!state.docs.some((doc) => doc.id === state.activeDocId)) {
      state.activeDocId = state.tabs[0]?.docId || state.docs[0]?.id || null;
    }
    ensureFoldersVisible();
  }

  async function loadFromServer({ initial = false } = {}) {
    const data = await apiRequest("/api/bootstrap");
    applyBootstrap(data);
    state.ready = true;
    if (initial) {
      $("bootScreen").hidden = true;
      renderNavMode();
      renderAll();
      setRailTab(state.ui.railTab);
    } else {
      renderAll();
      setRailTab(state.ui.railTab);
    }
    persistSoon();
  }

  function showBootError(error) {
    const screen = $("bootScreen");
    screen.hidden = false;
    screen.classList.add("error");
    screen.querySelector("strong").textContent = "无法打开资料夹";
    $("bootMessage").textContent =
      error instanceof ApiError && error.status === 401
        ? "访问令牌无效或已经失效，请重新打开 CLI 输出的地址。"
        : error.message || "请确认 PageNest 服务仍在运行。";
  }

  const docById = (id) => state.docs.find((doc) => doc.id === id) || null;
  const activeDoc = () => docById(state.activeDocId);
  const activeTab = () => state.tabs.find((tab) => tab.docId === state.activeDocId) || null;
  const workingMarkdown = (docId) => state.drafts[docId] ?? docById(docId)?.markdown ?? "";
  const isDirty = (docId) => {
    const tab = state.tabs.find((item) => item.docId === docId);
    return Boolean(tab?.dirty);
  };

  function favoritesFor(docId) {
    return Array.isArray(state.favorites[docId]) ? state.favorites[docId] : [];
  }

  function isFavorite(docId, headingId) {
    return favoritesFor(docId).some((favorite) => favorite.id === headingId);
  }

  function allFavorites() {
    return Object.entries(state.favorites).flatMap(([docId, items]) =>
      (Array.isArray(items) ? items : []).map((item) => ({ ...item, docId })),
    );
  }

  function renderStarCount() {
    const count = allFavorites().length;
    $("starsCount").textContent = String(count);
    $("starsBtn").title = count ? `我的速记（${count}）` : "我的速记";
  }

  function toggleFavorite(docId, headingId, title, level, blockIndex) {
    const items = favoritesFor(docId).slice();
    const index = items.findIndex((item) => item.id === headingId);
    if (index >= 0) items.splice(index, 1);
    else items.push({ id: headingId, title, level, blockIndex });

    if (items.length) state.favorites[docId] = items;
    else delete state.favorites[docId];

    renderStarCount();
    if (!$("starsPanel").hidden) renderFavoritesPanel();
    renderArticleFavorites();
    persistSoon();
  }

  function removeFavorite(docId, headingId) {
    const items = favoritesFor(docId).filter((item) => item.id !== headingId);
    if (items.length) state.favorites[docId] = items;
    else delete state.favorites[docId];
    renderStarCount();
    renderArticleFavorites();
    renderFavoritesPanel();
    persistSoon();
  }

  function renderArticleFavorites() {
    const doc = activeDoc();
    if (!doc) return;
    for (const button of $$("[data-favorite-doc]")) {
      if (button.dataset.favoriteDoc !== doc.id) continue;
      const on = isFavorite(doc.id, button.dataset.favoriteId);
      button.classList.toggle("on", on);
      button.textContent = on ? "★" : "☆";
      button.title = on ? "取消收藏" : "收藏这一节";
      button.setAttribute("aria-label", on ? "取消收藏" : "收藏这一节");
      button.setAttribute("aria-pressed", String(on));
    }
  }

  function renderFavoritesPanel() {
    const groups = new Map();

    for (const favorite of allFavorites()) {
      const doc = docById(favorite.docId);
      if (!doc) continue;
      if (!groups.has(doc.id)) groups.set(doc.id, { doc, items: [] });
      groups.get(doc.id).items.push(favorite);
    }

    const sorted = [...groups.values()].sort((a, b) =>
      a.doc.path.localeCompare(b.doc.path, "zh-CN", { numeric: true }),
    );

    if (!sorted.length) {
      $("starsList").innerHTML = `
        <div class="stars-empty">
          <span aria-hidden="true">☆</span>
          <strong>还没有速记</strong>
          <p>把鼠标移到任意标题左侧，点一下星标。收藏的章节会自动汇总到这里。</p>
        </div>
      `;
      return;
    }

    $("starsList").innerHTML = sorted
      .map(({ doc, items }) => {
        const ordered = [...items].sort(
          (a, b) =>
            (Number(a.blockIndex) || 0) - (Number(b.blockIndex) || 0) ||
            a.title.localeCompare(b.title, "zh-CN"),
        );
        return `
          <section class="stars-group" aria-label="${escapeHtml(doc.title)}">
            <div class="stars-group-head">
              <strong>${escapeHtml(doc.title)}</strong>
              <span>${escapeHtml(doc.path)}</span>
            </div>
            <div class="stars-items">
              ${ordered
                .map(
                  (favorite) => `
                    <div class="star-item">
                      <button class="star-jump" type="button"
                        data-star-doc="${escapeHtml(doc.id)}"
                        data-star-heading="${escapeHtml(favorite.id)}"
                        aria-label="打开 ${escapeHtml(favorite.title)}">
                        <span class="star-level">H${escapeHtml(favorite.level)}</span>
                        <span class="star-title">${escapeHtml(favorite.title)}</span>
                      </button>
                      <button class="star-remove" type="button"
                        data-star-remove="${escapeHtml(favorite.id)}"
                        data-star-doc="${escapeHtml(doc.id)}"
                        aria-label="取消收藏 ${escapeHtml(favorite.title)}"
                        title="取消收藏">×</button>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </section>
        `;
      })
      .join("");
  }

  function openFavoritesPanel() {
    renderFavoritesPanel();
    state.starsOpener = document.activeElement;
    $("starsScrim").hidden = false;
    $("starsPanel").hidden = false;
    requestAnimationFrame(() => $("starsClose").focus());
  }

  function closeFavoritesPanel({ restoreFocus = true } = {}) {
    $("starsPanel").hidden = true;
    $("starsScrim").hidden = true;
    if (restoreFocus) {
      const opener = state.starsOpener;
      state.starsOpener = null;
      requestAnimationFrame(() => {
        if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
      });
    } else {
      state.starsOpener = null;
    }
  }

  function openFavoriteTarget(docId, headingId) {
    closeFavoritesPanel({ restoreFocus: false });
    openDoc(docId);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (document.getElementById(headingId)) scrollToHeading(headingId);
        else showToast("这一节已经改名或被移除");
      });
    });
  }

  function deriveTitle(markdown, fallback = "未命名文档") {
    const heading = String(markdown)
      .split(/\r?\n/)
      .find((line) => /^#\s+\S/.test(line));
    return heading ? stripInlineMarkdown(heading.replace(/^#\s+/, "")) : fallback;
  }

  /* ------------------------------- Markdown 解析 ------------------------------- */

  const isTableSeparator = (line) =>
    /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");

  const splitTableRow = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  function parseBlocks(markdown) {
    const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
      if (!lines[i].trim()) {
        i += 1;
        continue;
      }

      const fence = lines[i].match(/^```(.*)$/);
      if (fence) {
        const lang = fence[1].trim();
        const start = i;
        i += 1;
        const body = [];
        while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
        if (i < lines.length) i += 1;
        blocks.push({
          type: "code",
          lang,
          content: body.join("\n"),
          markdown: lines.slice(start, i).join("\n"),
        });
        continue;
      }

      const heading = lines[i].match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        blocks.push({
          type: "heading",
          level: heading[1].length,
          text: heading[2].trim(),
          markdown: lines[i],
        });
        i += 1;
        continue;
      }

      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) {
        blocks.push({ type: "hr", markdown: lines[i] });
        i += 1;
        continue;
      }

      if (/^\s*>/.test(lines[i])) {
        const start = i;
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          body.push(lines[i].replace(/^\s*>\s?/, ""));
          i += 1;
        }
        blocks.push({
          type: "quote",
          content: body.join("\n"),
          markdown: lines.slice(start, i).join("\n"),
        });
        continue;
      }

      if (lines[i].includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        const start = i;
        const header = splitTableRow(lines[i]);
        const align = splitTableRow(lines[i + 1]).map((cell) =>
          /^:-+:$/.test(cell) ? "center" : /-+:$/.test(cell) ? "right" : "left",
        );
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
          rows.push(splitTableRow(lines[i]));
          i += 1;
        }
        blocks.push({
          type: "table",
          header,
          align,
          rows,
          markdown: lines.slice(start, i).join("\n"),
        });
        continue;
      }

      if (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const start = i;
        while (i < lines.length) {
          if (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
            i += 1;
            continue;
          }
          if (/^\s{2,}\S/.test(lines[i]) && lines[i].trim()) {
            i += 1;
            continue;
          }
          break;
        }
        blocks.push({
          type: "list",
          content: lines.slice(start, i).join("\n"),
          markdown: lines.slice(start, i).join("\n"),
        });
        continue;
      }

      const start = i;
      const paragraph = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]) &&
        !(lines[i].includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        paragraph.push(lines[i++]);
      }
      if (paragraph.length) {
        blocks.push({
          type: "paragraph",
          content: paragraph.join("\n"),
          markdown: lines.slice(start, i).join("\n"),
        });
      } else {
        i += 1;
      }
    }

    return blocks;
  }

  function parseListItems(markdown) {
    const lines = String(markdown).split("\n");
    const items = [];

    for (const line of lines) {
      const match = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (match) {
        const rawText = match[3];
        const task = rawText.match(/^\[([ xX])\]\s*(.*)$/);
        items.push({
          indent: match[1].replace(/\t/g, "  ").length,
          ordered: /\d/.test(match[2]),
          task: Boolean(task),
          checked: task ? task[1].toLowerCase() === "x" : false,
          text: task ? task[2] : rawText,
        });
      } else if (items.length && /^\s{2,}\S/.test(line)) {
        items[items.length - 1].text += ` ${line.trim()}`;
      }
    }

    return items;
  }

  function renderInline(text) {
    let output = escapeHtml(text);
    const codes = [];

    output = output.replace(/`([^`]+)`/g, (_, code) => {
      codes.push(code);
      return `\u0000${codes.length - 1}\u0000`;
    });

    output = output.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (_, alt, src) => `<img alt="${alt}" src="${safeUrl(src)}" />`,
    );
    output = output.replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_, label, href) =>
        `<a href="${safeUrl(href)}" target="_blank" rel="noreferrer">${label}</a>`,
    );
    output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    output = output.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    output = output.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    output = output.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
    return output.replace(/\n/g, "<br />");
  }

  function buildListHtml(items, editable) {
    const output = [];
    const stack = [];
    let taskIndex = 0;

    for (const item of items) {
      const tag = item.ordered ? "ol" : "ul";
      let label;

      if (item.task) {
        label = `<label class="task-line"><input type="checkbox" data-task-index="${taskIndex}" ${
          item.checked ? "checked" : ""
        } ${editable ? "disabled" : ""} /><span>${renderInline(item.text)}</span></label>`;
        taskIndex += 1;
      } else {
        label = renderInline(item.text);
      }

      while (stack.length && item.indent < stack[stack.length - 1].indent) {
        output.push(`</${stack.pop().tag}>`);
      }

      if (!stack.length || item.indent > stack[stack.length - 1].indent) {
        output.push(`<${tag}>`);
        stack.push({ indent: item.indent, tag });
      } else if (stack[stack.length - 1].tag !== tag) {
        output.push(`</${stack.pop().tag}>`, `<${tag}>`);
        stack.push({ indent: item.indent, tag });
      }

      output.push(`<li>${label}</li>`);
    }

    while (stack.length) output.push(`</${stack.pop().tag}>`);
    return output.join("");
  }

  function renderTableBlock(block) {
    const thead = block.header
      .map(
        (cell, index) =>
          `<th style="text-align:${block.align[index] || "left"}">${renderInline(cell)}</th>`,
      )
      .join("");
    const tbody = block.rows
      .map(
        (row) =>
          `<tr>${row
            .map(
              (cell, index) =>
                `<td style="text-align:${block.align[index] || "left"}">${renderInline(cell)}</td>`,
            )
            .join("")}</tr>`,
      )
      .join("");
    return `<div class="table-scroll"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
  }

  function renderQuoteBlock(block) {
    const paragraphs = String(block.content)
      .split(/\n\s*\n/)
      .filter(Boolean)
      .map((part) => `<p>${renderInline(part.replace(/\n/g, " "))}</p>`)
      .join("");
    return `<blockquote>${paragraphs}</blockquote>`;
  }

  function renderBlockHtml(block) {
    switch (block.type) {
      case "heading":
        return `<h${block.level} id="${escapeHtml(block.headingId)}">${renderInline(
          block.text,
        )}</h${block.level}>`;
      case "paragraph":
        return `<p>${renderInline(block.content)}</p>`;
      case "quote":
        return renderQuoteBlock(block);
      case "code":
        return `<pre data-lang="${escapeHtml(block.lang || "")}"><code>${escapeHtml(
          block.content,
        )}</code></pre>`;
      case "table":
        return renderTableBlock(block);
      case "list":
        return `<div class="list-wrap">${buildListHtml(
          parseListItems(block.content),
          state.editMode,
        )}</div>`;
      case "hr":
        return "<hr />";
      default:
        return `<p>${renderInline(block.markdown || "")}</p>`;
    }
  }

  function assignHeadingIds(blocks) {
    const used = new Map();
    const headings = [];

    blocks.forEach((block, blockIndex) => {
      if (block.type !== "heading") return;
      const text = stripInlineMarkdown(block.text);
      const base = slugify(text);
      const count = used.get(base) || 0;
      used.set(base, count + 1);
      block.headingId = count ? `${base}-${count + 1}` : base;
      block.headingText = text;
      headings.push({
        id: block.headingId,
        level: block.level,
        text,
        blockIndex,
      });
    });

    return headings;
  }

  function blocksToMarkdown(blocks) {
    return `${blocks
      .map((block) => block.markdown.trimEnd())
      .filter(Boolean)
      .join("\n\n")
      .trimEnd()}\n`;
  }

  /* ------------------------------- DOM → Markdown ------------------------------- */

  function inlineDomToMarkdown(root) {
    if (!root) return "";

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue.replace(/\u00a0/g, " ");
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      if (node.matches("[data-favorite-id]")) return "";

      const tag = node.tagName;
      const children = [...node.childNodes].map(walk).join("");

      if (tag === "BR") return "\n";
      if (tag === "STRONG" || tag === "B") return `**${children}**`;
      if (tag === "EM" || tag === "I") return `*${children}*`;
      if (tag === "DEL" || tag === "S" || tag === "STRIKE") return `~~${children}~~`;
      if (tag === "CODE") return `\`${node.textContent}\``;
      if (tag === "A") return `[${children}](${node.getAttribute("href") || "#"})`;
      if (tag === "IMG") {
        return `![${node.getAttribute("alt") || ""}](${node.getAttribute("src") || ""})`;
      }
      if (tag === "P" || tag === "DIV") return `${children}\n`;
      return children;
    };

    return walk(root)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function listDomToMarkdown(listNode) {
    if (!listNode) return "";
    const output = [];

    const walkList = (list, indent) => {
      const ordered = list.tagName === "OL";
      const items = [...list.children].filter((child) => child.tagName === "LI");

      items.forEach((item, index) => {
        const clone = item.cloneNode(true);
        clone.querySelectorAll(":scope > ul, :scope > ol").forEach((nested) => nested.remove());
        const checkbox = item.querySelector(":scope > label input[type=checkbox], :scope > input[type=checkbox]");
        clone.querySelectorAll("input[type=checkbox]").forEach((input) => input.remove());
        const text = inlineDomToMarkdown(clone)
          .replace(/\n+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const prefix = ordered ? `${index + 1}. ` : "- ";
        const task = checkbox ? `[${checkbox.checked ? "x" : " "}] ` : "";
        output.push(`${" ".repeat(indent)}${prefix}${task}${text}`);

        item.querySelectorAll(":scope > ul, :scope > ol").forEach((nested) => {
          walkList(nested, indent + 2);
        });
      });
    };

    walkList(listNode, 0);
    return output.join("\n");
  }

  function tableDomToMarkdown(table) {
    if (!table) return "";
    const rows = [...table.querySelectorAll("tr")].map((row) =>
      [...row.children].map((cell) =>
        inlineDomToMarkdown(cell).replace(/\n+/g, " ").replace(/\|/g, "\\|").trim(),
      ),
    );
    if (!rows.length) return "";
    const width = Math.max(...rows.map((row) => row.length));
    const normalized = rows.map((row) =>
      Array.from({ length: width }, (_, index) => row[index] || ""),
    );
    return [
      `| ${normalized[0].join(" | ")} |`,
      `| ${normalized[0].map(() => "---").join(" | ")} |`,
      ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");
  }

  function blockMarkdownFromDom(block, contentRoot) {
    if (!contentRoot) return block.markdown;

    switch (block.type) {
      case "heading": {
        const heading = contentRoot.querySelector(`h${block.level}`) || contentRoot;
        const text = inlineDomToMarkdown(heading).replace(/\n+/g, " ").trim();
        return text ? `${"#".repeat(block.level)} ${text}` : block.markdown;
      }
      case "paragraph": {
        const paragraph = contentRoot.querySelector("p") || contentRoot;
        const text = inlineDomToMarkdown(paragraph);
        return text || block.markdown;
      }
      case "quote": {
        const quote = contentRoot.querySelector("blockquote") || contentRoot;
        const text = inlineDomToMarkdown(quote);
        return text
          ? text
              .split("\n")
              .map((line) => `> ${line}`.trimEnd())
              .join("\n")
          : block.markdown;
      }
      case "list": {
        const list = contentRoot.querySelector("ul, ol") || contentRoot;
        return listDomToMarkdown(list) || block.markdown;
      }
      case "code": {
        const code = contentRoot.querySelector("pre code") || contentRoot.querySelector("pre") || contentRoot;
        const text = code.textContent.replace(/\n$/, "");
        return `\`\`\`${block.lang || ""}\n${text}\n\`\`\``;
      }
      case "table": {
        const table = contentRoot.querySelector("table");
        return tableDomToMarkdown(table) || block.markdown;
      }
      default:
        return block.markdown;
    }
  }

  /* ------------------------------- 渲染：目录与标签 ------------------------------- */

  function buildTree(docs) {
    const root = { type: "root", children: [] };

    for (const doc of docs) {
      const parts = doc.path.split("/").filter(Boolean);
      let cursor = root;
      for (let index = 0; index < parts.length - 1; index += 1) {
        const name = parts[index];
        const folderPath = parts.slice(0, index + 1).join("/");
        let folder = cursor.children.find(
          (child) => child.type === "folder" && child.path === folderPath,
        );
        if (!folder) {
          folder = { type: "folder", name, path: folderPath, children: [] };
          cursor.children.push(folder);
        }
        cursor = folder;
      }
      cursor.children.push({ type: "doc", doc });
    }

    const sortNode = (node) => {
      node.children.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        const left = a.type === "folder" ? a.name : a.doc.title;
        const right = b.type === "folder" ? b.name : b.doc.title;
        return left.localeCompare(right, "zh-CN");
      });
      node.children.filter((child) => child.type === "folder").forEach(sortNode);
    };
    sortNode(root);
    return root;
  }

  function folderDocCount(folder) {
    return folder.children.reduce(
      (count, child) => count + (child.type === "folder" ? folderDocCount(child) : 1),
      0,
    );
  }

  function filteredDocs() {
    const needle = state.searchQuery.trim().toLowerCase();
    if (!needle) return [...state.docs];
    return state.docs.filter((doc) =>
      `${doc.title} ${doc.path}`.toLowerCase().includes(needle),
    );
  }

  function filterSummaryHtml(count) {
    const query = state.searchQuery.trim();
    if (!query) return "";
    return `
      <p class="tree-filter-summary">
        <span>筛选「${escapeHtml(query)}」</span>
        <strong>${count} / ${state.docs.length}</strong>
      </p>
    `;
  }

  function renderTree() {
    if (state.ui.navMode === "list") {
      renderFlatList();
      return;
    }

    const docs = filteredDocs();
    const query = state.searchQuery.trim();
    const tree = buildTree(docs);
    const openFolders = new Set(state.ui.folders);
    const html = [filterSummaryHtml(docs.length)];

    if (!docs.length) {
      html.push(
        `<p class="rail-empty">${
          query ? `没有匹配「${escapeHtml(query)}」的文章。` : "还没有 Markdown 文档。"
        }</p>`,
      );
      $("treePanel").innerHTML = html.join("");
      return;
    }

    const renderChildren = (node, depth) => {
      for (const child of node.children) {
        if (child.type === "folder") {
          const open = query ? true : openFolders.has(child.path);
          html.push(`
            <button class="tree-folder" type="button" data-folder-path="${escapeHtml(
              child.path,
            )}" aria-expanded="${open}" style="--depth:${depth}">
              <span class="folder-caret" aria-hidden="true">▾</span>
              <span class="folder-name">${escapeHtml(child.name)}</span>
              <span class="folder-count">${folderDocCount(child)}</span>
            </button>
          `);
          if (open) renderChildren(child, depth + 1);
        } else {
          const active = child.doc.id === state.activeDocId;
          const dirty = isDirty(child.doc.id);
          html.push(`
            <button class="tree-doc${active ? " active" : ""}" type="button"
              data-doc-id="${escapeHtml(child.doc.id)}" style="--depth:${depth}">
              <span class="doc-name">${escapeHtml(child.doc.title)}</span>
              ${dirty ? '<span class="dirty-dot" aria-label="未保存"></span>' : ""}
            </button>
          `);
        }
      }
    };

    renderChildren(tree, 0);
    $("treePanel").innerHTML = html.join("");
  }

  function renderFlatList() {
    const query = state.searchQuery.trim();
    const docs = filteredDocs().sort((a, b) =>
      a.path.localeCompare(b.path, "zh-CN", { numeric: true }),
    );
    if (!docs.length) {
      $("treePanel").innerHTML = `${filterSummaryHtml(0)}
        <p class="rail-empty">${
          query ? `没有匹配「${escapeHtml(query)}」的文章。` : "还没有 Markdown 文档。"
        }</p>`;
      return;
    }

    $("treePanel").innerHTML = `
      ${filterSummaryHtml(docs.length)}
      <p class="flat-summary">${
        query ? `${docs.length} 篇匹配文章` : `${docs.length} 篇文档 · 无目录层级`
      }</p>
      <div class="flat-list">
        ${docs
          .map((doc) => {
            const active = doc.id === state.activeDocId;
            return `
              <button class="tree-doc flat-doc${active ? " active" : ""}" type="button"
                data-doc-id="${escapeHtml(doc.id)}">
                <span class="flat-doc-main">
                  <span class="doc-name">${escapeHtml(doc.title)}</span>
                  <span class="doc-path">${escapeHtml(doc.path)}</span>
                </span>
                ${isDirty(doc.id) ? '<span class="dirty-dot" aria-label="未保存"></span>' : ""}
              </button>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderNavMode() {
    for (const button of $$("[data-nav-mode]")) {
      const active = button.dataset.navMode === state.ui.navMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    $("treePanel").setAttribute(
      "aria-label",
      state.ui.navMode === "list" ? "文档列表" : "目录树",
    );
    renderTree();
  }

  function setNavMode(mode) {
    state.ui.navMode = mode === "list" ? "list" : "tree";
    renderNavMode();
    persistSoon();
  }

  function renderTabs() {
    const strip = $("tabStrip");
    if (!state.tabs.length) {
      strip.innerHTML = '<span class="tab-empty">没有打开的文档</span>';
      return;
    }

    strip.innerHTML = state.tabs
      .map((tab) => {
        const doc = docById(tab.docId);
        if (!doc) return "";
        const active = tab.docId === state.activeDocId;
        return `
          <button class="doc-tab${active ? " active" : ""}" type="button"
            data-tab-doc="${escapeHtml(tab.docId)}" role="tab"
            aria-selected="${active}">
            <span class="tab-title">${escapeHtml(doc.title)}</span>
            ${tab.dirty ? '<span class="tab-dirty" aria-label="未保存"></span>' : ""}
            <span class="tab-close" role="button" aria-label="关闭 ${escapeHtml(
              doc.title,
            )}" data-close-doc="${escapeHtml(tab.docId)}">×</span>
          </button>
        `;
      })
      .join("");

    requestAnimationFrame(() => {
      const active = strip.querySelector(".doc-tab.active");
      if (active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  function updateTopbar() {
    const doc = activeDoc();
    $("crumbPath").textContent = doc ? doc.path : "未打开文档";
    $("editToggle").disabled = !doc;
    $("sourceToggle").disabled = !doc;
    $("editToggle").textContent = state.editMode ? "完成" : "编辑";
    $("sourceToggle").classList.toggle("is-on", state.sourceMode);
    $("sourceToggle").textContent = state.sourceMode ? "块编辑" : "源码";
    $("themeIcon").textContent = state.ui.theme === "night" ? "☀" : "☾";
    $("themeToggle").title = state.ui.theme === "night" ? "切换到纸质主题" : "切换到夜读主题";
    renderStarCount();
    document.title = doc ? `${doc.title} · 页栖 PageNest` : "页栖 PageNest";
    updateSaveState();
  }

  function updateSaveState(savedAt = 0) {
    const pill = $("saveState");
    clearTimeout(state.savedStateTimer);
    const tab = activeTab();

    if (!activeDoc()) {
      pill.dataset.state = "clean";
      pill.textContent = "未打开";
      return;
    }

    if (savedAt) {
      pill.dataset.state = "saved";
      pill.textContent = `已保存 ${formatClock(savedAt)}`;
      state.savedStateTimer = setTimeout(() => updateSaveState(), 2200);
      return;
    }

    if (tab?.dirty) {
      pill.dataset.state = "dirty";
      pill.textContent = "未保存";
    } else {
      pill.dataset.state = "clean";
      pill.textContent = "已保存";
    }
  }

  function refreshDirtyIndicators() {
    for (const button of $$(".tree-doc")) {
      const docId = button.dataset.docId;
      const dirty = isDirty(docId);
      const existing = button.querySelector(".dirty-dot");
      if (dirty && !existing) {
        const dot = document.createElement("span");
        dot.className = "dirty-dot";
        dot.setAttribute("aria-label", "未保存");
        button.append(dot);
      } else if (!dirty && existing) {
        existing.remove();
      }
    }
    renderTabs();
    updateSaveState();
  }

  /* ------------------------------- 渲染：正文 ------------------------------- */

  function renderArticle() {
    const doc = activeDoc();
    const article = $("article");
    if (!doc) {
      article.innerHTML = "";
      article.hidden = true;
      return;
    }

    const markdown = workingMarkdown(doc.id);
    const blocks = parseBlocks(markdown);
    const headings = assignHeadingIds(blocks);
    state.blocksByDoc[doc.id] = blocks;
    state.headingsByDoc[doc.id] = headings;

    const meta = `
      <div class="doc-meta">
        <span class="chip accent">${escapeHtml(doc.path)}</span>
        <span class="chip">${charCount(markdown)} 字</span>
        <span class="chip">更新 ${relativeTime(doc.updatedAt)}</span>
        <span class="meta-spacer"></span>
        <span class="chip">${state.editMode ? "块级编辑" : "阅读模式"}</span>
      </div>
    `;

    const body = blocks
      .map((block, index) => {
        const editing = index === state.editingBlock;
        const hasFavorite = block.type === "heading" && block.level <= 4;
        const favorite = hasFavorite
          ? `
            <button class="heading-favorite" type="button"
              data-favorite-doc="${escapeHtml(doc.id)}"
              data-favorite-id="${escapeHtml(block.headingId)}"
              data-favorite-title="${escapeHtml(block.headingText)}"
              data-favorite-level="${block.level}"
              data-favorite-index="${index}"
              aria-label="收藏这一节" aria-pressed="false" title="收藏这一节">☆</button>
          `
          : "";
        return `
          <div class="block${editing ? " is-editing" : ""}${
            hasFavorite ? " has-favorite" : ""
          }${hasFavorite ? ` heading-level-${block.level}` : ""}" data-block-index="${index}"
            data-folio="${String(index + 1).padStart(2, "0")}">
            ${favorite}
            <div class="block-content" ${
              editing ? 'contenteditable="true" spellcheck="false"' : ""
            }>${renderBlockHtml(block)}</div>
            <button class="block-edit" type="button" data-edit-block="${index}"
              aria-label="编辑第 ${index + 1} 块" title="编辑这一块">✎</button>
          </div>
        `;
      })
      .join("");

    article.innerHTML = meta + body;
    article.classList.toggle("editing-enabled", state.editMode && !state.sourceMode);
    article.hidden = state.sourceMode || !blocks.length;
  }

  function renderSource() {
    const doc = activeDoc();
    const pane = $("sourcePane");
    const article = $("article");

    if (!doc || !state.sourceMode) {
      pane.hidden = true;
      return;
    }

    pane.hidden = false;
    article.hidden = true;
    const markdown = workingMarkdown(doc.id);
    const editor = $("sourceEditor");
    if (editor.value !== markdown) editor.value = markdown;
    updateSourceStats();
  }

  function updateSourceStats() {
    const value = $("sourceEditor").value;
    const lines = value ? value.split("\n").length : 0;
    $("sourceStats").textContent = `${lines} 行 · ${charCount(value)} 字`;
  }

  function renderDoc({ scrollTop = null } = {}) {
    const doc = activeDoc();
    const empty = $("emptyState");

    if (!doc) {
      $("article").hidden = true;
      $("sourcePane").hidden = true;
      empty.hidden = false;
      updateEditUi();
      renderOutline();
      renderHistory();
      updateTopbar();
      return;
    }

    empty.hidden = true;
    renderArticle();
    renderSource();
    updateEditUi();
    renderOutline();
    renderHistory();
    updateTopbar();

    if (typeof scrollTop === "number") {
      requestAnimationFrame(() => window.scrollTo({ top: scrollTop, behavior: "instant" }));
    }
  }

  function renderAll({ scrollToTab = true } = {}) {
    renderTree();
    renderTabs();
    const tab = activeTab();
    renderDoc({ scrollTop: scrollToTab ? tab?.scrollTop || 0 : null });
    setRailTab(state.ui.railTab);
  }

  /* ------------------------------- 渲染：目录与历史 ------------------------------- */

  function outlineHtml(headings) {
    if (!headings.length) return '<p class="rail-empty">这篇文档还没有可导航的小标题。</p>';
    return headings
      .filter((heading) => heading.level <= 4)
      .map(
        (heading) => `
          <button class="outline-link lv${heading.level}" type="button"
            data-heading-id="${escapeHtml(heading.id)}">
            ${escapeHtml(heading.text)}
          </button>
        `,
      )
      .join("");
  }

  function renderOutline() {
    const doc = activeDoc();
    const headings = doc ? state.headingsByDoc[doc.id] || [] : [];
    const html = outlineHtml(headings);
    $("outlineList").innerHTML = html;
    $("sheetOutlineList").innerHTML = html;
    $("outlineMeta").textContent = `${headings.length} 节`;
  }

  function historyHtml(doc, versions) {
    if (!doc) return '<p class="rail-empty">打开一篇文档后，这里会显示它的保存历史。</p>';
    const tab = state.tabs.find((item) => item.docId === doc.id);
    const currentLabel = tab?.dirty ? "工作区有未保存修改" : "当前内容已保存";
    const rows = versions.length
      ? versions
          .map((version) => {
            const delta = Number(version.charDelta) || 0;
            const deltaClass = delta > 0 ? "pos" : delta < 0 ? "neg" : "";
            const deltaText =
              delta === 0 ? "字数不变" : `${delta > 0 ? "+" : ""}${delta} 字`;
            return `
              <button class="history-item" type="button" data-version-id="${escapeHtml(
                version.id,
              )}">
                <span class="history-dot" aria-hidden="true"></span>
                <span class="history-main">
                  <span class="history-reason">${escapeHtml(version.reason || "历史版本")}</span>
                  <span class="history-meta">
                    <span>${formatDateTime(version.createdAt)}</span>
                    <span class="history-delta ${deltaClass}">${deltaText}</span>
                    <span>${relativeTime(version.createdAt)}</span>
                  </span>
                </span>
              </button>
            `;
          })
          .join("")
      : '<p class="rail-empty">还没有历史版本。保存一次后，这里会出现快照。</p>';

    return `
      <div class="history-current">
        <strong>${escapeHtml(doc.title)}</strong>
        <span>${currentLabel} · 最近更新 ${relativeTime(doc.updatedAt)}</span>
      </div>
      <div class="history-kicker">保存前快照</div>
      ${rows}
    `;
  }

  function renderHistory() {
    const doc = activeDoc();
    const versions = doc
      ? [...(state.versions[doc.id] || [])].sort((a, b) => b.createdAt - a.createdAt)
      : [];
    const html = historyHtml(doc, versions);
    $("historyList").innerHTML = html;
    $("sheetHistoryList").innerHTML = html;
    $("historyCount").textContent = String(versions.length);
  }

  function setRailTab(tab) {
    state.ui.railTab = tab === "history" ? "history" : "outline";
    for (const button of $$("[data-rail-tab]")) {
      button.classList.toggle("active", button.dataset.railTab === state.ui.railTab);
    }
    $("railOutlinePane").hidden = state.ui.railTab !== "outline";
    $("railHistoryPane").hidden = state.ui.railTab !== "history";
    $("sheetOutlinePane").hidden = state.ui.railTab !== "outline";
    $("sheetHistoryPane").hidden = state.ui.railTab !== "history";
    persistSoon();
  }

  function updateActiveOutline() {
    if (!activeDoc() || state.sourceMode) return;
    const headings = state.headingsByDoc[activeDoc().id] || [];
    if (!headings.length) return;
    const line = getContentTopOffset() + 26;
    let current = headings[0].id;

    for (const heading of headings) {
      const node = document.getElementById(heading.id);
      if (!node) continue;
      if (node.getBoundingClientRect().top <= line) current = heading.id;
      else break;
    }

    for (const link of $$("[data-heading-id]")) {
      link.classList.toggle("active", link.dataset.headingId === current);
    }
  }

  function scrollToHeading(id) {
    if (!id) return;
    if (state.sourceMode) {
      state.sourceMode = false;
      renderDoc();
    }
    closeRailSheet();
    requestAnimationFrame(() => {
      const target = document.getElementById(id);
      if (!target) return;
      const y = target.getBoundingClientRect().top + window.scrollY - getContentTopOffset();
      window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    });
  }

  function getContentTopOffset() {
    const rootStyle = getComputedStyle(document.documentElement);
    const topbar = parseFloat(rootStyle.getPropertyValue("--topbar-h")) || 62;
    const tabs = parseFloat(rootStyle.getPropertyValue("--tabs-h")) || 44;
    const toolbar = state.editMode && !$("editToolbar").hidden ? $("editToolbar").offsetHeight : 0;
    return topbar + tabs + toolbar + 12;
  }

  /* ------------------------------- 编辑状态 ------------------------------- */

  function updateEditUi() {
    const hasDoc = Boolean(activeDoc());
    const toolbar = $("editToolbar");
    toolbar.hidden = !(state.editMode && hasDoc);
    $("sourceToggle").classList.toggle("is-on", state.sourceMode);
    $("sourceToggle").textContent = state.sourceMode ? "块编辑" : "源码";
    $("editToggle").textContent = state.editMode ? "完成" : "编辑";
    $("editToggle").classList.toggle("is-on", state.editMode);
    $("blockTypeSelect").disabled = state.editingBlock === null;

    if (state.editingBlock === null) {
      $("editingHint").textContent = "点击任意块开始编辑";
    } else {
      const block = state.blocksByDoc[state.activeDocId]?.[state.editingBlock];
      $("editingHint").textContent = block
        ? `正在编辑第 ${state.editingBlock + 1} 块 · ${blockLabel(block)}`
        : "正在编辑";
    }
  }

  function blockLabel(block) {
    if (!block) return "文本";
    if (block.type === "heading") return `标题 ${block.level}`;
    return (
      {
        paragraph: "正文",
        quote: "引用",
        code: "代码",
        table: "表格",
        list: "列表",
        hr: "分隔线",
      }[block.type] || "文本"
    );
  }

  function blockTypeValue(block) {
    if (!block) return "paragraph";
    if (block.type === "heading") return `h${Math.min(3, block.level)}`;
    if (block.type === "quote") return "quote";
    if (block.type === "code") return "code";
    return "paragraph";
  }

  function beginBlockEdit(index, point = null) {
    const doc = activeDoc();
    if (!doc || !state.editMode || state.sourceMode) return;
    const blocks = state.blocksByDoc[doc.id] || [];
    const block = blocks[index];
    if (!block || block.type === "hr") return;

    if (state.editingBlock !== null && state.editingBlock !== index) {
      syncEditingBlock();
      const previous = $("article").querySelector(
        `.block[data-block-index="${state.editingBlock}"]`,
      );
      if (previous) {
        previous.classList.remove("is-editing");
        const previousContent = previous.querySelector(".block-content");
        if (previousContent) previousContent.removeAttribute("contenteditable");
      }
    }

    state.editingBlock = index;
    const wrapper = $("article").querySelector(`.block[data-block-index="${index}"]`);
    if (!wrapper) return;
    wrapper.classList.add("is-editing");
    const content = wrapper.querySelector(".block-content");
    content.setAttribute("contenteditable", "true");
    content.setAttribute("spellcheck", "false");
    $("blockTypeSelect").value = blockTypeValue(block);
    $("blockTypeSelect").disabled = false;
    $("editingHint").textContent = `正在编辑第 ${index + 1} 块 · ${blockLabel(block)}`;

    if (point) {
      content.focus();
      try {
        if (document.caretRangeFromPoint) {
          const range = document.caretRangeFromPoint(point.x, point.y);
          if (range) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
          }
        } else if (document.caretPositionFromPoint) {
          const position = document.caretPositionFromPoint(point.x, point.y);
          if (position) {
            const range = document.createRange();
            range.setStart(position.offsetNode, position.offset);
            range.collapse(true);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      } catch (error) {
        /* 浏览器不支持坐标定位时退化为聚焦 */
      }
    } else {
      content.focus();
      const range = document.createRange();
      range.selectNodeContents(content);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function currentEditingBlock() {
    if (state.editingBlock === null) return null;
    return state.blocksByDoc[state.activeDocId]?.[state.editingBlock] || null;
  }

  function syncEditingBlock() {
    if (state.editingBlock === null) return;
    const doc = activeDoc();
    const block = currentEditingBlock();
    if (!doc || !block) return;
    const wrapper = $("article").querySelector(
      `.block[data-block-index="${state.editingBlock}"]`,
    );
    const content = wrapper?.querySelector(".block-content");
    if (!content) return;
    block.markdown = blockMarkdownFromDom(block, content);
    const markdown = blocksToMarkdown(state.blocksByDoc[doc.id]);
    setWorkingMarkdown(doc.id, markdown, { refreshTabs: false });
  }

  function finishBlockEdit() {
    if (state.editingBlock === null) return;
    syncEditingBlock();
    const wrapper = $("article").querySelector(
      `.block[data-block-index="${state.editingBlock}"]`,
    );
    if (wrapper) {
      wrapper.classList.remove("is-editing");
      const content = wrapper.querySelector(".block-content");
      if (content) content.removeAttribute("contenteditable");
    }
    state.editingBlock = null;
    $("blockTypeSelect").disabled = true;
    $("editingHint").textContent = "点击任意块开始编辑";
    persistNow();
  }

  function setWorkingMarkdown(docId, markdown, { refreshTabs = true } = {}) {
    const doc = docById(docId);
    if (!doc) return;
    if (markdown === doc.markdown) delete state.drafts[docId];
    else state.drafts[docId] = markdown;
    const tab = state.tabs.find((item) => item.docId === docId);
    if (tab) tab.dirty = markdown !== doc.markdown;
    if (refreshTabs) refreshDirtyIndicators();
    else {
      updateSaveState();
      persistSoon();
    }
    persistSoon();
  }

  function toggleEditMode() {
    if (!activeDoc()) return;
    if (state.editMode) {
      finishBlockEdit();
      state.editMode = false;
      state.sourceMode = false;
      renderDoc();
    } else {
      state.editMode = true;
      state.sourceMode = false;
      renderDoc();
      $("article").classList.add("editing-enabled");
      showToast("点击任意段落开始编辑");
    }
    updateTopbar();
  }

  function toggleSourceMode() {
    if (!activeDoc()) return;
    finishBlockEdit();
    state.editMode = true;
    state.sourceMode = !state.sourceMode;
    renderDoc();
    if (state.sourceMode) {
      requestAnimationFrame(() => {
        $("sourceEditor").focus();
      });
    }
    updateTopbar();
  }

  function convertCurrentBlock(type) {
    const doc = activeDoc();
    const block = currentEditingBlock();
    if (!doc || !block) return;

    syncEditingBlock();
    const text = inlineDomToMarkdown(
      $("article").querySelector(
        `.block[data-block-index="${state.editingBlock}"] .block-content`,
      ),
    )
      .replace(/\n+/g, " ")
      .trim();

    if (type === "paragraph") {
      block.type = "paragraph";
      block.content = text;
      block.markdown = text || "新段落";
    } else if (/^h[1-6]$/.test(type)) {
      const level = Number(type[1]);
      block.type = "heading";
      block.level = level;
      block.text = text || "新标题";
      block.markdown = `${"#".repeat(level)} ${block.text}`;
    } else if (type === "quote") {
      block.type = "quote";
      block.content = text;
      block.markdown = text
        .split("\n")
        .map((line) => `> ${line}`.trimEnd())
        .join("\n");
    } else if (type === "code") {
      block.type = "code";
      block.lang = block.lang || "";
      block.content = text;
      block.markdown = `\`\`\`${block.lang}\n${text || "代码"}\n\`\`\``;
    } else if (type === "ul" || type === "ol" || type === "task") {
      block.type = "list";
      const prefix = type === "ol" ? "1. " : "- ";
      const task = type === "task" ? "[ ] " : "";
      block.content = `${prefix}${task}${text || "列表项"}`;
      block.markdown = block.content;
    }

    const markdown = blocksToMarkdown(state.blocksByDoc[doc.id]);
    setWorkingMarkdown(doc.id, markdown);
    renderDoc();
    beginBlockEdit(state.editingBlock);
  }

  function insertTableAfterCurrent() {
    const doc = activeDoc();
    const block = currentEditingBlock();
    if (!doc || !block) return;
    syncEditingBlock();
    const blocks = state.blocksByDoc[doc.id];
    const index = state.editingBlock;
    blocks.splice(index + 1, 0, {
      type: "table",
      header: ["列 1", "列 2"],
      align: ["left", "left"],
      rows: [["内容", "内容"]],
      markdown: "| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |",
    });
    const markdown = blocksToMarkdown(blocks);
    state.editingBlock = null;
    setWorkingMarkdown(doc.id, markdown);
    renderDoc();
    beginBlockEdit(index + 1);
  }

  function wrapSelection(tagName) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) {
      showToast("先选中一段文字");
      return;
    }
    const range = selection.getRangeAt(0);
    const element = document.createElement(tagName);
    try {
      range.surroundContents(element);
    } catch (error) {
      element.append(range.extractContents());
      range.insertNode(element);
    }
    selection.removeAllRanges();
    const next = document.createRange();
    next.selectNodeContents(element);
    selection.addRange(next);
    syncEditingBlock();
  }

  function runToolbarCommand(command) {
    if (state.editingBlock === null) {
      showToast("先点击一个块，再使用格式工具");
      return;
    }

    const content = $("article").querySelector(
      `.block[data-block-index="${state.editingBlock}"] .block-content`,
    );
    if (!content) return;
    content.focus();

    if (["bold", "italic", "strikeThrough", "undo", "redo"].includes(command)) {
      document.execCommand(command, false, null);
      syncEditingBlock();
      return;
    }

    if (command === "inlineCode") {
      wrapSelection("code");
      return;
    }

    if (command === "link") {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        showToast("先选中要添加链接的文字");
        return;
      }
      const href = window.prompt("输入链接地址", "https://");
      if (!href) return;
      document.execCommand("createLink", false, safeUrl(href));
      syncEditingBlock();
      return;
    }

    if (command === "unorderedList") convertCurrentBlock("ul");
    if (command === "orderedList") convertCurrentBlock("ol");
    if (command === "taskList") convertCurrentBlock("task");
    if (command === "quoteBlock") convertCurrentBlock("quote");
    if (command === "table") insertTableAfterCurrent();
  }

  /* ------------------------------- 保存 / 新建 / 恢复 ------------------------------- */

  function replaceDocument(doc, versions = null) {
    const index = state.docs.findIndex((item) => item.id === doc.id);
    if (index >= 0) state.docs[index] = doc;
    else state.docs.push(doc);
    if (versions) state.versions[doc.id] = versions;
  }

  function showConflict(doc, current) {
    state.conflictDocId = doc.id;
    state.conflictCurrent = current;
    state.conflictRemote = current.markdown;
    $("conflictBody").textContent =
      "保存前检测到文件已在磁盘上变化。你的未保存内容仍然保留，可以先查看差异，再决定覆盖或加载磁盘版本。";
    $("conflictMeta").innerHTML = `
      <span>你的版本：本地未保存</span>
      <span>磁盘版本：${escapeHtml(relativeTime(current.updatedAt))}</span>
    `;
    $("conflictModal").hidden = false;
  }

  async function saveDocument(docId, reason = "手动保存", { force = false } = {}) {
    const doc = docById(docId);
    if (!doc) return false;

    if (docId === state.activeDocId && state.editingBlock !== null) syncEditingBlock();
    const tab = state.tabs.find((item) => item.docId === docId);
    const markdown = workingMarkdown(docId);
    if (!force && !tab?.dirty && markdown === doc.markdown) {
      updateSaveState();
      showToast("没有新的修改");
      return false;
    }

    try {
      const result = await apiRequest(`/api/docs/${encodeURIComponent(docId)}`, {
        method: "PUT",
        body: {
          markdown,
          baseHash: doc.hash,
          force,
        },
      });
      replaceDocument(result.doc, result.versions);
      if (tab) tab.dirty = false;
      delete state.drafts[docId];
      state.lastSavedMarkdown = markdown;
      persistNow();
      renderTree();
      renderTabs();
      renderHistory();
      updateTopbar();
      updateSaveState(result.doc.updatedAt);

      if (docId === state.activeDocId) {
        const blocks = parseBlocks(result.doc.markdown);
        state.blocksByDoc[docId] = blocks;
        state.headingsByDoc[docId] = assignHeadingIds(blocks);
        renderOutline();
        if (state.sourceMode) updateSourceStats();
      }

      showToast(
        result.saved
          ? `已保存${reason === "手动保存" ? "" : ` · ${reason}`} · 前一版已留档`
          : "文件内容没有变化",
      );
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === "DOCUMENT_CHANGED" && error.details?.current) {
        showConflict(doc, error.details.current);
        return false;
      }
      showToast(error.message || "保存失败");
      return false;
    }
  }

  async function saveActiveDocument() {
    finishBlockEdit();
    if (!activeDoc()) return false;
    return await saveDocument(state.activeDocId);
  }

  function removeTab(docId, { discardDraft = false } = {}) {
    const index = state.tabs.findIndex((tab) => tab.docId === docId);
    if (index < 0) return;
    if (discardDraft) delete state.drafts[docId];
    state.tabs.splice(index, 1);
    if (!state.tabs.length) {
      state.activeDocId = null;
      state.editingBlock = null;
      state.editMode = false;
      state.sourceMode = false;
    } else if (state.activeDocId === docId) {
      state.activeDocId = state.tabs[Math.max(0, index - 1)].docId;
      state.editingBlock = null;
      state.sourceMode = false;
    }
    persistNow();
    renderAll();
  }

  function closeTab(docId) {
    const tab = state.tabs.find((item) => item.docId === docId);
    if (!tab) return;
    const doc = docById(docId);

    if (!tab.dirty) {
      removeTab(docId);
      return;
    }

    openChoiceDialog({
      eyebrow: "Unsaved changes",
      title: "这篇还有未保存修改",
      body: `「${doc?.title || "文档"}」的当前内容还没有写入历史。关闭标签前要先保存吗？`,
      actions: [
        { label: "取消", className: "ghost-btn", onClick: () => {} },
        {
          label: "不保存关闭",
          className: "ghost-btn danger-btn",
          onClick: () => removeTab(docId, { discardDraft: true }),
        },
        {
          label: "保存并关闭",
          className: "primary-btn",
          onClick: async () => {
            if (await saveDocument(docId)) removeTab(docId);
          },
        },
      ],
    });
  }

  function openDoc(docId, { resetScroll = false } = {}) {
    const doc = docById(docId);
    if (!doc) return;
    finishBlockEdit();
    let tab = state.tabs.find((item) => item.docId === docId);
    if (!tab) {
      tab = { docId, dirty: Boolean(state.drafts[docId]), scrollTop: 0 };
      state.tabs.push(tab);
    }
    if (state.activeDocId !== docId) {
      state.sourceMode = false;
      state.editingBlock = null;
    }
    state.activeDocId = docId;
    if (resetScroll) tab.scrollTop = 0;
    closeMobileSidebar();
    renderAll({ scrollToTab: true });
    persistSoon();
  }

  function openNewDocModal() {
    const stamp = new Date();
    const name = `${stamp.getMonth() + 1}-${stamp.getDate()}-新页面`;
    $("newDocPath").value = `notes/${name}.md`;
    $("newDocTitle").value = "新页面";
    $("newDocTip").textContent = "会在当前目录中真实创建一个 Markdown 文件。";
    $("newDocTip").classList.remove("error");
    $("newDocModal").hidden = false;
    requestAnimationFrame(() => $("newDocPath").focus());
  }

  async function createNewDoc(event) {
    event.preventDefault();
    let pathValue = $("newDocPath").value.trim().replace(/^\/+/, "");
    const title = $("newDocTitle").value.trim() || "新页面";
    const tip = $("newDocTip");

    if (!pathValue) pathValue = `notes/${Date.now()}.md`;
    if (!/\.md$/i.test(pathValue)) pathValue += ".md";
    if (pathValue.includes("..")) {
      tip.textContent = "路径不能包含 ..";
      tip.classList.add("error");
      return;
    }
    if (state.docs.some((doc) => doc.path === pathValue)) {
      tip.textContent = "这个路径已经有文档了";
      tip.classList.add("error");
      return;
    }

    try {
      const markdown = `# ${title}\n\n从这里开始写。\n\n## 第一段\n\n点击这一段，就可以在原地修改。\n`;
      const result = await apiRequest("/api/docs", {
        method: "POST",
        body: { path: pathValue, title, markdown },
      });
      replaceDocument(result.doc, result.versions);
      const parent = result.doc.path.split("/").slice(0, -1).join("/");
      if (parent) {
        const segments = parent.split("/");
        segments.forEach((_, index) => {
          const folder = segments.slice(0, index + 1).join("/");
          if (!state.ui.folders.includes(folder)) state.ui.folders.push(folder);
        });
      }
      $("newDocModal").hidden = true;
      persistNow();
      openDoc(result.doc.id, { resetScroll: true });
      showToast(`已创建「${result.doc.path}」`);
    } catch (error) {
      tip.textContent = error.message || "创建文档失败";
      tip.classList.add("error");
    }
  }

  async function restoreVersion(version) {
    const doc = activeDoc();
    if (!doc || !version) return;
    finishBlockEdit();
    try {
      const result = await apiRequest(
        `/api/docs/${encodeURIComponent(doc.id)}/versions/${encodeURIComponent(
          version.id,
        )}/restore`,
        { method: "POST", body: {} },
      );
      replaceDocument(result.doc, result.versions);
      const tab = activeTab();
      if (tab) tab.dirty = false;
      delete state.drafts[doc.id];
      state.editMode = false;
      state.sourceMode = false;
      state.editingBlock = null;
      persistNow();
      renderAll();
      showToast("已恢复历史版本 · 恢复前内容已留档");
    } catch (error) {
      showToast(error.message || "恢复历史版本失败");
    }
  }

  /* ------------------------------- 历史差异 ------------------------------- */

  function lineDiff(oldText, newText) {
    const oldLines = String(oldText).replace(/\r\n/g, "\n").split("\n");
    const newLines = String(newText).replace(/\r\n/g, "\n").split("\n");
    const rows = [];
    const matrix = Array.from({ length: oldLines.length + 1 }, () =>
      new Uint16Array(newLines.length + 1),
    );

    for (let i = oldLines.length - 1; i >= 0; i -= 1) {
      for (let j = newLines.length - 1; j >= 0; j -= 1) {
        matrix[i][j] =
          oldLines[i] === newLines[j]
            ? matrix[i + 1][j + 1] + 1
            : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
      }
    }

    let i = 0;
    let j = 0;
    let oldNumber = 1;
    let newNumber = 1;
    while (i < oldLines.length && j < newLines.length) {
      if (oldLines[i] === newLines[j]) {
        rows.push({
          type: "same",
          oldLine: oldLines[i],
          newLine: newLines[j],
          oldNumber,
          newNumber,
        });
        i += 1;
        j += 1;
        oldNumber += 1;
        newNumber += 1;
      } else if (matrix[i + 1][j] >= matrix[i][j + 1]) {
        rows.push({
          type: "remove",
          oldLine: oldLines[i],
          newLine: null,
          oldNumber,
          newNumber: null,
        });
        i += 1;
        oldNumber += 1;
      } else {
        rows.push({
          type: "add",
          oldLine: null,
          newLine: newLines[j],
          oldNumber: null,
          newNumber,
        });
        j += 1;
        newNumber += 1;
      }
    }
    while (i < oldLines.length) {
      rows.push({
        type: "remove",
        oldLine: oldLines[i],
        newLine: null,
        oldNumber,
        newNumber: null,
      });
      i += 1;
      oldNumber += 1;
    }
    while (j < newLines.length) {
      rows.push({
        type: "add",
        oldLine: null,
        newLine: newLines[j],
        oldNumber: null,
        newNumber,
      });
      j += 1;
      newNumber += 1;
    }
    return rows;
  }

  function diffRowHtml(type, number, line, extraClass = "") {
    return `
      <div class="diff-row ${type} ${extraClass}">
        <span class="ln">${number || ""}</span>
        <span class="code">${line === null ? "" : escapeHtml(line)}</span>
      </div>
    `;
  }

  function openDiffModal({ title, meta, oldMarkdown, newMarkdown, restoreVersion }) {
    const rows = lineDiff(oldMarkdown, newMarkdown);
    $("diffTitle").textContent = title;
    $("diffMeta").textContent = meta;

    const left = rows
      .map((row) =>
        row.type === "add"
          ? diffRowHtml("blank", "", "")
          : diffRowHtml(row.type === "remove" ? "remove" : "same", row.oldNumber, row.oldLine),
      )
      .join("");
    const right = rows
      .map((row) =>
        row.type === "remove"
          ? diffRowHtml("blank", "", "")
          : diffRowHtml(row.type === "add" ? "add" : "same", row.newNumber, row.newLine),
      )
      .join("");
    const unified = rows
      .map((row) => {
        if (row.type === "add") return diffRowHtml("add", row.newNumber, row.newLine);
        if (row.type === "remove") return diffRowHtml("remove", row.oldNumber, row.oldLine);
        return diffRowHtml("same", row.newNumber, row.newLine);
      })
      .join("");

    $("diffSide").innerHTML = `
      <div class="diff-col">
        <div class="diff-col-title">旧版本</div>
        ${left || '<div class="rail-empty">空文档</div>'}
      </div>
      <div class="diff-col">
        <div class="diff-col-title">当前 / 新版本</div>
        ${right || '<div class="rail-empty">空文档</div>'}
      </div>
    `;
    $("diffUnified").innerHTML = unified || '<div class="rail-empty">内容相同</div>';
    state.pendingRestore = restoreVersion || null;
    $("restoreVersionBtn").hidden = !restoreVersion;
    $("diffModal").hidden = false;
  }

  async function openVersionDiff(versionIdValue) {
    const doc = activeDoc();
    if (!doc) return;
    const version = (state.versions[doc.id] || []).find((item) => item.id === versionIdValue);
    if (!version) return;
    try {
      const data = await apiRequest(
        `/api/docs/${encodeURIComponent(doc.id)}/versions/${encodeURIComponent(
          version.id,
        )}`,
      );
      closeRailSheet();
      openDiffModal({
        title: "历史版本对比",
        meta: `${data.version.reason || "历史版本"} · ${formatDateTime(
          data.version.createdAt,
        )} → 当前工作区 · ${doc.path}`,
        oldMarkdown: data.version.markdown,
        newMarkdown: workingMarkdown(doc.id),
        restoreVersion: data.version,
      });
    } catch (error) {
      showToast(error.message || "读取历史版本失败");
    }
  }

  /* ------------------------------- 搜索 ------------------------------- */

  function searchDocs(query) {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const results = [];

    for (const doc of state.docs) {
      const markdown = workingMarkdown(doc.id);
      const text = plainText(markdown);
      const haystack = `${doc.title} ${doc.path} ${text}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
      const index = text.toLowerCase().indexOf(needle);
      let snippet = text;
      if (index >= 0) {
        snippet = text.slice(Math.max(0, index - 42), Math.min(text.length, index + 118));
        if (index > 42) snippet = `…${snippet}`;
        if (index + 118 < text.length) snippet += "…";
      } else {
        snippet = `${doc.path} · ${doc.title}`;
      }
      results.push({ doc, snippet, index });
    }

    return results.sort((a, b) => {
      const aTitle = a.doc.title.toLowerCase().includes(needle) ? 0 : 1;
      const bTitle = b.doc.title.toLowerCase().includes(needle) ? 0 : 1;
      return aTitle - bTitle || a.doc.path.localeCompare(b.doc.path, "zh-CN");
    });
  }

  function snippetHtml(snippet, query) {
    const escaped = escapeHtml(snippet);
    const escapedQuery = escapeHtml(query.trim());
    if (!escapedQuery) return escaped;
    return escaped.replace(new RegExp(escapeRegExp(escapedQuery), "gi"), (match) => `<mark>${match}</mark>`);
  }

  function renderDocFilter(query) {
    state.searchQuery = query;
    renderTree();
  }

  function renderGlobalSearch(query) {
    state.globalSearchQuery = query;
    const trimmed = query.trim();
    const resultsBox = $("globalSearchResults");
    const meta = $("globalSearchMeta");

    if (!trimmed) {
      meta.textContent = "输入关键词，搜索所有 Markdown 文档。";
      resultsBox.innerHTML = `
        <div class="global-search-empty">
          <span aria-hidden="true">⌕</span>
          <strong>从一个词开始</strong>
          <p>标题、路径和正文都会被搜索。找到结果后按 Enter 打开，并定位到命中的块。</p>
        </div>
      `;
      return;
    }

    const results = searchDocs(trimmed);
    meta.textContent = `${results.length} 篇文档命中「${trimmed}」`;
    if (!results.length) {
      resultsBox.innerHTML = `
        <div class="global-search-empty">
          <span aria-hidden="true">∅</span>
          <strong>没有找到结果</strong>
          <p>试试标题里的词、文件路径，或更短的正文片段。</p>
        </div>
      `;
      return;
    }

    resultsBox.innerHTML = results
      .map(
        ({ doc, snippet }) => `
          <button class="global-search-result" type="button"
            data-global-search-doc="${escapeHtml(doc.id)}"
            data-global-search-query="${escapeHtml(trimmed)}">
            <span class="global-result-mark" aria-hidden="true">↗</span>
            <span class="global-result-main">
              <strong>${escapeHtml(doc.title)}</strong>
              <span class="global-result-path">${escapeHtml(doc.path)}</span>
              <span class="global-result-snippet">${snippetHtml(snippet, trimmed)}</span>
            </span>
          </button>
        `,
      )
      .join("");
  }

  function openGlobalSearch() {
    state.globalSearchOpener = document.activeElement;
    $("globalSearchModal").hidden = false;
    const input = $("globalSearchInput");
    input.value = state.globalSearchQuery;
    renderGlobalSearch(input.value);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function closeGlobalSearch({ restoreFocus = true } = {}) {
    $("globalSearchModal").hidden = true;
    if (restoreFocus) {
      const opener = state.globalSearchOpener;
      state.globalSearchOpener = null;
      requestAnimationFrame(() => {
        if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
      });
    } else {
      state.globalSearchOpener = null;
    }
  }

  function openGlobalSearchResult(docId, query) {
    closeGlobalSearch({ restoreFocus: false });
    openDoc(docId);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => locateSearchMatch(query));
    });
  }

  function locateSearchMatch(query) {
    const doc = activeDoc();
    if (!doc || !query) return;
    if (state.sourceMode) {
      state.sourceMode = false;
      renderDoc();
    }
    const needle = query.toLowerCase();
    const blocks = state.blocksByDoc[doc.id] || [];
    let index = blocks.findIndex((block) => block.markdown.toLowerCase().includes(needle));
    if (index < 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const wrapper = $("article").querySelector(`.block[data-block-index="${index}"]`);
    if (!wrapper) return;
    const y = wrapper.getBoundingClientRect().top + window.scrollY - getContentTopOffset();
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    wrapper.classList.remove("search-flash");
    void wrapper.offsetWidth;
    wrapper.classList.add("search-flash");
    setTimeout(() => wrapper.classList.remove("search-flash"), 2100);
  }

  function focusArticleFilter() {
    const focusInput = () => {
      $("searchInput").focus();
      $("searchInput").select();
    };
    const mobile = window.matchMedia("(max-width: 767px)").matches;

    if (mobile) {
      openMobileSidebar();
      setTimeout(focusInput, 240);
      return;
    }

    if (state.ui.sidebarCollapsed) {
      state.ui.sidebarCollapsed = false;
      applyWorkspaceState();
    }
    requestAnimationFrame(focusInput);
  }

  /* ------------------------------- 任务勾选 ------------------------------- */

  function toggleTaskInBlock(blockIndex, taskIndex, checked) {
    const doc = activeDoc();
    if (!doc) return;
    const blocks = state.blocksByDoc[doc.id];
    const block = blocks?.[blockIndex];
    if (!block || block.type !== "list") return;
    const lines = block.markdown.split("\n");
    let count = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/);
      if (!match) continue;
      if (count === taskIndex) {
        lines[index] = `${match[1]}${checked ? "x" : " "}${match[3]}`;
        break;
      }
      count += 1;
    }
    block.markdown = lines.join("\n");
    block.content = block.markdown;
    setWorkingMarkdown(doc.id, blocksToMarkdown(blocks));
  }

  /* ------------------------------- 对话框与提示 ------------------------------- */

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2400);
  }

  function closeModal(id) {
    const modal = $(id);
    if (modal) modal.hidden = true;
    if (id === "diffModal") state.pendingRestore = null;
  }

  function openChoiceDialog({ eyebrow = "请确认", title, body, actions }) {
    $("choiceEyebrow").textContent = eyebrow;
    $("choiceTitle").textContent = title;
    $("choiceBody").textContent = body;
    const box = $("choiceActions");
    box.innerHTML = "";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.className || "ghost-btn";
      button.textContent = action.label;
      button.addEventListener("click", () => {
        closeModal("choiceModal");
        action.onClick?.();
      });
      box.append(button);
    }
    $("choiceModal").hidden = false;
    requestAnimationFrame(() => box.querySelector("button")?.focus());
  }

  /* ------------------------------- 侧栏 / 弹层 / 主题 ------------------------------- */

  function applyWorkspaceState() {
    document.documentElement.dataset.theme = state.ui.theme;
    $("workspace").classList.toggle(
      "sidebar-collapsed",
      state.ui.sidebarCollapsed && !window.matchMedia("(max-width: 767px)").matches,
    );
  }

  function toggleSidebar() {
    if (window.matchMedia("(max-width: 767px)").matches) {
      if ($("sidebar").classList.contains("mobile-open")) closeMobileSidebar();
      else openMobileSidebar();
      return;
    }
    state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
    applyWorkspaceState();
    persistNow();
  }

  function openMobileSidebar() {
    $("sidebar").classList.add("mobile-open");
    $("drawerScrim").hidden = false;
  }

  function closeMobileSidebar() {
    $("sidebar").classList.remove("mobile-open");
    $("drawerScrim").hidden = true;
  }

  function openRailSheet() {
    renderOutline();
    renderHistory();
    setRailTab(state.ui.railTab);
    $("railSheet").hidden = false;
  }

  function closeRailSheet() {
    $("railSheet").hidden = true;
  }

  function toggleTheme() {
    state.ui.theme = state.ui.theme === "night" ? "paper" : "night";
    applyWorkspaceState();
    updateTopbar();
    persistNow();
  }

  async function rescanWorkspace() {
    const button = $("resetDemoBtn");
    button.disabled = true;
    button.textContent = "正在扫描…";
    try {
      await loadFromServer();
      showToast(`已重新扫描 · ${state.docs.length} 篇 Markdown`);
    } catch (error) {
      showToast(error.message || "重新扫描失败");
    } finally {
      button.disabled = false;
      button.textContent = "重新扫描文件";
    }
  }

  async function handleExternalDocumentUpdate(payload) {
    const doc = docById(payload.id);
    if (!doc || doc.hash === payload.hash) return;

    if (state.activeDocId === doc.id && isDirty(doc.id)) {
      showToast("磁盘文件已更新；保存时将先提示冲突");
      return;
    }

    try {
      const data = await apiRequest(`/api/docs/${encodeURIComponent(doc.id)}`);
      replaceDocument(data.doc, data.versions);
      if (state.activeDocId === doc.id) renderDoc();
      renderTree();
      renderHistory();
      showToast(`磁盘文件已更新 · ${doc.path}`);
    } catch (error) {
      showToast(error.message || "同步外部修改失败");
    }
  }

  function connectEventStream() {
    state.eventSource?.close();
    const source = new EventSource("/api/events");
    state.eventSource = source;

    source.addEventListener("document-updated", (event) => {
      try {
        handleExternalDocumentUpdate(JSON.parse(event.data));
      } catch (error) {
        console.warn("Invalid PageNest update event", error);
      }
    });
    source.addEventListener("document-created", async () => {
      try {
        await loadFromServer();
        showToast("检测到新文档");
      } catch (error) {
        showToast(error.message || "同步新文档失败");
      }
    });
  }

  /* ------------------------------- 滚动 ------------------------------- */

  const persistScroll = debounce(() => {
    const tab = activeTab();
    if (tab) {
      tab.scrollTop = window.scrollY;
      persistSoon();
    }
  }, 120);

  const updateOutlineSoon = debounce(updateActiveOutline, 70);

  function onScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
    $("progressBar").style.width = `${progress}%`;
    updateOutlineSoon();
    persistScroll();
  }

  /* ------------------------------- 事件绑定 ------------------------------- */

  function bindEvents() {
    $("sidebarToggle").addEventListener("click", toggleSidebar);
    $("drawerScrim").addEventListener("click", closeMobileSidebar);
    $("newDocBtn").addEventListener("click", openNewDocModal);
    $("emptyOpenBtn").addEventListener("click", () => {
      const first = state.docs[0];
      if (first) openDoc(first.id);
    });

    $("searchTopBtn").addEventListener("click", openGlobalSearch);
    $("searchInput").addEventListener("input", (event) =>
      renderDocFilter(event.target.value),
    );
    $("searchInput").addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.target.value = "";
        renderDocFilter("");
        event.target.blur();
      }
    });

    $("globalSearchClose").addEventListener("click", () => closeGlobalSearch());
    $("globalSearchScrim").addEventListener("click", () => closeGlobalSearch());
    $("globalSearchInput").addEventListener("input", (event) =>
      renderGlobalSearch(event.target.value),
    );
    $("globalSearchInput").addEventListener("keydown", (event) => {
      const firstResult = $("globalSearchResults").querySelector(".global-search-result");
      if (event.key === "ArrowDown" && firstResult) {
        event.preventDefault();
        firstResult.focus();
      } else if (event.key === "Enter" && firstResult) {
        event.preventDefault();
        firstResult.click();
      }
    });
    $("globalSearchResults").addEventListener("click", (event) => {
      const result = event.target.closest("[data-global-search-doc]");
      if (!result) return;
      openGlobalSearchResult(
        result.dataset.globalSearchDoc,
        result.dataset.globalSearchQuery,
      );
    });
    $("globalSearchResults").addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      const results = $$(".global-search-result", event.currentTarget);
      const index = results.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === "ArrowDown" ? index + 1 : index - 1;
      results[Math.max(0, Math.min(results.length - 1, next))].focus();
    });

    $("treePanel").addEventListener("click", (event) => {
      const folder = event.target.closest("[data-folder-path]");
      if (folder) {
        const path = folder.dataset.folderPath;
        const index = state.ui.folders.indexOf(path);
        if (index >= 0) state.ui.folders.splice(index, 1);
        else state.ui.folders.push(path);
        renderTree();
        persistSoon();
        return;
      }
      const docButton = event.target.closest("[data-doc-id]");
      if (docButton) openDoc(docButton.dataset.docId);
    });

    $("tabStrip").addEventListener("click", (event) => {
      const close = event.target.closest("[data-close-doc]");
      if (close) {
        event.stopPropagation();
        closeTab(close.dataset.closeDoc);
        return;
      }
      const tab = event.target.closest("[data-tab-doc]");
      if (tab) openDoc(tab.dataset.tabDoc);
    });

    $("editToggle").addEventListener("click", toggleEditMode);
    $("sourceToggle").addEventListener("click", toggleSourceMode);
    $("saveBtn").addEventListener("click", saveActiveDocument);
    $("themeToggle").addEventListener("click", toggleTheme);
    $("resetDemoBtn").addEventListener("click", rescanWorkspace);
    $("starsBtn").addEventListener("click", openFavoritesPanel);
    $("starsClose").addEventListener("click", () => closeFavoritesPanel());
    $("starsScrim").addEventListener("click", () => closeFavoritesPanel());

    for (const button of $$("[data-nav-mode]")) {
      button.addEventListener("click", () => setNavMode(button.dataset.navMode));
    }

    $("starsList").addEventListener("click", (event) => {
      const remove = event.target.closest("[data-star-remove]");
      if (remove) {
        removeFavorite(remove.dataset.starDoc, remove.dataset.starRemove);
        return;
      }
      const jump = event.target.closest("[data-star-heading]");
      if (jump) openFavoriteTarget(jump.dataset.starDoc, jump.dataset.starHeading);
    });

    $("toolMore").addEventListener("click", () => {
      const open = $("editToolbar").classList.toggle("extra-open");
      $("toolMore").setAttribute("aria-expanded", String(open));
    });

    $$(".tool-btn").forEach((button) => {
      button.addEventListener("click", () => runToolbarCommand(button.dataset.command));
    });

    $("blockTypeSelect").addEventListener("change", (event) => {
      convertCurrentBlock(event.target.value);
    });

    $("article").addEventListener("click", (event) => {
      const favorite = event.target.closest("[data-favorite-id]");
      if (favorite) {
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite(
          favorite.dataset.favoriteDoc,
          favorite.dataset.favoriteId,
          favorite.dataset.favoriteTitle,
          Number(favorite.dataset.favoriteLevel),
          Number(favorite.dataset.favoriteIndex),
        );
        return;
      }

      const checkbox = event.target.closest('input[type="checkbox"][data-task-index]');
      if (checkbox && !state.editMode) {
        const wrapper = checkbox.closest("[data-block-index]");
        if (wrapper) {
          toggleTaskInBlock(
            Number(wrapper.dataset.blockIndex),
            Number(checkbox.dataset.taskIndex),
            checkbox.checked,
          );
        }
        return;
      }

      const editButton = event.target.closest("[data-edit-block]");
      if (editButton) {
        event.preventDefault();
        beginBlockEdit(Number(editButton.dataset.editBlock));
        return;
      }

      if (!state.editMode || state.sourceMode) return;
      if (event.target.closest("a")) event.preventDefault();
      const wrapper = event.target.closest("[data-block-index]");
      if (wrapper) {
        beginBlockEdit(Number(wrapper.dataset.blockIndex), {
          x: event.clientX,
          y: event.clientY,
        });
      }
    });

    $("article").addEventListener("input", (event) => {
      if (!event.target.closest('.block-content[contenteditable="true"]')) return;
      syncEditingBlockSoon();
    });

    $("article").addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.editingBlock !== null) {
        event.preventDefault();
        finishBlockEdit();
        renderDoc();
      }
    });

    $("sourceEditor").addEventListener("input", (event) => {
      const doc = activeDoc();
      if (!doc) return;
      setWorkingMarkdown(doc.id, event.target.value);
      updateSourceStats();
    });

    $$("[data-rail-tab]").forEach((button) => {
      button.addEventListener("click", () => setRailTab(button.dataset.railTab));
    });

    for (const container of [$("outlineList"), $("sheetOutlineList")]) {
      container.addEventListener("click", (event) => {
        const button = event.target.closest("[data-heading-id]");
        if (button) scrollToHeading(button.dataset.headingId);
      });
    }

    for (const container of [$("historyList"), $("sheetHistoryList")]) {
      container.addEventListener("click", (event) => {
        const button = event.target.closest("[data-version-id]");
        if (button) openVersionDiff(button.dataset.versionId);
      });
    }

    $("backTopBtn").addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: "smooth" }),
    );
    $("railFab").addEventListener("click", openRailSheet);
    $("railSheetClose").addEventListener("click", closeRailSheet);
    $("railSheetScrim").addEventListener("click", closeRailSheet);

    $("newDocForm").addEventListener("submit", createNewDoc);
    $$("[data-close-modal]").forEach((node) => {
      node.addEventListener("click", () => closeModal(node.dataset.closeModal));
    });
    $$("[data-close-choice]").forEach((node) => {
      node.addEventListener("click", () => closeModal("choiceModal"));
    });

    $("restoreVersionBtn").addEventListener("click", () => {
      const version = state.pendingRestore;
      if (!version) return;
      closeModal("diffModal");
      openChoiceDialog({
        eyebrow: "Restore version",
        title: "恢复这个历史版本？",
        body: `当前内容会先自动留档，然后替换为「${
          version.reason || "历史版本"
        }」的内容。恢复后仍然可以回到刚才的版本。`,
        actions: [
          { label: "取消", className: "ghost-btn", onClick: () => {} },
          {
            label: "确认恢复",
            className: "primary-btn",
            onClick: () => restoreVersion(version),
          },
        ],
      });
    });

    $("conflictKeepLocal").addEventListener("click", async () => {
      const docId = state.conflictDocId || state.activeDocId;
      if (!docId) return;
      closeModal("conflictModal");
      const saved = await saveDocument(docId, "冲突：保留本地", { force: true });
      if (saved) showToast("已保留本地版本 · 磁盘版本已留档");
    });

    $("conflictLoadRemote").addEventListener("click", async () => {
      const docId = state.conflictDocId || state.activeDocId;
      if (!docId) return;
      closeModal("conflictModal");
      try {
        const data = await apiRequest(`/api/docs/${encodeURIComponent(docId)}`);
        replaceDocument(data.doc, data.versions);
        const tab = state.tabs.find((item) => item.docId === docId);
        if (tab) tab.dirty = false;
        delete state.drafts[docId];
        state.editMode = false;
        state.sourceMode = false;
        state.editingBlock = null;
        persistNow();
        renderAll();
        showToast("已放弃本地草稿并加载磁盘版本");
      } catch (error) {
        showToast(error.message || "加载磁盘版本失败");
      }
    });

    $("conflictViewDiff").addEventListener("click", () => {
      const doc = docById(state.conflictDocId) || activeDoc();
      if (!doc) return;
      closeModal("conflictModal");
      openDiffModal({
        title: "冲突差异",
        meta: "磁盘上的版本 → 你的本地未保存版本",
        oldMarkdown: state.conflictRemote,
        newMarkdown: workingMarkdown(doc.id),
        restoreVersion: null,
      });
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", () => {
      if (!window.matchMedia("(max-width: 767px)").matches) closeMobileSidebar();
      applyWorkspaceState();
    });

    window.addEventListener("beforeunload", (event) => {
      persistNow();
      if (state.tabs.some((tab) => tab.dirty)) {
        event.preventDefault();
        event.returnValue = "";
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") persistNow();
    });

    document.addEventListener("keydown", (event) => {
      const meta = event.metaKey || event.ctrlKey;
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (meta && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveActiveDocument();
        return;
      }

      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openGlobalSearch();
        return;
      }

      if (event.key === "/" && !typing) {
        event.preventDefault();
        focusArticleFilter();
        return;
      }

      if (event.key === "Escape") {
        if (!$("globalSearchModal").hidden) {
          closeGlobalSearch();
          return;
        }
        const openModal = ["conflictModal", "diffModal", "choiceModal", "newDocModal"].find(
          (id) => !$(id).hidden,
        );
        if (openModal) {
          closeModal(openModal);
          return;
        }
        if (!$("starsPanel").hidden) {
          closeFavoritesPanel();
          return;
        }
        if (!$("railSheet").hidden) {
          closeRailSheet();
          return;
        }
        if ($("sidebar").classList.contains("mobile-open")) {
          closeMobileSidebar();
          return;
        }
        if (state.editingBlock !== null) {
          finishBlockEdit();
          renderDoc();
        }
      }
    });

    document.addEventListener("click", (event) => {
      if (state.editingBlock === null) return;
      if (
        event.target.closest(".block.is-editing") ||
        event.target.closest("#article") ||
        event.target.closest("#editToolbar")
      ) {
        return;
      }
      finishBlockEdit();
    });
  }

  const syncEditingBlockSoon = debounce(syncEditingBlock, 160);

  /* ------------------------------- 启动 ------------------------------- */

  async function init() {
    loadUiState();
    applyWorkspaceState();
    bindEvents();
    try {
      await loadFromServer({ initial: true });
      connectEventStream();
      const tab = activeTab();
      if (tab?.dirty) {
        setTimeout(() => showToast("已恢复上次未保存的草稿"), 260);
      }
    } catch (error) {
      showBootError(error);
    }
  }

  init().catch((error) => showBootError(error));
})();
