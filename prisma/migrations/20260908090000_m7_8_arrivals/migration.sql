-- M7.8 (Arrivals, ADR-006): the customer's own notice of a visit. One new
-- model — Arrival, a CANDIDATE that check-in consumes, never a record: no
-- Customer, Vehicle, or Repair Case is created by a submission. Its cross-
-- model links (vehicle, case, handling staff) are same-shop composite FKs
-- like every other. Shop.arrival_token is the rotatable public form key
-- (NULL = form not enabled; the seed leaves it null). ShopLineChannel gains
-- the LINE door's two plain values: the LIFF app id and the LINE Login
-- channel id whose ID tokens the server verifies — neither is a secret.

-- CreateEnum
CREATE TYPE "ArrivalStatus" AS ENUM ('WAITING', 'CHECKED_IN', 'DISMISSED');

-- AlterTable
ALTER TABLE "shop_line_channels" ADD COLUMN     "liff_id" TEXT,
ADD COLUMN     "login_channel_id" TEXT;

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "arrival_token" TEXT,
ADD COLUMN     "arrival_token_rotated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "arrivals" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "status" "ArrivalStatus" NOT NULL DEFAULT 'WAITING',
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "body_type" "BodyType",
    "note" TEXT NOT NULL,
    "odometer_km" INTEGER,
    "locale" "Locale" NOT NULL,
    "vehicle_id" TEXT,
    "line_user_id" TEXT,
    "line_display_name" TEXT,
    "line_picture_url" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "case_id" TEXT,
    "handled_by_staff_id" TEXT,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arrivals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "arrivals_shop_id_status_submitted_at_idx" ON "arrivals"("shop_id", "status", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "arrivals_shop_id_id_key" ON "arrivals"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "arrivals_shop_id_case_id_key" ON "arrivals"("shop_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "shops_arrival_token_key" ON "shops"("arrival_token");

-- AddForeignKey
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_shop_id_vehicle_id_fkey" FOREIGN KEY ("shop_id", "vehicle_id") REFERENCES "vehicles"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_shop_id_case_id_fkey" FOREIGN KEY ("shop_id", "case_id") REFERENCES "repair_cases"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_shop_id_handled_by_staff_id_fkey" FOREIGN KEY ("shop_id", "handled_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

