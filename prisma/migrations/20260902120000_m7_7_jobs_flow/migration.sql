-- M7.7 (Jobs flow, D-24/D-25): the schema grows two columns and one event
-- type. Quotation.public_token is the unguessable document link, minted the
-- first time a version is sent (the published-photo idiom applied to the
-- document); LineUpdate.quotation_id records which Update carried which
-- Quotation, on a same-shop composite FK like every other cross-model link;
-- JOB_MERGED is a merge's own event, because a merge is not a deletion.


-- AlterEnum
ALTER TYPE "CaseEventType" ADD VALUE 'JOB_MERGED';

-- AlterTable
ALTER TABLE "line_updates" ADD COLUMN     "quotation_id" TEXT;

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "public_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "quotations_public_token_key" ON "quotations"("public_token");

-- AddForeignKey
ALTER TABLE "line_updates" ADD CONSTRAINT "line_updates_shop_id_quotation_id_fkey" FOREIGN KEY ("shop_id", "quotation_id") REFERENCES "quotations"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

