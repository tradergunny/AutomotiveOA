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
});

afterAll(async () => {
  const shopIds = [shopA.id, shopB.id];
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
    const created = await forShop(shopA.id).staff.create({
      data: { name: `${run} created-in-A` },
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
});
