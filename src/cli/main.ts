import { runCli } from "./index.js";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`pagenest: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
