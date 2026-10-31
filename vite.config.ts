import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.resolve(root, "package.json"), "utf8")) as {
  version: string;
};

export default defineConfig({
  root: path.resolve(root, "src/client"),
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: path.resolve(root, "dist/client"),
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "^/api/": {
        target: "http://127.0.0.1:4321",
        changeOrigin: false,
      },
    },
  },
});
