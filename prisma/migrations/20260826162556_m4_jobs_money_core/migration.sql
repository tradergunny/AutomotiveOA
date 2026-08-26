-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PROPOSED', 'AUTHORIZED', 'WAITING', 'IN_PROGRESS', 'QC', 'COMPLETED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayerType" AS ENUM ('CUSTOMER', 'INSURER');

-- CreateEnum
CREATE TYPE "AuthorizationDecision" AS ENUM ('AUTHORIZED', 'DECLINED', 'REVERTED');

-- CreateEnum
CREATE TYPE "AuthorizationChannel" AS ENUM ('LINE', 'PHONE', 'IN_PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "PartOrderStatus" AS ENUM ('NOT_ORDERED', 'ORDERED', 'ARRIVED');

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "job_id" TEXT;

-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "job_id" TEXT;

-- CreateTable
CREATE TABLE "service_catalog_items" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_satang" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PROPOSED',
    "payer_type" "PayerType" NOT NULL,
    "insurer_name" TEXT,
    "catalog_item_id" TEXT,
    "price_satang" INTEGER,
    "price_overridden_by_staff_id" TEXT,
    "assigned_staff_id" TEXT,
    "note" TEXT,
    "created_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_authorizations" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "decision" "AuthorizationDecision" NOT NULL,
    "channel" "AuthorizationChannel",
    "quotation_id" TEXT,
    "note" TEXT,
    "recorded_by_staff_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_lines" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_cost_satang" INTEGER,
    "supplier" TEXT,
    "order_status" "PartOrderStatus" NOT NULL DEFAULT 'NOT_ORDERED',
    "eta_date" DATE,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "part_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "total_satang" INTEGER NOT NULL,
    "issued_by_staff_id" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_lines" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "job_id" TEXT,
    "title" TEXT NOT NULL,
    "price_satang" INTEGER NOT NULL,
    "payer_type" "PayerType" NOT NULL,
    "insurer_name" TEXT,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "quotation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_catalog_items_shop_id_active_idx" ON "service_catalog_items"("shop_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "service_catalog_items_shop_id_id_key" ON "service_catalog_items"("shop_id", "id");

-- CreateIndex
CREATE INDEX "jobs_shop_id_case_id_idx" ON "jobs"("shop_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_shop_id_id_key" ON "jobs"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_shop_id_case_id_id_key" ON "jobs"("shop_id", "case_id", "id");

-- CreateIndex
CREATE INDEX "job_authorizations_shop_id_job_id_idx" ON "job_authorizations"("shop_id", "job_id");

-- CreateIndex
CREATE INDEX "part_lines_shop_id_job_id_idx" ON "part_lines"("shop_id", "job_id");

-- CreateIndex
CREATE INDEX "quotations_shop_id_case_id_idx" ON "quotations"("shop_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_shop_id_case_id_version_key" ON "quotations"("shop_id", "case_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_shop_id_id_key" ON "quotations"("shop_id", "id");

-- CreateIndex
CREATE INDEX "quotation_lines_shop_id_quotation_id_idx" ON "quotation_lines"("shop_id", "quotation_id");

-- CreateIndex
CREATE INDEX "findings_shop_id_job_id_idx" ON "findings"("shop_id", "job_id");

-- CreateIndex
CREATE INDEX "photos_shop_id_job_id_idx" ON "photos"("shop_id", "job_id");

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_shop_id_case_id_job_id_fkey" FOREIGN KEY ("shop_id", "case_id", "job_id") REFERENCES "jobs"("shop_id", "case_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_shop_id_case_id_job_id_fkey" FOREIGN KEY ("shop_id", "case_id", "job_id") REFERENCES "jobs"("shop_id", "case_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_catalog_items" ADD CONSTRAINT "service_catalog_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_shop_id_case_id_fkey" FOREIGN KEY ("shop_id", "case_id") REFERENCES "repair_cases"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_shop_id_catalog_item_id_fkey" FOREIGN KEY ("shop_id", "catalog_item_id") REFERENCES "service_catalog_items"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_shop_id_price_overridden_by_staff_id_fkey" FOREIGN KEY ("shop_id", "price_overridden_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_shop_id_assigned_staff_id_fkey" FOREIGN KEY ("shop_id", "assigned_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_shop_id_created_by_staff_id_fkey" FOREIGN KEY ("shop_id", "created_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_authorizations" ADD CONSTRAINT "job_authorizations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_authorizations" ADD CONSTRAINT "job_authorizations_shop_id_job_id_fkey" FOREIGN KEY ("shop_id", "job_id") REFERENCES "jobs"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_authorizations" ADD CONSTRAINT "job_authorizations_shop_id_quotation_id_fkey" FOREIGN KEY ("shop_id", "quotation_id") REFERENCES "quotations"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_authorizations" ADD CONSTRAINT "job_authorizations_shop_id_recorded_by_staff_id_fkey" FOREIGN KEY ("shop_id", "recorded_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_lines" ADD CONSTRAINT "part_lines_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_lines" ADD CONSTRAINT "part_lines_shop_id_job_id_fkey" FOREIGN KEY ("shop_id", "job_id") REFERENCES "jobs"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_shop_id_case_id_fkey" FOREIGN KEY ("shop_id", "case_id") REFERENCES "repair_cases"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_shop_id_issued_by_staff_id_fkey" FOREIGN KEY ("shop_id", "issued_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_shop_id_quotation_id_fkey" FOREIGN KEY ("shop_id", "quotation_id") REFERENCES "quotations"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
