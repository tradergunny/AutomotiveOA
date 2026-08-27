import "./load-env";
import { prismaUnscoped } from "../lib/db";
import { forShop } from "../lib/tenant";
import { mintFollowUpsForCase } from "../lib/followups";

/**
 * One-time FollowUp backfill for cases delivered BEFORE M7 (brief §9,
 * decision 4). Unlike M5's rejected CaseEvent backfill this fabricates no
 * history: delivered cases are frozen, so their candidate set is exactly
 * what the delivery mint would have produced — present state, derived from
 * frozen data. Idempotent (one row per source + skipDuplicates); safe to
 * re-run. Usage: npm run followups:backfill
 */

async function main() {
  const shops = await prismaUnscoped.shop.findMany({ select: { id: true, name: true } });
  for (const shop of shops) {
    const db = forShop(shop.id);
    const delivered = await db.repairCase.findMany({
      where: { status: "DELIVERED" },
      select: { id: true, reference: true, contactCustomerId: true },
    });
    let minted = 0;
    for (const repairCase of delivered) {
      minted += await db.$transaction((tx) =>
        mintFollowUpsForCase(tx, shop.id, repairCase.id, repairCase.contactCustomerId),
      );
    }
    console.log(
      `${shop.name}: ${delivered.length} delivered case(s) scanned, ${minted} follow-up(s) minted`,
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
