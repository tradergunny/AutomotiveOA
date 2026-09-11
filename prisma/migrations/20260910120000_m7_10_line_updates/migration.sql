-- M7.10 (LINE Updates, ADR-007): every Update carries its kind, and a send the
-- Shop could not make at all is recorded as a NOT_SENT row. `kind` is added
-- nullable, backfilled — an Update that carried a Quotation was Send quotation
-- (M7.7), every other existing row was the composer — and then made required.
-- `line_user_id` becomes nullable: a NOT_SENT row blocked by noIdentity has
-- no userId to snapshot. `job_id` names the Job of a JOB_COMPLETED notice,
-- pinned to the Update's own shop AND case like photos.job_id.

-- CreateEnum
CREATE TYPE "LineUpdateKind" AS ENUM ('CHECKIN', 'QUOTATION', 'WORK_STARTED', 'WAITING_PARTS', 'PARTS_ARRIVED', 'JOB_COMPLETED', 'IN_QC', 'READY', 'DELIVERED', 'CATCH_UP', 'FREEFORM');

-- AlterEnum
ALTER TYPE "LineDeliveryStatus" ADD VALUE 'NOT_SENT';

-- AlterTable: kind, backfilled from what each row carried
ALTER TABLE "line_updates" ADD COLUMN "kind" "LineUpdateKind";
UPDATE "line_updates"
SET "kind" = CASE
  WHEN "quotation_id" IS NOT NULL THEN 'QUOTATION'::"LineUpdateKind"
  ELSE 'FREEFORM'::"LineUpdateKind"
END;
ALTER TABLE "line_updates" ALTER COLUMN "kind" SET NOT NULL;

-- AlterTable
ALTER TABLE "line_updates" ALTER COLUMN "line_user_id" DROP NOT NULL,
ADD COLUMN     "job_id" TEXT;

-- AddForeignKey
ALTER TABLE "line_updates" ADD CONSTRAINT "line_updates_shop_id_case_id_job_id_fkey" FOREIGN KEY ("shop_id", "case_id", "job_id") REFERENCES "jobs"("shop_id", "case_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
