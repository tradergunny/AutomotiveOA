import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allocateCaseReference } from "@/lib/case-reference";
import { prismaUnscoped } from "@/lib/db";
import { forShop } from "@/lib/tenant";

const run = `cr-${Date.now()}`;

let shop: { id: string };

beforeAll(async () => {
  shop = await prismaUnscoped.shop.create({ data: { name: `${run} Shop` } });
});

afterAll(async () => {
  await prismaUnscoped.shop.delete({ where: { id: shop.id } });
  await prismaUnscoped.$disconnect();
});

describe("allocateCaseReference", () => {
  it("starts at RC-1001 and counts up per Shop", async () => {
    const db = forShop(shop.id);
    expect(await allocateCaseReference(db, shop.id)).toBe("RC-1001");
    expect(await allocateCaseReference(db, shop.id)).toBe("RC-1002");
  });

  it("parallel allocations never collide", async () => {
    const db = forShop(shop.id);
    const refs = await Promise.all(
      Array.from({ length: 8 }, () => allocateCaseReference(db, shop.id)),
    );
    expect(new Set(refs).size).toBe(8);
    const after = await prismaUnscoped.shop.findUniqueOrThrow({
      where: { id: shop.id },
      select: { caseSeq: true },
    });
    // 2 sequential + 8 parallel allocations from the 1000 start.
    expect(after.caseSeq).toBe(1010);
  });

  it("rolls back with the surrounding transaction — references stay gap-free", async () => {
    const db = forShop(shop.id);
    await expect(
      db.$transaction(async (tx) => {
        await allocateCaseReference(tx, shop.id);
        throw new Error("abort check-in");
      }),
    ).rejects.toThrow("abort check-in");
    expect(await allocateCaseReference(db, shop.id)).toBe("RC-1011");
  });
});
