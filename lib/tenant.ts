import { prismaUnscoped } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * Tenant-guarded data layer (ADR-001).
 *
 * All application code reads and writes tenant data through `forShop(shopId)`,
 * which returns a Prisma client that scopes every operation to one Shop at the
 * data-access layer — never through hand-written WHERE clauses in features.
 *
 * The guard is fail-closed:
 * - every model in schema.prisma must be classified below; the `_exhaustive`
 *   check breaks the build when a new model is added unclassified, and the
 *   runtime throws for anything unknown anyway;
 * - operations the guard can't scope (raw queries) are rejected;
 * - a create that names a foreign shopId throws instead of being rewritten.
 *
 * Unique-where mutations (update/delete/upsert) enforce ownership by merging
 * the tenant filter into the unique where itself (extended where-unique), so
 * the check and the mutation are ONE atomic statement on the same
 * connection — transaction-safe, no read-then-write window. A cross-shop (or
 * missing) target surfaces as Prisma "record not found" (P2025) and is
 * rethrown as TenantGuardError; upsert's create branch is forced into the
 * scoped shop, and a row hiding in another shop then trips the unique
 * constraint instead of leaking.
 *
 * Nested writes are not intercepted by Prisma query extensions, but the
 * relations are structurally safe: every tenant-owned relation joins on a
 * same-shop composite FK — User→Staff in M1; Vehicle→Customer,
 * RepairCase→{Vehicle, Customer, Staff}, and Photo→{RepairCase, Staff} in
 * M2; Finding→{RepairCase, Staff} and Photo→Finding (same shop AND case) in
 * M3; Job→{RepairCase, ServiceCatalogItem, Staff}, Finding→Job and
 * Photo→Job (same shop AND case), JobAuthorization→{Job, Quotation, Staff},
 * PartLine→Job, Quotation→{RepairCase, Staff}, and QuotationLine→Quotation
 * in M4; CaseEvent→{RepairCase, Quotation, Staff×2} and
 * RepairCase→Staff (deliveredBy) in M5 — so the database rejects any
 * cross-shop link a nested write could attempt. (Two deliberate exceptions,
 * same reason: QuotationLine→Job and CaseEvent→Job are single-column soft
 * links so ON DELETE SET NULL works — see the schema comments; each row's
 * shop stays pinned through its Quotation/RepairCase.)
 */

/** Models that carry shop_id and belong to exactly one Shop. */
const TENANT_OWNED = [
  "Staff",
  "User",
  "Customer",
  "Vehicle",
  "RepairCase",
  "Photo",
  "Finding",
  "ServiceCatalogItem",
  "Job",
  "JobAuthorization",
  "PartLine",
  "Quotation",
  "QuotationLine",
  "CaseEvent",
] as const satisfies readonly Prisma.ModelName[];

/** The tenant itself: readable/updatable only as the shop's own row. */
const SHOP_MODEL = "Shop" as const satisfies Prisma.ModelName;

type Classified = (typeof TENANT_OWNED)[number] | typeof SHOP_MODEL;
// Compile-time exhaustiveness: adding a model to schema.prisma without
// classifying it here turns this line into a type error.
const _exhaustive: [Prisma.ModelName] extends [Classified] ? true : never = true;
void _exhaustive;

export class TenantGuardError extends Error {
  constructor(message: string) {
    super(`[tenant-guard] ${message}`);
    this.name = "TenantGuardError";
  }
}

const isTenantOwned = (model: string) =>
  (TENANT_OWNED as readonly string[]).includes(model);

const isRecordNotFound = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

const SCOPED_WHERE_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);

const UNIQUE_READ_OPS = new Set(["findUnique", "findUniqueOrThrow"]);
const UNIQUE_MUTATION_OPS = new Set(["update", "delete", "upsert"]);

function mergeWhere(args: any, filter: Record<string, string>) {
  return { ...args, where: { AND: [args?.where ?? {}, filter] } };
}

function forceShopIdOnCreate(data: any, shopId: string) {
  if (data == null || typeof data !== "object") {
    throw new TenantGuardError("create requires a data object");
  }
  if (data.shop !== undefined) {
    throw new TenantGuardError(
      "set the shop via scalar shopId (or omit it), not a nested shop relation",
    );
  }
  if (data.shopId != null && data.shopId !== shopId) {
    throw new TenantGuardError(
      `create targets shop ${data.shopId} from a client scoped to ${shopId}`,
    );
  }
  return { ...data, shopId };
}

function rejectShopIdChange(data: any, shopId: string) {
  if (data != null && typeof data === "object") {
    if (data.shopId != null && data.shopId !== shopId) {
      throw new TenantGuardError("rows never change tenant: shopId is immutable");
    }
    if (data.shop !== undefined) {
      throw new TenantGuardError("rows never change tenant: shop relation is immutable");
    }
  }
  return data;
}

/**
 * A Prisma client scoped to one Shop. The only way application code touches
 * tenant data.
 */
export function forShop(shopId: string) {
  if (!shopId || typeof shopId !== "string") {
    throw new TenantGuardError("forShop requires a non-empty shopId");
  }

  return prismaUnscoped.$extends({
    name: `tenant:${shopId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model === SHOP_MODEL) {
            return shopModelGuard(shopId, operation, args, query);
          }
          if (isTenantOwned(model)) {
            return tenantModelGuard(shopId, model, operation, args, query);
          }
          // Fail closed: a model that slipped past classification.
          throw new TenantGuardError(`model ${model} is not classified for tenancy`);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forShop>;

async function tenantModelGuard(
  shopId: string,
  model: string,
  operation: string,
  args: any,
  query: (args: any) => Promise<any>,
) {
  if (SCOPED_WHERE_OPS.has(operation)) {
    if (operation.startsWith("updateMany")) {
      rejectShopIdChange(args?.data, shopId);
    }
    return query(mergeWhere(args, { shopId }));
  }

  if (UNIQUE_READ_OPS.has(operation)) {
    // The ownership post-check reads result.shopId, so a narrow `select`
    // must still fetch it (injected here, stripped again before returning).
    const selected = args?.select;
    const injectShopId = selected != null && selected.shopId == null;
    const result = await query(
      injectShopId ? { ...args, select: { ...selected, shopId: true } } : args,
    );
    if (result != null && result.shopId !== shopId) {
      if (operation === "findUniqueOrThrow") {
        throw new TenantGuardError(`${model} row not found in shop ${shopId}`);
      }
      return null;
    }
    if (injectShopId && result != null) delete result.shopId;
    return result;
  }

  if (UNIQUE_MUTATION_OPS.has(operation)) {
    const where = { ...args.where, shopId };
    if (operation === "upsert") {
      rejectShopIdChange(args.update, shopId);
      // No row in this shop: either it truly doesn't exist (create branch,
      // forced into this shop) or it belongs to another shop (the unique
      // constraint then rejects the create — nothing leaks either way).
      return query({
        ...args,
        where,
        create: forceShopIdOnCreate(args.create, shopId),
      });
    }
    if (operation === "update") {
      rejectShopIdChange(args.data, shopId);
    }
    try {
      return await query({ ...args, where });
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw new TenantGuardError(`${model} row not found in shop ${shopId}`);
      }
      throw error;
    }
  }

  if (operation === "create") {
    return query({ ...args, data: forceShopIdOnCreate(args.data, shopId) });
  }

  if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(args?.data) ? args.data : [args?.data];
    return query({
      ...args,
      data: rows.map((row: any) => forceShopIdOnCreate(row, shopId)),
    });
  }

  throw new TenantGuardError(`operation ${operation} on ${model} is not tenant-scopable`);
}

async function shopModelGuard(
  shopId: string,
  operation: string,
  args: any,
  query: (args: any) => Promise<any>,
) {
  if (SCOPED_WHERE_OPS.has(operation)) {
    if (operation.startsWith("updateMany")) {
      // Scoped to the shop's own row below; nothing tenant-mutable to strip.
      return query(mergeWhere(args, { id: shopId }));
    }
    if (operation === "deleteMany") {
      throw new TenantGuardError("a tenant client cannot delete shops");
    }
    return query(mergeWhere(args, { id: shopId }));
  }

  if (UNIQUE_READ_OPS.has(operation)) {
    const result = await query(args);
    if (result != null && result.id !== shopId) {
      if (operation === "findUniqueOrThrow") {
        throw new TenantGuardError(`shop ${shopId} cannot read other shops`);
      }
      return null;
    }
    return result;
  }

  if (operation === "update") {
    if (args?.where?.id !== shopId) {
      throw new TenantGuardError("a tenant client can only update its own shop");
    }
    return query(args);
  }

  // create/createMany/delete/upsert…: shop lifecycle is platform admin work,
  // never something a tenant-scoped client does.
  throw new TenantGuardError(`operation ${operation} on Shop is not allowed for a tenant client`);
}
