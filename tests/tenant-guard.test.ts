import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prismaUnscoped } from "@/lib/db";
import { forShop, TenantGuardError } from "@/lib/tenant";

/**
 * ADR-001 proof: cross-tenant reads and writes fail at the data-access layer.
 * Two shops (A, B) are created directly with the unscoped client; everything
 * else goes through forShop() and must stay inside its own shop.
 */

const run = `tg-${Date.now()}`;

let shopA: { id: string };
let shopB: { id: string };
let staffA: { id: string };
let staffB: { id: string };
let customerA: { id: string };
let customerB: { id: string };
let vehicleA: { id: string };
let vehicleB: { id: string };
let caseA: { id: string };
let caseB: { id: string };

beforeAll(async () => {
  shopA = await prismaUnscoped.shop.create({ data: { name: `${run} Shop A` } });
  shopB = await prismaUnscoped.shop.create({ data: { name: `${run} Shop B` } });
  staffA = await prismaUnscoped.staff.create({
    data: { shopId: shopA.id, name: `${run} Staff A`, position: "advisor" },
  });
  staffB = await prismaUnscoped.staff.create({
    data: { shopId: shopB.id, name: `${run} Staff B`, position: "advisor" },
  });
  await prismaUnscoped.user.create({
    data: {
      shopId: shopA.id,
      staffId: staffA.id,
      email: `${run}-a@test.local`,
      passwordHash: "x",
      role: "ADVISOR",
    },
  });
  await prismaUnscoped.user.create({
    data: {
      shopId: shopB.id,
      staffId: staffB.id,
      email: `${run}-b@test.local`,
      passwordHash: "x",
      role: "MANAGER",
    },
  });
  // M2 domain rows. Identity keys are per-Shop: the SAME phone and the SAME
  // plate exist in both shops on purpose (competing garages share customers).
  customerA = await prismaUnscoped.customer.create({
    data: { shopId: shopA.id, name: `${run} Customer A`, phone: "0810000001" },
  });
  customerB = await prismaUnscoped.customer.create({
    data: { shopId: shopB.id, name: `${run} Customer B`, phone: "0810000001" },
  });
  vehicleA = await prismaUnscoped.vehicle.create({
    data: {
      shopId: shopA.id,
      plate: `${run}ก1`,
      bodyType: "SEDAN",
      primaryCustomerId: customerA.id,
    },
  });
  vehicleB = await prismaUnscoped.vehicle.create({
    data: {
      shopId: shopB.id,
      plate: `${run}ก1`,
      bodyType: "PICKUP",
      primaryCustomerId: customerB.id,
    },
  });
  caseA = await prismaUnscoped.repairCase.create({
    data: {
      shopId: shopA.id,
      reference: `${run}-RC-A`,
      vehicleId: vehicleA.id,
      contactCustomerId: customerA.id,
      openedByStaffId: staffA.id,
    },
  });
  caseB = await prismaUnscoped.repairCase.create({
    data: {
      shopId: shopB.id,
      reference: `${run}-RC-B`,
      vehicleId: vehicleB.id,
      contactCustomerId: customerB.id,
      openedByStaffId: staffB.id,
    },
  });
  await prismaUnscoped.photo.create({
    data: {
      shopId: shopA.id,
      caseId: caseA.id,
      storageKey: `${run}/photo-a`,
      contentType: "image/jpeg",
      sizeBytes: 1,
      uploadedByStaffId: staffA.id,
    },
  });
});

afterAll(async () => {
  const shopIds = [shopA.id, shopB.id];
  await prismaUnscoped.photo.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.repairCase.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.vehicle.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.customer.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.user.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.staff.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.shop.deleteMany({ where: { id: { in: shopIds } } });
  await prismaUnscoped.$disconnect();
});

describe("cross-tenant reads fail", () => {
  it("findMany only returns the scoped shop's rows", async () => {
    const staff = await forShop(shopA.id).staff.findMany({
      where: { name: { startsWith: run } },
    });
    expect(staff.map((s) => s.id)).toEqual([staffA.id]);
  });

  it("findUnique on another shop's row returns null", async () => {
    const row = await forShop(shopA.id).staff.findUnique({ where: { id: staffB.id } });
    expect(row).toBeNull();
  });

  it("findUniqueOrThrow on another shop's row throws", async () => {
    await expect(
      forShop(shopA.id).staff.findUniqueOrThrow({ where: { id: staffB.id } }),
    ).rejects.toThrow(TenantGuardError);
  });

  it("findFirst explicitly targeting another shop's id returns null", async () => {
    const row = await forShop(shopA.id).staff.findFirst({ where: { id: staffB.id } });
    expect(row).toBeNull();
  });

  it("count is scoped", async () => {
    const count = await forShop(shopA.id).staff.count({
      where: { name: { startsWith: run } },
    });
    expect(count).toBe(1);
  });

  it("users are scoped too", async () => {
    const users = await forShop(shopB.id).user.findMany({
      where: { email: { startsWith: run } },
    });
    expect(users.map((u) => u.shopId)).toEqual([shopB.id]);
  });
});

describe("cross-tenant writes fail", () => {
  it("update of another shop's row throws and changes nothing", async () => {
    await expect(
      forShop(shopA.id).staff.update({
        where: { id: staffB.id },
        data: { name: "hijacked" },
      }),
    ).rejects.toThrow(TenantGuardError);
    const untouched = await prismaUnscoped.staff.findUnique({ where: { id: staffB.id } });
    expect(untouched?.name).toBe(`${run} Staff B`);
  });

  it("delete of another shop's row throws and deletes nothing", async () => {
    await expect(
      forShop(shopA.id).staff.delete({ where: { id: staffB.id } }),
    ).rejects.toThrow(TenantGuardError);
    expect(
      await prismaUnscoped.staff.findUnique({ where: { id: staffB.id } }),
    ).not.toBeNull();
  });

  it("updateMany cannot reach across shops", async () => {
    await forShop(shopA.id).staff.updateMany({
      where: { name: { startsWith: run } },
      data: { position: "touched-by-A" },
    });
    const b = await prismaUnscoped.staff.findUnique({ where: { id: staffB.id } });
    expect(b?.position).toBe("advisor");
    const a = await prismaUnscoped.staff.findUnique({ where: { id: staffA.id } });
    expect(a?.position).toBe("touched-by-A");
  });

  it("create naming a foreign shopId throws", async () => {
    await expect(
      forShop(shopA.id).staff.create({
        data: { shopId: shopB.id, name: `${run} smuggled` },
      }),
    ).rejects.toThrow(TenantGuardError);
  });

  it("create without shopId lands in the scoped shop", async () => {
    // Prisma's input types require the shop; the guard fills it at runtime,
    // so this exercises the code path a type-unsafe caller would hit.
    const created = await forShop(shopA.id).staff.create({
      data: { name: `${run} created-in-A` } as never,
    });
    expect(created.shopId).toBe(shopA.id);
    await prismaUnscoped.staff.delete({ where: { id: created.id } });
  });

  it("shopId is immutable through update", async () => {
    await expect(
      forShop(shopA.id).staff.update({
        where: { id: staffA.id },
        data: { shopId: shopB.id },
      }),
    ).rejects.toThrow(TenantGuardError);
  });
});

describe("the Shop model itself is scoped", () => {
  it("findMany sees only the own shop", async () => {
    const shops = await forShop(shopA.id).shop.findMany({
      where: { name: { startsWith: run } },
    });
    expect(shops.map((s) => s.id)).toEqual([shopA.id]);
  });

  it("findUnique of another shop returns null", async () => {
    expect(
      await forShop(shopA.id).shop.findUnique({ where: { id: shopB.id } }),
    ).toBeNull();
  });

  it("a tenant client cannot create or delete shops", async () => {
    await expect(
      forShop(shopA.id).shop.create({ data: { name: `${run} rogue` } }),
    ).rejects.toThrow(TenantGuardError);
    await expect(
      forShop(shopA.id).shop.delete({ where: { id: shopB.id } }),
    ).rejects.toThrow(TenantGuardError);
  });

  it("updating another shop throws", async () => {
    await expect(
      forShop(shopA.id).shop.update({
        where: { id: shopB.id },
        data: { name: "hijacked" },
      }),
    ).rejects.toThrow(TenantGuardError);
  });
});

describe("database-level defense in depth", () => {
  it("the composite FK rejects a User pointing at another shop's Staff", async () => {
    await expect(
      prismaUnscoped.user.create({
        data: {
          shopId: shopA.id,
          staffId: staffB.id, // B's staff under A's shop — must be impossible
          email: `${run}-evil@test.local`,
          passwordHash: "x",
          role: "ADVISOR",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a Vehicle whose primary Customer is in another shop", async () => {
    await expect(
      prismaUnscoped.vehicle.create({
        data: {
          shopId: shopA.id,
          plate: `${run}ข9`,
          bodyType: "SEDAN",
          primaryCustomerId: customerB.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a RepairCase whose vehicle or contact is in another shop", async () => {
    await expect(
      prismaUnscoped.repairCase.create({
        data: {
          shopId: shopA.id,
          reference: `${run}-RC-EVIL`,
          vehicleId: vehicleB.id, // B's car on A's case
          contactCustomerId: customerA.id,
          openedByStaffId: staffA.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prismaUnscoped.repairCase.create({
        data: {
          shopId: shopA.id,
          reference: `${run}-RC-EVIL2`,
          vehicleId: vehicleA.id,
          contactCustomerId: customerB.id, // B's customer as A's contact
          openedByStaffId: staffA.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a Photo attached to another shop's case", async () => {
    await expect(
      prismaUnscoped.photo.create({
        data: {
          shopId: shopA.id,
          caseId: caseB.id, // B's case under A's shop
          storageKey: `${run}/photo-evil`,
          contentType: "image/jpeg",
          sizeBytes: 1,
          uploadedByStaffId: staffA.id,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("M2 models are scoped (Customer, Vehicle, RepairCase, Photo)", () => {
  it("customers: findMany stays inside the shop; the same phone exists per shop", async () => {
    const scoped = await forShop(shopA.id).customer.findMany({
      where: { phone: "0810000001", name: { startsWith: run } },
    });
    expect(scoped.map((c) => c.id)).toEqual([customerA.id]);
    // Identity is per-Shop: both shops legitimately hold this phone.
    const everywhere = await prismaUnscoped.customer.count({
      where: { phone: "0810000001", name: { startsWith: run } },
    });
    expect(everywhere).toBe(2);
  });

  it("vehicles: plate lookup cannot see another shop's identical plate", async () => {
    const scoped = await forShop(shopA.id).vehicle.findMany({
      where: { plate: `${run}ก1` },
    });
    expect(scoped.map((v) => v.id)).toEqual([vehicleA.id]);
  });

  it("vehicles: findUnique on another shop's row returns null", async () => {
    expect(
      await forShop(shopA.id).vehicle.findUnique({ where: { id: vehicleB.id } }),
    ).toBeNull();
  });

  it("repair cases: scoped findMany and cross-shop findUniqueOrThrow", async () => {
    const scoped = await forShop(shopA.id).repairCase.findMany({
      where: { reference: { startsWith: run } },
    });
    expect(scoped.map((c) => c.id)).toEqual([caseA.id]);
    await expect(
      forShop(shopA.id).repairCase.findUniqueOrThrow({ where: { id: caseB.id } }),
    ).rejects.toThrow(TenantGuardError);
  });

  it("photos: scoped findMany", async () => {
    const scoped = await forShop(shopB.id).photo.findMany({
      where: { storageKey: { startsWith: run } },
    });
    expect(scoped).toEqual([]);
  });

  it("customer create lands in the scoped shop", async () => {
    const created = await forShop(shopA.id).customer.create({
      data: { name: `${run} created-customer`, phone: "0810000099" } as never,
    });
    expect(created.shopId).toBe(shopA.id);
    await prismaUnscoped.customer.delete({ where: { id: created.id } });
  });

  it("vehicle create naming a foreign shopId throws", async () => {
    await expect(
      forShop(shopA.id).vehicle.create({
        data: {
          shopId: shopB.id,
          plate: `${run}ค7`,
          bodyType: "PICKUP",
          primaryCustomerId: customerB.id,
        },
      }),
    ).rejects.toThrow(TenantGuardError);
  });

  it("cross-shop customer update throws and changes nothing", async () => {
    await expect(
      forShop(shopA.id).customer.update({
        where: { id: customerB.id },
        data: { name: "hijacked" },
      }),
    ).rejects.toThrow(TenantGuardError);
    const untouched = await prismaUnscoped.customer.findUnique({
      where: { id: customerB.id },
    });
    expect(untouched?.name).toBe(`${run} Customer B`);
  });
});
