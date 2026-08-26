-- CreateEnum
CREATE TYPE "WaitingReason" AS ENUM ('PARTS', 'PAINT_BOOTH', 'TECHNICIAN', 'OTHER');

-- CreateEnum
CREATE TYPE "CaseEventType" AS ENUM ('JOB_CREATED', 'JOB_DELETED', 'JOB_AUTHORIZATION_RECORDED', 'JOB_STATUS_CHANGED', 'JOB_WAITING_REASON_CHANGED', 'JOB_QC_PASSED', 'JOB_QC_FAILED', 'JOB_CANCELLED', 'JOB_REVERTED', 'JOB_ASSIGNED', 'JOB_PRICE_OVERRIDDEN', 'QUOTATION_ISSUED', 'CASE_READY', 'CASE_READY_REVOKED', 'CASE_DELIVERED');

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "waiting_reason" "WaitingReason";

-- AlterTable
ALTER TABLE "repair_cases" ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "delivered_by_staff_id" TEXT,
ADD COLUMN     "ready_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "case_events" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "type" "CaseEventType" NOT NULL,
    "job_id" TEXT,
    "job_title" TEXT,
    "from_status" "JobStatus",
    "to_status" "JobStatus",
    "waiting_reason" "WaitingReason",
    "price_satang" INTEGER,
    "quotation_id" TEXT,
    "subject_staff_id" TEXT,
    "note" TEXT,
    "actor_staff_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "case_events_shop_id_case_id_occurred_at_idx" ON "case_events"("shop_id", "case_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_shop_id_delivered_by_staff_id_fkey" FOREIGN KEY ("shop_id", "delivered_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_shop_id_case_id_fkey" FOREIGN KEY ("shop_id", "case_id") REFERENCES "repair_cases"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_shop_id_quotation_id_fkey" FOREIGN KEY ("shop_id", "quotation_id") REFERENCES "quotations"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_shop_id_subject_staff_id_fkey" FOREIGN KEY ("shop_id", "subject_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_shop_id_actor_staff_id_fkey" FOREIGN KEY ("shop_id", "actor_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
