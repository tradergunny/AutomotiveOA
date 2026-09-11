import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma generated client
    "lib/generated/**",
    // Reference artifacts and docs, not app code
    "docs/**",
    // Claude Code session worktrees checked out inside the repo (git-excluded,
    // which ESLint does not read) — each one is a whole second copy of the app
    ".claude/**",
  ]),
  {
    // The tenant guard intercepts every Prisma operation generically; its
    // internals are inherently dynamic (args shapes vary per model/op).
    files: ["lib/tenant.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
]);

export default eslintConfig;
