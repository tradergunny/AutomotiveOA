import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    // Claude Code session worktrees live inside the repo (.claude/worktrees,
    // git-excluded) — each carries its own tests/ against old code.
    exclude: [...configDefaults.exclude, ".claude/**"],
    // guard tests share one database — keep files sequential
    fileParallelism: false,
  },
});
