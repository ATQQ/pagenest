import { spawn } from "node:child_process";
import process from "node:process";

const argumentsWithoutNode = process.argv.slice(2);
const root = argumentsWithoutNode[0] || process.cwd();
const children = [];

function run(command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, PAGENEST_DEV: "1" },
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
}

run(process.execPath, ["--import", "tsx", "./src/cli/index.ts", root, "--no-open"]);
run(process.execPath, ["./node_modules/vite/bin/vite.js"]);

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
