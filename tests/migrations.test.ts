import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prismaUnscoped } from "@/lib/db";

/**
 * M7.10 step 1: the committed migrations must apply, in order, on an EMPTY
 * database and produce exactly prisma/schema.prisma — a hand-written
 * migration (the kind backfill) is the easiest place to drift from the
 * datamodel. Prisma's own `migrate diff --from-migrations` does precisely
 * that: it replays every migration onto the shadow database (prisma.config.ts
 * reads it from SHADOW_DATABASE_URL), then compares
 * the result with the schema file; `--exit-code` turns a non-empty diff
 * into exit status 2.
 *
 * The shadow database is the dedicated server `npm run db:dev` runs one
 * port above the main one (prisma.config.ts, .env.example) — the main
 * server is single-store, so a "fresh database" has to live there. Without
 * one reachable (CI with only DATABASE_URL) the test is skipped, loudly.
 */

const PILOT_SHOP = "Somchai Garage";

function shadowDatabaseUrl(): string | null {
  if (process.env.SHADOW_DATABASE_URL) return process.env.SHADOW_DATABASE_URL;
  const main = process.env.DATABASE_URL;
  if (!main) return null;
  try {
    const url = new URL(main);
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
    if (!url.port) return null;
    url.port = String(Number(url.port) + 1);
    url.pathname = "/template1";
    return url.toString();
  } catch {
    return null;
  }
}

function prisma(args: string[], env: Record<string, string>): { status: number; output: string } {
  try {
    const output = execFileSync("npx", ["prisma", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: "pipe",
      timeout: 180_000,
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
    };
  }
}

describe("migrations", () => {
  it("apply on a fresh database and produce schema.prisma exactly", (ctx) => {
    const shadow = shadowDatabaseUrl();
    if (!shadow) {
      console.warn("[migrations] no shadow database URL — fresh-database check skipped");
      ctx.skip();
      return;
    }
    const result = prisma([
      "migrate",
      "diff",
      "--from-migrations",
      "prisma/migrations",
      "--to-schema",
      "prisma/schema.prisma",
      "--exit-code",
    ], { SHADOW_DATABASE_URL: shadow });
    if (result.status === 1 && /P1001|Can't reach database server/.test(result.output)) {
      console.warn("[migrations] shadow database unreachable — fresh-database check skipped");
      ctx.skip();
      return;
    }
    // 0 = migrations and schema agree; 2 = they differ (the diff is printed).
    expect(result.output.trim() === "" ? "" : `\n${result.output}`).not.toMatch(/\[\+\]|\[-\]|\[\*\]/);
    expect(result.status).toBe(0);
  }, 200_000);

  it("cases:stage runs and every LineUpdate it writes carries a kind", async (ctx) => {
    const pilot = await prismaUnscoped.shop.findFirst({ where: { name: PILOT_SHOP } });
    if (!pilot) {
      console.warn(`[migrations] "${PILOT_SHOP}" not seeded — cases:stage check skipped`);
      ctx.skip();
      return;
    }
    execFileSync("npx", ["tsx", "scripts/stage-cases.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
      timeout: 180_000,
    });
    const state = JSON.parse(
      await readFile(path.join(process.cwd(), ".data", "staged-cases.json"), "utf8"),
    ) as { cases: string[] };
    expect(state.cases.length).toBeGreaterThan(0);

    const updates = await prismaUnscoped.lineUpdate.findMany({
      where: { shopId: pilot.id, caseId: { in: state.cases } },
    });
    // The staging script writes the sent-Offer cases' Updates directly.
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update.kind).toBe("QUOTATION");
      expect(update.quotationId).not.toBeNull();
      expect(update.deliveryStatus).toBe("SENT");
    }
  }, 200_000);
});
