import bcrypt from "bcryptjs";
import { prismaUnscoped } from "../lib/db";
import type { BodyType } from "../lib/generated/prisma/enums";

// Pilot shop seed (M1 brief §8): Somchai Garage + a Manager and an Advisor,
// so login is testable on a fresh clone. M2 (brief §8) adds sample Customers
// and Vehicles so phone/plate lookups are testable too — but NO seeded
// Repair Cases: performing a check-in is the M2 gate. Idempotent — safe to
// re-run. DEV CREDENTIALS ONLY — real onboarding replaces this in M8.

const SHOP_NAME = "Somchai Garage";

type SeedVehicle = {
  plate: string;
  province: string;
  bodyType: BodyType;
  make: string;
  model: string;
  color: string;
};

type SeedCustomer = {
  name: string;
  /** Normalized digits (lib/normalize.ts convention). */
  phone: string;
  company?: string;
  vehicles: SeedVehicle[];
};

const CUSTOMERS: SeedCustomer[] = [
  {
    name: "ประยุทธ์ สุขใจ",
    phone: "0819876543",
    vehicles: [
      {
        plate: "ขข1234",
        province: "กรุงเทพมหานคร",
        bodyType: "SEDAN",
        make: "Honda",
        model: "Civic",
        color: "ขาว",
      },
    ],
  },
  {
    name: "มาลี วงศ์สวัสดิ์",
    phone: "0865551234",
    company: "ABC Logistics",
    vehicles: [
      {
        plate: "ผก4455",
        province: "นนทบุรี",
        bodyType: "PICKUP",
        make: "Toyota",
        model: "Hilux Revo",
        color: "ดำ",
      },
    ],
  },
  {
    name: "วิชัย พานทอง",
    phone: "021234567", // landline — 9-digit form is legal
    vehicles: [
      {
        plate: "งจ7788",
        province: "กรุงเทพมหานคร",
        bodyType: "SEDAN",
        make: "Mazda",
        model: "2",
        color: "แดง",
      },
      {
        plate: "ตค9012",
        province: "สมุทรปราการ",
        bodyType: "PICKUP",
        make: "Isuzu",
        model: "D-Max",
        color: "เทา",
      },
    ],
  },
  {
    // No car yet: exercises the customers-without-vehicles list state.
    name: "อรพรรณ ศรีสุข",
    phone: "0894442211",
    vehicles: [],
  },
];

const USERS = [
  {
    email: "somchai@somchaigarage.dev",
    password: "manager123",
    name: "สมชาย ใจดี",
    position: "ผู้จัดการอู่",
    role: "MANAGER" as const,
  },
  {
    email: "ann@somchaigarage.dev",
    password: "advisor123",
    name: "คุณแอน",
    position: "ที่ปรึกษาบริการ",
    role: "ADVISOR" as const,
  },
];

async function main() {
  const shop =
    (await prismaUnscoped.shop.findFirst({ where: { name: SHOP_NAME } })) ??
    (await prismaUnscoped.shop.create({ data: { name: SHOP_NAME } }));
  console.log(`shop: ${shop.name} (${shop.id})`);

  for (const spec of USERS) {
    const existing = await prismaUnscoped.user.findUnique({
      where: { email: spec.email },
    });
    if (existing) {
      console.log(`user exists: ${spec.email}`);
      continue;
    }
    const staff = await prismaUnscoped.staff.create({
      data: { shopId: shop.id, name: spec.name, position: spec.position },
    });
    await prismaUnscoped.user.create({
      data: {
        shopId: shop.id,
        staffId: staff.id,
        email: spec.email,
        passwordHash: await bcrypt.hash(spec.password, 10),
        role: spec.role,
      },
    });
    console.log(`user created: ${spec.email} (${spec.role})`);
  }

  for (const spec of CUSTOMERS) {
    const customer = await prismaUnscoped.customer.upsert({
      where: { shopId_phone: { shopId: shop.id, phone: spec.phone } },
      update: {},
      create: {
        shopId: shop.id,
        name: spec.name,
        phone: spec.phone,
        company: spec.company ?? null,
      },
    });
    for (const vehicle of spec.vehicles) {
      await prismaUnscoped.vehicle.upsert({
        where: { shopId_plate: { shopId: shop.id, plate: vehicle.plate } },
        update: {},
        create: { shopId: shop.id, primaryCustomerId: customer.id, ...vehicle },
      });
    }
    console.log(`customer: ${spec.name} (${spec.vehicles.length} vehicles)`);
  }
}

main()
  .then(() => prismaUnscoped.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prismaUnscoped.$disconnect();
    process.exit(1);
  });
