import { revalidatePath } from "next/cache";
import type { FlowTx } from "@/lib/case-flow";
import type { TenantDb } from "@/lib/tenant";

/**
 * Linking a LINE Contact to a Customer — ONE code path for the two ways the
 * link is made (CONTEXT.md, LINE Contact): the Manager's hand match in the
 * contacts inbox (ADR-005, settings/actions.ts) and the advisor confirming a
 * customer's Arrival that came through LINE (ADR-006, checkin/actions.ts).
 * Lifted out of settings/actions.ts in M7.8 so the second caller cannot
 * drift from the first: one linked contact per Customer, relinking replaces
 * and records the replacement, and every open case the Customer is the
 * contact for gets its LINE_CUSTOMER_LINKED / UNLINKED event (M5's rule).
 *
 * Runs on a transaction client, so the Arrival path can link inside the
 * same transaction that opens the case. Path revalidation is a side effect
 * the transaction cannot own — callers revalidate the returned case ids.
 */

type IdentityDb = FlowTx | TenantDb;

async function logIdentityEvent(
  db: IdentityDb,
  input: {
    shopId: string;
    customerId: string;
    actorStaffId: string;
    type: "LINE_CUSTOMER_LINKED" | "LINE_CUSTOMER_UNLINKED";
    subjectName: string | null;
  },
): Promise<string[]> {
  const cases = await db.repairCase.findMany({
    where: { contactCustomerId: input.customerId, status: { not: "DELIVERED" } },
    select: { id: true },
  });
  if (cases.length === 0) return [];
  await db.caseEvent.createMany({
    data: cases.map((row) => ({
      shopId: input.shopId,
      caseId: row.id,
      type: input.type,
      subjectName: input.subjectName,
      actorStaffId: input.actorStaffId,
    })),
  });
  return cases.map((row) => row.id);
}

export type LinkResult = {
  /** Cases whose internal timeline gained an event — revalidate them. */
  touchedCaseIds: string[];
  /** The contact that lost the Customer, when relinking replaced one. */
  replaced: { id: string; displayName: string | null } | null;
  /** The Customer this contact left, when it was linked to someone else. */
  formerCustomerId: string | null;
};

/**
 * Link `contactId` to `customerId`, replacing whatever contact the Customer
 * held before. Both rows must already exist in the scoped shop; callers
 * check that and translate a miss into their own error.
 */
export async function linkLineContactToCustomer(
  db: IdentityDb,
  input: { shopId: string; contactId: string; customerId: string; actorStaffId: string },
): Promise<LinkResult> {
  const touched: string[] = [];

  // One linked contact per Customer (schema-enforced): relinking replaces,
  // and the replacement is recorded like any other change.
  const previous = await db.lineContact.findFirst({
    where: { customerId: input.customerId, NOT: { id: input.contactId } },
    select: { id: true, displayName: true },
  });
  if (previous) {
    await db.lineContact.update({
      where: { id: previous.id },
      data: { customerId: null, linkedByStaffId: null, linkedAt: null },
    });
    touched.push(
      ...(await logIdentityEvent(db, {
        shopId: input.shopId,
        customerId: input.customerId,
        actorStaffId: input.actorStaffId,
        type: "LINE_CUSTOMER_UNLINKED",
        subjectName: previous.displayName,
      })),
    );
  }

  // The other direction of a move (M7.8): this contact may itself have been
  // linked to someone else, whose open cases should say the LINE went away.
  const before = await db.lineContact.findUnique({
    where: { id: input.contactId },
    select: { customerId: true, displayName: true },
  });
  const formerCustomerId =
    before?.customerId && before.customerId !== input.customerId ? before.customerId : null;
  if (formerCustomerId) {
    touched.push(
      ...(await logIdentityEvent(db, {
        shopId: input.shopId,
        customerId: formerCustomerId,
        actorStaffId: input.actorStaffId,
        type: "LINE_CUSTOMER_UNLINKED",
        subjectName: before?.displayName ?? null,
      })),
    );
  }

  const updated = await db.lineContact.update({
    where: { id: input.contactId },
    data: { customerId: input.customerId, linkedByStaffId: input.actorStaffId, linkedAt: new Date() },
    select: { displayName: true },
  });

  touched.push(
    ...(await logIdentityEvent(db, {
      shopId: input.shopId,
      customerId: input.customerId,
      actorStaffId: input.actorStaffId,
      type: "LINE_CUSTOMER_LINKED",
      subjectName: updated.displayName,
    })),
  );

  return { touchedCaseIds: [...new Set(touched)], replaced: previous, formerCustomerId };
}

/** Remove a contact's link. Returns the cases whose timeline gained an event. */
export async function unlinkLineContactFromCustomer(
  db: IdentityDb,
  input: {
    shopId: string;
    contactId: string;
    customerId: string;
    displayName: string | null;
    actorStaffId: string;
  },
): Promise<string[]> {
  await db.lineContact.update({
    where: { id: input.contactId },
    data: { customerId: null, linkedByStaffId: null, linkedAt: null },
  });
  return logIdentityEvent(db, {
    shopId: input.shopId,
    customerId: input.customerId,
    actorStaffId: input.actorStaffId,
    type: "LINE_CUSTOMER_UNLINKED",
    subjectName: input.displayName,
  });
}

/** The revalidation a link or unlink owes, once the transaction committed. */
export function revalidateIdentityPaths(customerId: string, caseIds: string[]) {
  revalidatePath("/settings");
  revalidatePath(`/customers/${customerId}`);
  for (const id of caseIds) revalidatePath(`/cases/${id}`);
}
