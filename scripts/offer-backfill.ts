import "./load-env";
import { createTranslator } from "next-intl";
import { prismaUnscoped } from "../lib/db";
import { isGroupable } from "../lib/inspection";
import { createLineForFinding, deriveLineTitle } from "../lib/offer";
import { forShop } from "../lib/tenant";
import thMessages from "../messages/th.json";

/**
 * One-time Offer backfill for M7.7 (brief §12, D-24): before Accept filled
 * the Offer, an accepted Finding that proposed work sat ungrouped until a
 * human raised a Job for it. On open cases such Findings now get the line
 * Accept would have made — derived title, payer Customer, unpriced — so the
 * Offer reads the same for cases that straddle the change. Delivered cases
 * are frozen and untouched; Findings already on a Job are skipped, so the
 * script is idempotent. Titles derive in Thai (the default locale) since no
 * staff member is acting; the case's opener is recorded as the actor.
 *
 * Dev and staging only — the pilot is not live. Usage: npm run offer:backfill
 */

async function main() {
  const t = createTranslator({ locale: "th", messages: thMessages, namespace: "inspection" });
  const shops = await prismaUnscoped.shop.findMany({ select: { id: true, name: true } });
  for (const shop of shops) {
    const db = forShop(shop.id);
    const findings = await db.finding.findMany({
      where: {
        jobId: null,
        confirmedAt: { not: null },
        proposedActions: { isEmpty: false },
        repairCase: { status: { not: "DELIVERED" } },
      },
      select: {
        id: true,
        caseId: true,
        zone: true,
        checklistItem: true,
        proposedActions: true,
        confirmedAt: true,
        jobId: true,
        repairCase: { select: { openedByStaffId: true } },
      },
      orderBy: { recordedAt: "asc" },
    });
    let created = 0;
    for (const finding of findings) {
      if (!isGroupable(finding)) continue; // belt and braces with the query above
      const label = finding.zone
        ? t(`zones.${finding.zone}` as never)
        : t(`checklist.${finding.checklistItem}` as never);
      const title = deriveLineTitle(
        label,
        finding.proposedActions.map((action) => t(`actions.${action}` as never)),
      );
      await db.$transaction((tx) =>
        createLineForFinding(
          tx,
          { shopId: shop.id, staffId: finding.repairCase.openedByStaffId },
          { id: finding.id, caseId: finding.caseId },
          title,
        ),
      );
      created += 1;
    }
    console.log(
      `${shop.name}: ${findings.length} accepted, ungrouped finding(s) scanned, ${created} line(s) created`,
    );
  }
}

main()
  .then(() => prismaUnscoped.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prismaUnscoped.$disconnect();
    process.exit(1);
  });
