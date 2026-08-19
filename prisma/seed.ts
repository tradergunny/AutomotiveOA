import bcrypt from "bcryptjs";
import { prismaUnscoped } from "../lib/db";

// Pilot shop seed (M1 brief §8): Somchai Garage + a Manager and an Advisor,
// so login is testable on a fresh clone. Idempotent — safe to re-run.
// DEV CREDENTIALS ONLY — real onboarding replaces this in M8.

const SHOP_NAME = "Somchai Garage";

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
}

main()
  .then(() => prismaUnscoped.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prismaUnscoped.$disconnect();
    process.exit(1);
  });
