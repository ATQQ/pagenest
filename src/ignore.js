const MAX_IGNORE_PATTERNS = 500;
const MAX_IGNORE_PATTERN_LENGTH = 300;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern) {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === "\\" && index + 1 < pattern.length) {
      source += escapeRegExp(pattern[index + 1]);
      index += 1;
      continue;
    }

    if (character === "*") {
      if (pattern[index + 1] === "*") {
        if (pattern[index + 2] === "/") {
          source += "(?:[^/]+/)*";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (character === "?") {
      source += "[^/]";
      continue;
    }

    if (character === "[") {
      const closing = pattern.indexOf("]", index + 1);
      if (closing < 0) {
        source += "\\[";
        continue;
      }
      let body = pattern.slice(index + 1, closing);
      if (body.startsWith("!")) body = `^${body.slice(1)}`;
      source += `[${body.replaceAll("\\", "\\\\").replaceAll("]", "\\]")}]`;
      index = closing;
      continue;
    }

    source += escapeRegExp(character);
  }

  return new RegExp(`${source}$`);
}

function prepareLine(value) {
  let line = String(value).replace(/\r$/, "").trim();
  if (!line || line.startsWith("#")) return "";

  if (line.startsWith("\\#") || line.startsWith("\\!")) line = line.slice(1);
  return line;
}

export function normalizeIgnorePatterns(input) {
  if (!Array.isArray(input)) return [];
  const patterns = [];
  const seen = new Set();

  for (const item of input) {
    const lines = String(item).replace(/\r\n?/g, "\n").split("\n");
    for (const rawLine of lines) {
      const line = prepareLine(rawLine);
      if (!line) continue;
      if (line.length > MAX_IGNORE_PATTERN_LENGTH) {
        throw new Error(`Ignore patterns must be at most ${MAX_IGNORE_PATTERN_LENGTH} characters.`);
      }
      if (seen.has(line)) continue;
      seen.add(line);
      patterns.push(line);
      if (patterns.length > MAX_IGNORE_PATTERNS) {
        throw new Error(`At most ${MAX_IGNORE_PATTERNS} ignore patterns are supported.`);
      }
    }
  }

  return patterns;
}

export function parseIgnoreRules(text) {
  const rules = [];

  for (const item of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
    let line = prepareLine(item);
    if (!line) continue;

    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    }
    if (!line) continue;

    let directoryOnly = false;
    if (line.endsWith("/")) {
      directoryOnly = true;
      line = line.slice(0, -1);
    }

    const anchored = line.startsWith("/");
    if (anchored) line = line.slice(1);
    if (!line) continue;

    const hasSlash = line.includes("/");
    rules.push({
      negated,
      directoryOnly,
      matchBasename: !anchored && !hasSlash,
      regex: globToRegExp(line),
    });
  }

  return rules;
}

export function createIgnoreMatcher({ gitignoreText = "", patterns = [] } = {}) {
  const normalized = normalizeIgnorePatterns(patterns);
  const rules = parseIgnoreRules([gitignoreText, ...normalized].join("\n"));

  function matchesExact(relativePath, isDirectory) {
    let ignored = false;
    const basename = relativePath.split("/").pop() || relativePath;

    for (const rule of rules) {
      if (rule.directoryOnly && !isDirectory) continue;
      const target = rule.matchBasename ? basename : relativePath;
      if (rule.regex.test(target)) ignored = !rule.negated;
    }

    return ignored;
  }

  function isIgnored(relativePath, { isDirectory = false } = {}) {
    const normalizedPath = String(relativePath || "")
      .replaceAll("\\", "/")
      .replace(/^\/+|\/+$/g, "");
    if (!normalizedPath) return false;

    const segments = normalizedPath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      if (matchesExact(segments.slice(0, index).join("/"), true)) return true;
    }
    return matchesExact(normalizedPath, isDirectory);
  }

  return {
    rules,
    isIgnored,
    canPruneDirectory: (relativePath) => isIgnored(relativePath, { isDirectory: true }),
  };
}

export {
  MAX_IGNORE_PATTERN_LENGTH,
  MAX_IGNORE_PATTERNS,
};
