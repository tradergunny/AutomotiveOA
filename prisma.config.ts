import { defineConfig } from "prisma/config";

// Prisma 7 CLI no longer auto-loads .env; Node's built-in loader covers it.
try {
  process.loadEnvFile();
} catch {
  // no .env (e.g. CI with real env vars) — fine
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
});
