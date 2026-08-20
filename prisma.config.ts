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
    // Needed only when AUTHORING migrations (db:migrate:new). The local
    // `prisma dev` server is single-store — every database name maps to the
    // same data — so Prisma's default shadow database would collide with the
    // real one. `prisma dev` runs a dedicated shadow server one port up;
    // point SHADOW_DATABASE_URL at it (see .env.example).
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
});
