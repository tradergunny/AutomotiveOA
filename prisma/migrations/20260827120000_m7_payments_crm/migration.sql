-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'SNOOZED', 'CONTACTED', 'DROPPED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CaseEventType" ADD VALUE 'PAYMENT_RECORDED';
ALTER TYPE "CaseEventType" ADD VALUE 'PAYMENT_VOIDED';
ALTER TYPE "CaseEventType" ADD VALUE 'FOLLOW_UP_CONTACTED';
ALTER TYPE "CaseEventType" ADD VALUE 'FOLLOW_UP_SNOOZED';
ALTER TYPE "CaseEventType" ADD VALUE 'FOLLOW_UP_DROPPED';
ALTER TYPE "CaseEventType" ADD VALUE 'FOLLOW_UP_REOPENED';

-- AlterTable
ALTER TABLE "case_events" ADD COLUMN     "follow_up_id" TEXT,
ADD COLUMN     "payment_id" TEXT,
ADD COLUMN     "snoozed_until" DATE;

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "payer_type" "PayerType" NOT NULL,
    "customer_id" TEXT,
    "insurer_name" TEXT,
    "amount_satang" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "received_at" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "recorded_by_staff_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by_staff_id" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "job_id" TEXT,
    "finding_id" TEXT,
    "job_title" TEXT,
    "quoted_price_satang" INTEGER,
    "checklist_item" TEXT,
    "condition" "FindingCondition",
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "snoozed_until" DATE,
    "last_action_by_staff_id" TEXT,
    "last_action_at" TIMESTAMP(3),
    "last_action_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_shop_id_case_id_idx" ON "payments"("shop_id", "case_id");

-- CreateIndex
CREATE INDEX "payments_shop_id_customer_id_idx" ON "payments"("shop_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_shop_id_id_key" ON "payments"("shop_id", "id");

-- CreateIndex
CREATE INDEX "follow_ups_shop_id_status_idx" ON "follow_ups"("shop_id", "status");

-- CreateIndex
CREATE INDEX "follow_ups_shop_id_customer_id_idx" ON "follow_ups"("shop_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "follow_ups_shop_id_job_id_key" ON "follow_ups"("shop_id", "job_id");

-- CreateIndex
CREATE UNIQUE INDEX "follow_ups_shop_id_finding_id_key" ON "follow_ups"("shop_id", "finding_id");

-- CreateIndex
CREATE UNIQUE INDEX "follow_ups_shop_id_id_key" ON "follow_ups"("shop_id", "id");

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_shop_id_payment_id_fkey" FOREIGN KEY ("shop_id", "payment_id") REFERENCES "payments"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_shop_id_follow_up_id_fkey" FOREIGN KEY ("shop_id", "follow_up_id") REFERENCES "follow_ups"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shop_id_case_id_fkey" FOREIGN KEY ("shop_id", "case_id") REFERENCES "repair_cases"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shop_id_customer_id_fkey" FOREIGN KEY ("shop_id", "customer_id") REFERENCES "customers"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shop_id_recorded_by_staff_id_fkey" FOREIGN KEY ("shop_id", "recorded_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shop_id_voided_by_staff_id_fkey" FOREIGN KEY ("shop_id", "voided_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_shop_id_case_id_fkey" FOREIGN KEY ("shop_id", "case_id") REFERENCES "repair_cases"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_shop_id_customer_id_fkey" FOREIGN KEY ("shop_id", "customer_id") REFERENCES "customers"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_shop_id_case_id_job_id_fkey" FOREIGN KEY ("shop_id", "case_id", "job_id") REFERENCES "jobs"("shop_id", "case_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_shop_id_case_id_finding_id_fkey" FOREIGN KEY ("shop_id", "case_id", "finding_id") REFERENCES "findings"("shop_id", "case_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_shop_id_last_action_by_staff_id_fkey" FOREIGN KEY ("shop_id", "last_action_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
