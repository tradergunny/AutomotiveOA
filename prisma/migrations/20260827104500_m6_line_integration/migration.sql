-- CreateEnum
CREATE TYPE "LineFollowState" AS ENUM ('FOLLOWING', 'UNFOLLOWED');

-- CreateEnum
CREATE TYPE "LineDeliveryStatus" AS ENUM ('SENT', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CaseEventType" ADD VALUE 'LINE_UPDATE_SENT';
ALTER TYPE "CaseEventType" ADD VALUE 'LINE_UPDATE_FAILED';
ALTER TYPE "CaseEventType" ADD VALUE 'LINE_CUSTOMER_LINKED';
ALTER TYPE "CaseEventType" ADD VALUE 'LINE_CUSTOMER_UNLINKED';

-- AlterTable
ALTER TABLE "case_events" ADD COLUMN     "line_update_id" TEXT,
ADD COLUMN     "subject_name" TEXT;

-- CreateTable
CREATE TABLE "shop_line_channels" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "channel_secret_enc" TEXT NOT NULL,
    "channel_access_token_enc" TEXT NOT NULL,
    "bot_user_id" TEXT,
    "bot_basic_id" TEXT,
    "bot_display_name" TEXT,
    "bot_picture_url" TEXT,
    "verified_at" TIMESTAMP(3),
    "connected_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_line_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_contacts" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "picture_url" TEXT,
    "follow_state" "LineFollowState" NOT NULL DEFAULT 'FOLLOWING',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_event_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_id" TEXT,
    "linked_by_staff_id" TEXT,
    "linked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_updates" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "delivery_status" "LineDeliveryStatus" NOT NULL,
    "line_request_id" TEXT,
    "error_code" TEXT,
    "error_detail" TEXT,
    "sent_by_staff_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_update_photos" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "line_update_id" TEXT NOT NULL,
    "photo_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "public_token" TEXT,

    CONSTRAINT "line_update_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_line_channels_shop_id_key" ON "shop_line_channels"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_line_channels_shop_id_id_key" ON "shop_line_channels"("shop_id", "id");

-- CreateIndex
CREATE INDEX "line_contacts_shop_id_follow_state_idx" ON "line_contacts"("shop_id", "follow_state");

-- CreateIndex
CREATE UNIQUE INDEX "line_contacts_shop_id_line_user_id_key" ON "line_contacts"("shop_id", "line_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "line_contacts_shop_id_customer_id_key" ON "line_contacts"("shop_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "line_contacts_shop_id_id_key" ON "line_contacts"("shop_id", "id");

-- CreateIndex
CREATE INDEX "line_updates_shop_id_case_id_sent_at_idx" ON "line_updates"("shop_id", "case_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "line_updates_shop_id_id_key" ON "line_updates"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "line_update_photos_public_token_key" ON "line_update_photos"("public_token");

-- CreateIndex
CREATE INDEX "line_update_photos_shop_id_line_update_id_idx" ON "line_update_photos"("shop_id", "line_update_id");

-- CreateIndex
CREATE UNIQUE INDEX "photos_shop_id_id_key" ON "photos"("shop_id", "id");

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_line_update_id_fkey" FOREIGN KEY ("line_update_id") REFERENCES "line_updates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_line_channels" ADD CONSTRAINT "shop_line_channels_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_line_channels" ADD CONSTRAINT "shop_line_channels_shop_id_connected_by_staff_id_fkey" FOREIGN KEY ("shop_id", "connected_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_contacts" ADD CONSTRAINT "line_contacts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_contacts" ADD CONSTRAINT "line_contacts_shop_id_customer_id_fkey" FOREIGN KEY ("shop_id", "customer_id") REFERENCES "customers"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_contacts" ADD CONSTRAINT "line_contacts_shop_id_linked_by_staff_id_fkey" FOREIGN KEY ("shop_id", "linked_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_updates" ADD CONSTRAINT "line_updates_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_updates" ADD CONSTRAINT "line_updates_shop_id_case_id_fkey" FOREIGN KEY ("shop_id", "case_id") REFERENCES "repair_cases"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_updates" ADD CONSTRAINT "line_updates_shop_id_customer_id_fkey" FOREIGN KEY ("shop_id", "customer_id") REFERENCES "customers"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_updates" ADD CONSTRAINT "line_updates_shop_id_sent_by_staff_id_fkey" FOREIGN KEY ("shop_id", "sent_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_update_photos" ADD CONSTRAINT "line_update_photos_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_update_photos" ADD CONSTRAINT "line_update_photos_shop_id_line_update_id_fkey" FOREIGN KEY ("shop_id", "line_update_id") REFERENCES "line_updates"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_update_photos" ADD CONSTRAINT "line_update_photos_shop_id_photo_id_fkey" FOREIGN KEY ("shop_id", "photo_id") REFERENCES "photos"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

