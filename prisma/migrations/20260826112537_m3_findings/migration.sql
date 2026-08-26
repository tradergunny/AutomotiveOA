-- CreateEnum
CREATE TYPE "FindingSource" AS ENUM ('DAMAGE_MAP', 'CHECKLIST');

-- CreateEnum
CREATE TYPE "DamageType" AS ENUM ('SCRATCH', 'DENT', 'CRACK', 'BROKEN');

-- CreateEnum
CREATE TYPE "FindingCondition" AS ENUM ('DUE_SOON', 'NEEDS_WORK');

-- CreateEnum
CREATE TYPE "ProposedAction" AS ENUM ('REPAIR', 'REPAINT', 'REPLACE', 'SERVICE');

-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "finding_id" TEXT;

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "source" "FindingSource" NOT NULL,
    "zone" TEXT,
    "checklist_item" TEXT,
    "damage_types" "DamageType"[],
    "condition" "FindingCondition",
    "proposed_actions" "ProposedAction"[],
    "note" TEXT,
    "recorded_by_staff_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "findings_shop_id_case_id_idx" ON "findings"("shop_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "findings_shop_id_case_id_checklist_item_key" ON "findings"("shop_id", "case_id", "checklist_item");

-- CreateIndex
CREATE UNIQUE INDEX "findings_shop_id_id_key" ON "findings"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "findings_shop_id_case_id_id_key" ON "findings"("shop_id", "case_id", "id");

-- CreateIndex
CREATE INDEX "photos_shop_id_finding_id_idx" ON "photos"("shop_id", "finding_id");

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_shop_id_case_id_fkey" FOREIGN KEY ("shop_id", "case_id") REFERENCES "repair_cases"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_shop_id_recorded_by_staff_id_fkey" FOREIGN KEY ("shop_id", "recorded_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_shop_id_case_id_finding_id_fkey" FOREIGN KEY ("shop_id", "case_id", "finding_id") REFERENCES "findings"("shop_id", "case_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
