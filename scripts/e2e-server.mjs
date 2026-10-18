import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const root = path.resolve(".tmp/e2e-notes");
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(path.dirname(root), { recursive: true });
await fs.cp(path.resolve("test/fixtures/notes"), root, { recursive: true });

const child = spawn(process.execPath, ["./bin/pagenest.js", root, "--no-open", "--port", "4321"], {
  stdio: "inherit",
});

function stop(signal = "SIGTERM") {
  if (!child.killed) child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
