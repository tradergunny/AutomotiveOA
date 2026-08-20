import type { TenantDb } from "@/lib/tenant";

/**
 * Per-Shop Repair Case references (M2 brief §2): RC-1001, RC-1002, … Every
 * Shop numbers independently from Shop.caseSeq.
 *
 * Concurrency-safe: the increment is one atomic UPDATE … RETURNING on the
 * Shop row, so parallel check-ins serialize on the row lock and each gets a
 * distinct number. Call it inside the transaction that creates the
 * RepairCase — a rolled-back check-in then rolls the counter back too, so
 * references stay gap-free.
 */
export async function allocateCaseReference(
  db: Pick<TenantDb, "shop">,
  shopId: string,
): Promise<string> {
  const shop = await db.shop.update({
    where: { id: shopId },
    data: { caseSeq: { increment: 1 } },
    select: { caseSeq: true },
  });
  return `RC-${shop.caseSeq}`;
}
