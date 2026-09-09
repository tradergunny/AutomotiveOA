import { CarFront, Plus } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { sortBoard, toBoardCase, type BoardCaseInput } from "@/lib/board";
import { caseBalance } from "@/lib/payments";
import { tenantDb } from "@/lib/session";
import { BoardView } from "./board-view";

// The Case Board (M7.9, D-26): a spine strip, one attention-ordered list, and
// the selected case's pane. Every open case exactly once, grouped by the
// shared Stage derivation (D-2 precedence, unchanged); delivered cases still
// owed money ride along as Balance due (M7 ruling 1). This server component
// only queries and derives — the client view owns filter, search, selection.

// Light includes only: one wide lateral-join query over eight relations
// closes the connection on the local dev Postgres, so the per-case
// collections (jobs, quotations, sends, payments) load as four flat queries
// keyed by case and are joined here.
const BOARD_INCLUDE = {
  vehicle: { select: { plate: true, make: true, model: true, bodyType: true } },
  contactCustomer: { select: { name: true, phone: true } },
  photos: {
    where: { findingId: null, jobId: null },
    orderBy: { capturedAt: "asc" },
    take: 1,
    select: { id: true },
  },
  findings: { select: { confirmedAt: true } },
} as const;

export default async function BoardPage() {
  const [t, db] = await Promise.all([getTranslations("board"), tenantDb()]);
  const now = new Date();

  const [open, delivered] = await Promise.all([
    db.repairCase.findMany({
      where: { status: { not: "DELIVERED" } },
      include: BOARD_INCLUDE,
      orderBy: { checkedInAt: "asc" },
      take: 200,
    }),
    db.repairCase.findMany({
      where: { status: "DELIVERED" },
      include: BOARD_INCLUDE,
      orderBy: { deliveredAt: "asc" },
    }),
  ]);
  const cases = [...open, ...delivered];
  const caseIds = cases.map((row) => row.id);

  const [jobs, quotations, sends, payments] = await Promise.all([
    db.job.findMany({
      where: { caseId: { in: caseIds } },
      select: {
        caseId: true,
        id: true,
        title: true,
        status: true,
        waitingReason: true,
        payerType: true,
        insurerName: true,
        priceSatang: true,
        assignedStaff: { select: { name: true } },
        partLines: { select: { orderStatus: true, etaDate: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.quotation.findMany({
      where: { caseId: { in: caseIds } },
      select: { caseId: true, lines: { select: { jobId: true, priceSatang: true } } },
    }),
    db.lineUpdate.findMany({
      where: { caseId: { in: caseIds }, quotationId: { not: null } },
      select: { caseId: true, sentAt: true },
    }),
    db.payment.findMany({
      where: { caseId: { in: caseIds } },
      select: { caseId: true, payerType: true, amountSatang: true, voidedAt: true },
    }),
  ]);

  const byCase = <T extends { caseId: string }>(items: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of items) map.set(item.caseId, [...(map.get(item.caseId) ?? []), item]);
    return (id: string) => map.get(id) ?? [];
  };
  const jobsOf = byCase(jobs);
  const quotationsOf = byCase(quotations);
  const sendsOf = byCase(sends);
  const paymentsOf = byCase(payments);

  const toInput = (row: (typeof cases)[number]): BoardCaseInput => ({
    ...row,
    jobs: jobsOf(row.id),
    quotations: quotationsOf(row.id),
    quotationSends: sendsOf(row.id),
    payments: paymentsOf(row.id),
  });

  const rows = sortBoard(
    cases
      .map(toInput)
      // Balance due (M7 ruling 1): a delivered case rides along only while owed.
      .filter((input) => input.status !== "DELIVERED" || caseBalance(input.jobs, input.payments).totalDueSatang > 0)
      .map((input) => toBoardCase(input, now)),
  );

  if (rows.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border bg-card p-10 text-center lift">
        <CarFront className="mx-auto size-6 text-faint" aria-hidden />
        <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>
        <Button asChild className="mt-5 rounded-xl font-semibold">
          <Link href="/checkin">
            <Plus data-icon="inline-start" />
            {t("newCheckin")}
          </Link>
        </Button>
      </div>
    );
  }

  return <BoardView rows={rows} now={now.toISOString()} />;
}
