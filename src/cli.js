import crypto from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { startPaperMDServer } from "./server.js";
import { isLoopbackHost } from "./library.js";

const require = createRequire(import.meta.url);
const { version: packageVersion } = require("../package.json");

const HELP = `PaperMD / 纸页 ${packageVersion}

把一个 Markdown 目录变成可在浏览器里阅读、编辑和回溯的本地工作台。

用法:
  papermd [directory] [options]

选项:
  -p, --port <number>   监听端口，默认 4321
      --host <host>     监听地址，默认 127.0.0.1
      --token [token]   启用访问令牌；非本机监听时自动启用
      --open            启动后打开浏览器（默认）
      --no-open         不打开浏览器
  -h, --help            显示帮助
  -v, --version         显示版本

示例:
  papermd ./docs
  papermd . --port 8080 --no-open
  papermd ./notes --host 0.0.0.0
`;

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseArguments(args) {
  const options = {
    directory: "",
    host: "127.0.0.1",
    port: 4321,
    open: true,
    token: "",
    tokenRequested: false,
    help: false,
    version: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-h" || argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "-v" || argument === "--version") {
      options.version = true;
      continue;
    }
    if (argument === "--open") {
      options.open = true;
      continue;
    }
    if (argument === "--no-open") {
      options.open = false;
      continue;
    }
    if (argument === "-p" || argument === "--port") {
      const value = takeValue(args, index, argument);
      const port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error("Port must be an integer between 0 and 65535.");
      }
      options.port = port;
      index += 1;
      continue;
    }
    if (argument === "--host") {
      options.host = takeValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--token") {
      const next = args[index + 1];
      options.tokenRequested = true;
      if (next && !next.startsWith("-")) {
        options.token = next;
        index += 1;
      }
      continue;
    }
    if (argument.startsWith("--token=")) {
      options.tokenRequested = true;
      options.token = argument.slice("--token=".length);
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (options.directory) {
      throw new Error("Only one document directory can be opened at a time.");
    }
    options.directory = argument;
  }

  if (!options.token) {
    const needsToken = options.tokenRequested || !isLoopbackHost(options.host);
    if (needsToken) {
      options.tokenRequested = true;
      options.token = crypto.randomBytes(18).toString("base64url");
    }
  }

  return options;
}

function networkAddress(host) {
  if (host === "0.0.0.0" || host === "::") {
    for (const interfaces of Object.values(os.networkInterfaces())) {
      for (const entry of interfaces || []) {
        if (entry.family === "IPv4" && !entry.internal) return entry.address;
      }
    }
  }
  return host;
}

function displayHost(host) {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  if (host === "::1") return "[::1]";
  return host;
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Browser launching is a convenience; the printed URL is always authoritative.
  }
}

export async function runCli(args) {
  const options = parseArguments(args);
  if (options.help) {
    console.log(HELP.trimEnd());
    return;
  }
  if (options.version) {
    console.log(packageVersion);
    return;
  }

  const root = path.resolve(options.directory || process.cwd());
  const { server, library, address } = await startPaperMDServer({
    root,
    host: options.host,
    port: options.port,
    token: options.token,
  });

  const port = typeof address === "object" ? address.port : options.port;
  const localUrl = `http://${displayHost(options.host)}:${port}/`;
  const accessUrl = options.token
    ? `${localUrl}?token=${encodeURIComponent(options.token)}`
    : localUrl;
  const lanHost = networkAddress(options.host);
  const lanUrl =
    lanHost !== options.host && !isLoopbackHost(options.host)
      ? `http://${lanHost}:${port}/${options.token ? `?token=${encodeURIComponent(options.token)}` : ""}`
      : "";

  console.log("");
  console.log("  纸页 PaperMD");
  console.log(`  目录  ${library.root}`);
  console.log(`  地址  ${accessUrl}`);
  if (lanUrl) console.log(`  局域网 ${lanUrl}`);
  if (options.token) {
    console.log("  令牌已启用；打开上述带 token 的地址后，浏览器会自动写入安全 Cookie。");
  }
  console.log("  按 Ctrl+C 停止");
  console.log("");

  if (options.open) openBrowser(accessUrl);

  await new Promise((resolve) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.close(() => resolve());
      setTimeout(() => {
        server.closeAllConnections?.();
        resolve();
      }, 1_500).unref();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export { parseArguments };
