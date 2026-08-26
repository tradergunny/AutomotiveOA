-- CreateEnum
CREATE TYPE "BodyType" AS ENUM ('SEDAN', 'PICKUP');

-- CreateEnum
CREATE TYPE "RepairCaseStatus" AS ENUM ('CHECKED_IN', 'READY', 'DELIVERED');

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "case_seq" INTEGER NOT NULL DEFAULT 1000;

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "company" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "province" TEXT,
    "vin" TEXT,
    "body_type" "BodyType" NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "color" TEXT,
    "primary_customer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_cases" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "RepairCaseStatus" NOT NULL DEFAULT 'CHECKED_IN',
    "vehicle_id" TEXT NOT NULL,
    "contact_customer_id" TEXT NOT NULL,
    "note" TEXT,
    "odometer_km" INTEGER,
    "checked_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_shop_id_phone_key" ON "customers"("shop_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_shop_id_id_key" ON "customers"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_shop_id_plate_key" ON "vehicles"("shop_id", "plate");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_shop_id_id_key" ON "vehicles"("shop_id", "id");

-- CreateIndex
CREATE INDEX "repair_cases_shop_id_status_idx" ON "repair_cases"("shop_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "repair_cases_shop_id_reference_key" ON "repair_cases"("shop_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "repair_cases_shop_id_id_key" ON "repair_cases"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "photos_storage_key_key" ON "photos"("storage_key");

-- CreateIndex
CREATE INDEX "photos_shop_id_case_id_idx" ON "photos"("shop_id", "case_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_shop_id_primary_customer_id_fkey" FOREIGN KEY ("shop_id", "primary_customer_id") REFERENCES "customers"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_shop_id_vehicle_id_fkey" FOREIGN KEY ("shop_id", "vehicle_id") REFERENCES "vehicles"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_shop_id_contact_customer_id_fkey" FOREIGN KEY ("shop_id", "contact_customer_id") REFERENCES "customers"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_cases" ADD CONSTRAINT "repair_cases_shop_id_opened_by_staff_id_fkey" FOREIGN KEY ("shop_id", "opened_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_shop_id_case_id_fkey" FOREIGN KEY ("shop_id", "case_id") REFERENCES "repair_cases"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_shop_id_uploaded_by_staff_id_fkey" FOREIGN KEY ("shop_id", "uploaded_by_staff_id") REFERENCES "staff"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
