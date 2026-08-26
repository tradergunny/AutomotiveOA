import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prismaUnscoped } from "@/lib/db";
import { forShop, TenantGuardError } from "@/lib/tenant";

/**
 * ADR-001 proof: cross-tenant reads and writes fail at the data-access layer.
 * Two shops (A, B) are created directly with the unscoped client; everything
 * else goes through forShop() and must stay inside its own shop.
 */

const run = `tg-${Date.now()}`;
/** One LINE userId, deliberately shared by both shops — see the M6 block. */
const SHARED_LINE_USER_ID = "U0000000000000000000000000000f00d";

let shopA: { id: string };
let shopB: { id: string };
let staffA: { id: string };
let staffB: { id: string };
let customerA: { id: string };
let customerB: { id: string };
let vehicleA: { id: string };
let vehicleB: { id: string };
let caseA: { id: string };
let caseA2: { id: string };
let caseB: { id: string };
let findingA: { id: string };
let findingB: { id: string };
let catalogItemA: { id: string };
let catalogItemB: { id: string };
let jobA: { id: string };
let jobB: { id: string };
let quotationA: { id: string };
let caseEventA: { id: string };
let photoA: { id: string };
let lineContactA: { id: string };
let lineUpdateA: { id: string };

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
  // M3 domain rows: a second case in shop A (for the same-case photo pin
  // proof) and one Finding per shop.
  caseA2 = await prismaUnscoped.repairCase.create({
    data: {
      shopId: shopA.id,
      reference: `${run}-RC-A2`,
      vehicleId: vehicleA.id,
      contactCustomerId: customerA.id,
      openedByStaffId: staffA.id,
    },
  });
  findingA = await prismaUnscoped.finding.create({
    data: {
      shopId: shopA.id,
      caseId: caseA.id,
      source: "DAMAGE_MAP",
      zone: "front-bumper",
      damageTypes: ["DENT", "SCRATCH"],
      proposedActions: ["REPAIR", "REPAINT"],
      recordedByStaffId: staffA.id,
    },
  });
  findingB = await prismaUnscoped.finding.create({
    data: {
      shopId: shopB.id,
      caseId: caseB.id,
      source: "CHECKLIST",
      checklistItem: "brakes",
      condition: "NEEDS_WORK",
      proposedActions: ["REPLACE"],
      recordedByStaffId: staffB.id,
    },
  });
  // M4 domain rows: one catalog entry, Job, part line, quotation (+ line),
  // and authorization per shop as needed.
  catalogItemA = await prismaUnscoped.serviceCatalogItem.create({
    data: { shopId: shopA.id, name: `${run} pads A`, priceSatang: 280_000 },
  });
  catalogItemB = await prismaUnscoped.serviceCatalogItem.create({
    data: { shopId: shopB.id, name: `${run} pads B`, priceSatang: 300_000 },
  });
  jobA = await prismaUnscoped.job.create({
    data: {
      shopId: shopA.id,
      caseId: caseA.id,
      title: `${run} Job A`,
      payerType: "CUSTOMER",
      priceSatang: 500_000,
      createdByStaffId: staffA.id,
    },
  });
  jobB = await prismaUnscoped.job.create({
    data: {
      shopId: shopB.id,
      caseId: caseB.id,
      title: `${run} Job B`,
      payerType: "INSURER",
      insurerName: "Viriyah",
      priceSatang: 700_000,
      createdByStaffId: staffB.id,
    },
  });
  await prismaUnscoped.partLine.create({
    data: { shopId: shopA.id, jobId: jobA.id, name: `${run} part A` },
  });
  quotationA = await prismaUnscoped.quotation.create({
    data: {
      shopId: shopA.id,
      caseId: caseA.id,
      number: `${run}-Q-A`,
      version: 1,
      totalSatang: 500_000,
      issuedByStaffId: staffA.id,
    },
  });
  await prismaUnscoped.quotationLine.create({
    data: {
      shopId: shopA.id,
      quotationId: quotationA.id,
      jobId: jobA.id,
      title: `${run} Job A`,
      priceSatang: 500_000,
      payerType: "CUSTOMER",
      sortOrder: 0,
    },
  });
  await prismaUnscoped.jobAuthorization.create({
    data: {
      shopId: shopA.id,
      jobId: jobA.id,
      decision: "AUTHORIZED",
      channel: "PHONE",
      quotationId: quotationA.id,
      recordedByStaffId: staffA.id,
    },
  });
  // M5 domain rows: one internal-timeline event per shop.
  caseEventA = await prismaUnscoped.caseEvent.create({
    data: {
      shopId: shopA.id,
      caseId: caseA.id,
      type: "JOB_CREATED",
      jobId: jobA.id,
      jobTitle: `${run} Job A`,
      actorStaffId: staffA.id,
    },
  });
  await prismaUnscoped.caseEvent.create({
    data: {
      shopId: shopB.id,
      caseId: caseB.id,
      type: "JOB_CREATED",
      jobId: jobB.id,
      jobTitle: `${run} Job B`,
      actorStaffId: staffB.id,
    },
  });
  // M6 domain rows: a LINE identity and a sent Update per shop. The SAME
  // lineUserId is deliberately used in both — userIds are per-OA (ADR-005),
  // so two shops holding one must not collide or leak.
  photoA = await prismaUnscoped.photo.create({
    data: {
      shopId: shopA.id,
      caseId: caseA.id,
      storageKey: `${run}/a/line.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 10,
      uploadedByStaffId: staffA.id,
    },
  });
  lineContactA = await prismaUnscoped.lineContact.create({
    data: {
      shopId: shopA.id,
      lineUserId: SHARED_LINE_USER_ID,
      displayName: `${run} LINE A`,
      customerId: customerA.id,
      linkedByStaffId: staffA.id,
      linkedAt: new Date(),
    },
  });
  await prismaUnscoped.lineContact.create({
    data: {
      shopId: shopB.id,
      lineUserId: SHARED_LINE_USER_ID,
      displayName: `${run} LINE B`,
    },
  });
  lineUpdateA = await prismaUnscoped.lineUpdate.create({
    data: {
      shopId: shopA.id,
      caseId: caseA.id,
      customerId: customerA.id,
      lineUserId: SHARED_LINE_USER_ID,
      recipientName: `${run} Customer A`,
      bodyText: "อัปเดตงานซ่อม",
      deliveryStatus: "SENT",
      sentByStaffId: staffA.id,
      photos: {
        create: [
          {
            // shopId is supplied by the parent LineUpdate through the
            // composite FK — Prisma manages it on nested creates.
            photoId: photoA.id,
            sortOrder: 0,
            publicToken: `${run}-token-a`,
          },
        ],
      },
    },
  });
});

afterAll(async () => {
  const shopIds = [shopA.id, shopB.id];
  await prismaUnscoped.caseEvent.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.lineUpdatePhoto.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.lineUpdate.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.lineContact.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.shopLineChannel.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.photo.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.jobAuthorization.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.quotationLine.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.quotation.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.partLine.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.finding.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.job.deleteMany({ where: { shopId: { in: shopIds } } });
  await prismaUnscoped.serviceCatalogItem.deleteMany({ where: { shopId: { in: shopIds } } });
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

  it("rejects a Finding on another shop's case or staff", async () => {
    await expect(
      prismaUnscoped.finding.create({
        data: {
          shopId: shopA.id,
          caseId: caseB.id, // B's case under A's shop
          source: "DAMAGE_MAP",
          zone: "hood",
          recordedByStaffId: staffA.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prismaUnscoped.finding.create({
        data: {
          shopId: shopA.id,
          caseId: caseA.id,
          source: "DAMAGE_MAP",
          zone: "hood",
          recordedByStaffId: staffB.id, // B's staff recording in A
        },
      }),
    ).rejects.toThrow();
  });

  it("pins Finding photos to the finding's own case, not just its shop", async () => {
    // Same shop, wrong case: photo on caseA2 pointing at caseA's finding.
    // The (shop_id, case_id, finding_id) composite FK must reject it.
    await expect(
      prismaUnscoped.photo.create({
        data: {
          shopId: shopA.id,
          caseId: caseA2.id,
          findingId: findingA.id,
          storageKey: `${run}/photo-cross-case`,
          contentType: "image/jpeg",
          sizeBytes: 1,
          uploadedByStaffId: staffA.id,
        },
      }),
    ).rejects.toThrow();
    // The legitimate link works.
    const ok = await prismaUnscoped.photo.create({
      data: {
        shopId: shopA.id,
        caseId: caseA.id,
        findingId: findingA.id,
        storageKey: `${run}/photo-finding-a`,
        contentType: "image/jpeg",
        sizeBytes: 1,
        uploadedByStaffId: staffA.id,
      },
    });
    await prismaUnscoped.photo.delete({ where: { id: ok.id } });
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

  it("findUnique with a narrow select still works (guard injects shopId)", async () => {
    const own = await forShop(shopA.id).customer.findUnique({
      where: { id: customerA.id },
      select: { id: true },
    });
    expect(own).toEqual({ id: customerA.id });
    expect(
      await forShop(shopA.id).customer.findUnique({
        where: { id: customerB.id },
        select: { id: true },
      }),
    ).toBeNull();
  });

  it("repair cases: scoped findMany and cross-shop findUniqueOrThrow", async () => {
    const scoped = await forShop(shopA.id).repairCase.findMany({
      where: { reference: { startsWith: run } },
    });
    expect(scoped.map((c) => c.id).sort()).toEqual([caseA.id, caseA2.id].sort());
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

  it("unique-where mutations work inside an interactive transaction", async () => {
    // Regression: the old ownership pre-check ran on a separate connection
    // and deadlocked inside $transaction on single-connection dev servers.
    await forShop(shopA.id).$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customerA.id },
        data: { note: "updated-in-tx" },
      });
    });
    const after = await prismaUnscoped.customer.findUnique({
      where: { id: customerA.id },
    });
    expect(after?.note).toBe("updated-in-tx");
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

describe("M3 model is scoped (Finding)", () => {
  it("findMany stays inside the shop", async () => {
    const scoped = await forShop(shopA.id).finding.findMany({
      where: { caseId: { in: [caseA.id, caseB.id] } },
    });
    expect(scoped.map((f) => f.id)).toEqual([findingA.id]);
  });

  it("findUnique on another shop's finding returns null", async () => {
    expect(
      await forShop(shopA.id).finding.findUnique({ where: { id: findingB.id } }),
    ).toBeNull();
  });

  it("cross-shop finding delete throws and deletes nothing", async () => {
    await expect(
      forShop(shopA.id).finding.delete({ where: { id: findingB.id } }),
    ).rejects.toThrow(TenantGuardError);
    expect(
      await prismaUnscoped.finding.findUnique({ where: { id: findingB.id } }),
    ).not.toBeNull();
  });

  it("finding create lands in the scoped shop", async () => {
    const created = await forShop(shopA.id).finding.create({
      data: {
        caseId: caseA.id,
        source: "CHECKLIST",
        checklistItem: "battery",
        condition: "DUE_SOON",
        recordedByStaffId: staffA.id,
      } as never,
    });
    expect(created.shopId).toBe(shopA.id);
    await prismaUnscoped.finding.delete({ where: { id: created.id } });
  });
});

describe("M4 models are scoped (catalog, Job, authorization, parts, quotations)", () => {
  it("catalog items: findMany stays inside the shop", async () => {
    const scoped = await forShop(shopA.id).serviceCatalogItem.findMany({
      where: { name: { startsWith: run } },
    });
    expect(scoped.map((i) => i.id)).toEqual([catalogItemA.id]);
  });

  it("jobs: findMany stays inside the shop; cross-shop findUnique is null", async () => {
    const scoped = await forShop(shopA.id).job.findMany({
      where: { title: { startsWith: run } },
    });
    expect(scoped.map((j) => j.id)).toEqual([jobA.id]);
    expect(await forShop(shopA.id).job.findUnique({ where: { id: jobB.id } })).toBeNull();
  });

  it("cross-shop job update throws and changes nothing", async () => {
    await expect(
      forShop(shopA.id).job.update({
        where: { id: jobB.id },
        data: { priceSatang: 1 },
      }),
    ).rejects.toThrow(TenantGuardError);
    const untouched = await prismaUnscoped.job.findUnique({ where: { id: jobB.id } });
    expect(untouched?.priceSatang).toBe(700_000);
  });

  it("part lines, authorizations, and quotations are scoped", async () => {
    expect(
      await forShop(shopB.id).partLine.findMany({ where: { name: { startsWith: run } } }),
    ).toEqual([]);
    expect(
      await forShop(shopB.id).jobAuthorization.findMany({ where: { jobId: jobA.id } }),
    ).toEqual([]);
    expect(
      await forShop(shopB.id).quotation.findMany({ where: { number: { startsWith: run } } }),
    ).toEqual([]);
    const own = await forShop(shopA.id).quotation.findMany({
      where: { number: { startsWith: run } },
      include: { lines: true },
    });
    expect(own.map((q) => q.id)).toEqual([quotationA.id]);
    expect(own[0].lines).toHaveLength(1);
  });

  it("job create naming a foreign shopId throws", async () => {
    await expect(
      forShop(shopA.id).job.create({
        data: {
          shopId: shopB.id,
          caseId: caseB.id,
          title: `${run} smuggled job`,
          payerType: "CUSTOMER",
          createdByStaffId: staffB.id,
        },
      }),
    ).rejects.toThrow(TenantGuardError);
  });
});

describe("M4 database-level defense in depth", () => {
  it("rejects a Job on another shop's case or catalog entry", async () => {
    await expect(
      prismaUnscoped.job.create({
        data: {
          shopId: shopA.id,
          caseId: caseB.id, // B's case under A's shop
          title: `${run} evil job`,
          payerType: "CUSTOMER",
          createdByStaffId: staffA.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prismaUnscoped.job.create({
        data: {
          shopId: shopA.id,
          caseId: caseA.id,
          title: `${run} evil catalog job`,
          payerType: "CUSTOMER",
          catalogItemId: catalogItemB.id, // B's price list entry
          createdByStaffId: staffA.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("pins Finding→Job and Photo→Job to the job's own case, not just its shop", async () => {
    // Same shop, wrong case: rows on caseA2 pointing at caseA's job.
    await expect(
      prismaUnscoped.finding.create({
        data: {
          shopId: shopA.id,
          caseId: caseA2.id,
          source: "DAMAGE_MAP",
          zone: "hood",
          jobId: jobA.id,
          recordedByStaffId: staffA.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prismaUnscoped.photo.create({
        data: {
          shopId: shopA.id,
          caseId: caseA2.id,
          jobId: jobA.id,
          storageKey: `${run}/photo-cross-case-job`,
          contentType: "image/jpeg",
          sizeBytes: 1,
          uploadedByStaffId: staffA.id,
        },
      }),
    ).rejects.toThrow();
    // The legitimate links work.
    const photo = await prismaUnscoped.photo.create({
      data: {
        shopId: shopA.id,
        caseId: caseA.id,
        jobId: jobA.id,
        storageKey: `${run}/photo-job-a`,
        contentType: "image/jpeg",
        sizeBytes: 1,
        uploadedByStaffId: staffA.id,
      },
    });
    await prismaUnscoped.photo.delete({ where: { id: photo.id } });
  });

  it("rejects an authorization or quotation crossing shops", async () => {
    await expect(
      prismaUnscoped.jobAuthorization.create({
        data: {
          shopId: shopA.id,
          jobId: jobB.id, // B's job under A's shop
          decision: "AUTHORIZED",
          channel: "PHONE",
          recordedByStaffId: staffA.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prismaUnscoped.quotation.create({
        data: {
          shopId: shopA.id,
          caseId: caseB.id, // B's case under A's shop
          number: `${run}-Q-EVIL`,
          version: 1,
          totalSatang: 1,
          issuedByStaffId: staffA.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prismaUnscoped.partLine.create({
        data: { shopId: shopA.id, jobId: jobB.id, name: `${run} evil part` },
      }),
    ).rejects.toThrow();
  });

  it("quotation lines survive job deletion via the soft SET NULL link", async () => {
    // The one deliberate single-column FK (see schema comment): deleting a
    // quoted job must never take the snapshot line with it.
    const tempJob = await prismaUnscoped.job.create({
      data: {
        shopId: shopA.id,
        caseId: caseA.id,
        title: `${run} temp job`,
        payerType: "CUSTOMER",
        priceSatang: 100_000,
        createdByStaffId: staffA.id,
      },
    });
    const line = await prismaUnscoped.quotationLine.create({
      data: {
        shopId: shopA.id,
        quotationId: quotationA.id,
        jobId: tempJob.id,
        title: tempJob.title,
        priceSatang: 100_000,
        payerType: "CUSTOMER",
        sortOrder: 1,
      },
    });
    await prismaUnscoped.job.delete({ where: { id: tempJob.id } });
    const survivor = await prismaUnscoped.quotationLine.findUnique({
      where: { id: line.id },
    });
    expect(survivor).not.toBeNull();
    expect(survivor?.jobId).toBeNull();
    expect(survivor?.priceSatang).toBe(100_000);
    await prismaUnscoped.quotationLine.delete({ where: { id: line.id } });
  });
});

describe("M5 model is scoped (CaseEvent)", () => {
  it("findMany stays inside the shop", async () => {
    const events = await forShop(shopA.id).caseEvent.findMany({
      where: { jobTitle: { startsWith: run } },
    });
    expect(events.map((e) => e.id)).toEqual([caseEventA.id]);
  });

  it("findUnique on another shop's event returns null", async () => {
    expect(
      await forShop(shopB.id).caseEvent.findUnique({ where: { id: caseEventA.id } }),
    ).toBeNull();
  });

  it("event create lands in the scoped shop; the log is append-only-safe across shops", async () => {
    const created = await forShop(shopA.id).caseEvent.create({
      data: { shopId: shopA.id, caseId: caseA.id, type: "CASE_READY", actorStaffId: staffA.id },
    });
    expect(created.shopId).toBe(shopA.id);
    // B cannot delete A's history even by id.
    await expect(
      forShop(shopB.id).caseEvent.delete({ where: { id: created.id } }),
    ).rejects.toThrow(TenantGuardError);
    await prismaUnscoped.caseEvent.delete({ where: { id: created.id } });
  });
});

describe("M5 database-level defense in depth", () => {
  it("rejects an event on another shop's case, actor, or quotation", async () => {
    await expect(
      prismaUnscoped.caseEvent.create({
        data: {
          shopId: shopA.id,
          caseId: caseB.id, // B's case under A's shop
          type: "CASE_READY",
          actorStaffId: staffA.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prismaUnscoped.caseEvent.create({
        data: {
          shopId: shopA.id,
          caseId: caseA.id,
          type: "CASE_READY",
          actorStaffId: staffB.id, // B's staff as actor
        },
      }),
    ).rejects.toThrow();
    await expect(
      prismaUnscoped.caseEvent.create({
        data: {
          shopId: shopB.id,
          caseId: caseB.id,
          type: "QUOTATION_ISSUED",
          quotationId: quotationA.id, // A's quotation under B's shop
          actorStaffId: staffB.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a delivered-by staff from another shop", async () => {
    await expect(
      prismaUnscoped.repairCase.update({
        where: { id: caseA.id },
        data: { deliveredByStaffId: staffB.id },
      }),
    ).rejects.toThrow();
  });

  it("events survive job deletion via the soft SET NULL link, title snapshot intact", async () => {
    const tempJob = await prismaUnscoped.job.create({
      data: {
        shopId: shopA.id,
        caseId: caseA.id,
        title: `${run} temp job M5`,
        payerType: "CUSTOMER",
        createdByStaffId: staffA.id,
      },
    });
    const event = await prismaUnscoped.caseEvent.create({
      data: {
        shopId: shopA.id,
        caseId: caseA.id,
        type: "JOB_CREATED",
        jobId: tempJob.id,
        jobTitle: tempJob.title,
        actorStaffId: staffA.id,
      },
    });
    await prismaUnscoped.job.delete({ where: { id: tempJob.id } });
    const survivor = await prismaUnscoped.caseEvent.findUnique({ where: { id: event.id } });
    expect(survivor).not.toBeNull();
    expect(survivor?.jobId).toBeNull();
    expect(survivor?.jobTitle).toBe(tempJob.title);
    await prismaUnscoped.caseEvent.delete({ where: { id: event.id } });
  });
});

describe("M6 — LINE integration", () => {
  it("scopes LINE contacts per shop even when the userId is identical", async () => {
    const fromA = await forShop(shopA.id).lineContact.findMany({
      where: { lineUserId: SHARED_LINE_USER_ID },
    });
    const fromB = await forShop(shopB.id).lineContact.findMany({
      where: { lineUserId: SHARED_LINE_USER_ID },
    });
    expect(fromA).toHaveLength(1);
    expect(fromB).toHaveLength(1);
    expect(fromA[0]!.id).not.toBe(fromB[0]!.id);
    expect(fromA[0]!.displayName).toContain("LINE A");
  });

  it("hides another shop's LINE contact, update and published photo", async () => {
    expect(
      await forShop(shopB.id).lineContact.findUnique({ where: { id: lineContactA.id } }),
    ).toBeNull();
    expect(
      await forShop(shopB.id).lineUpdate.findUnique({ where: { id: lineUpdateA.id } }),
    ).toBeNull();
    expect(
      await forShop(shopB.id).lineUpdatePhoto.findFirst({
        where: { publicToken: `${run}-token-a` },
      }),
    ).toBeNull();
  });

  it("refuses to link a LINE contact to another shop's customer", async () => {
    await expect(
      prismaUnscoped.lineContact.create({
        data: {
          shopId: shopB.id,
          lineUserId: "U0000000000000000000000000000beef",
          customerId: customerA.id, // A's customer under B's shop
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses an Update whose case, customer or sender belongs to another shop", async () => {
    await expect(
      prismaUnscoped.lineUpdate.create({
        data: {
          shopId: shopB.id,
          caseId: caseA.id, // A's case under B's shop
          customerId: customerB.id,
          lineUserId: SHARED_LINE_USER_ID,
          recipientName: "x",
          bodyText: "x",
          deliveryStatus: "SENT",
          sentByStaffId: staffB.id,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prismaUnscoped.lineUpdate.create({
        data: {
          shopId: shopB.id,
          caseId: caseB.id,
          customerId: customerA.id, // A's customer under B's shop
          lineUserId: SHARED_LINE_USER_ID,
          recipientName: "x",
          bodyText: "x",
          deliveryStatus: "SENT",
          sentByStaffId: staffB.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses to publish another shop's photo on an Update", async () => {
    await expect(
      prismaUnscoped.lineUpdatePhoto.create({
        data: {
          shopId: shopB.id,
          lineUpdateId: lineUpdateA.id,
          photoId: photoA.id,
          sortOrder: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a channel connected by another shop's staff", async () => {
    await expect(
      prismaUnscoped.shopLineChannel.create({
        data: {
          shopId: shopB.id,
          channelSecretEnc: "v1:x:y:z",
          channelAccessTokenEnc: "v1:x:y:z",
          connectedByStaffId: staffA.id, // A's staff under B's shop
        },
      }),
    ).rejects.toThrow();
  });

  it("keeps one linked LINE contact per customer", async () => {
    await expect(
      prismaUnscoped.lineContact.create({
        data: {
          shopId: shopA.id,
          lineUserId: "U0000000000000000000000000000cafe",
          customerId: customerA.id, // already linked to lineContactA
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a create that names a foreign shop, like every other model", async () => {
    await expect(
      forShop(shopA.id).lineContact.create({
        data: { shopId: shopB.id, lineUserId: "U0000000000000000000000000000dead" },
      }),
    ).rejects.toThrow(TenantGuardError);
  });
});
