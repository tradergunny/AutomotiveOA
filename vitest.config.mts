import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    // guard tests share one database — keep files sequential
    fileParallelism: false,
  },
});
