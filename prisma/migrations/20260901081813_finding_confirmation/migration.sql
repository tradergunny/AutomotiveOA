-- Findings gain an explicit accept step: the advisor keys everything in, then
-- confirms, and only a confirmed Finding is offered for grouping into a Job.
-- NULL = still being captured.
-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "confirmed_at" TIMESTAMP(3);

-- Findings recorded before this gate existed were already treated as final by
-- every screen, so they carry forward as confirmed. Backfilling to recorded_at
-- (not now()) keeps the timestamp honest: nobody pressed accept on them.
UPDATE "findings" SET "confirmed_at" = "recorded_at" WHERE "confirmed_at" IS NULL;
