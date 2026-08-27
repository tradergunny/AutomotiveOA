import { CarFront, Plus } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CaseStatusBadge } from "@/components/blocks/case-status-badge";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { JobRollupChips } from "@/components/blocks/job-rollup";
import { Button } from "@/components/ui/button";
import { boardGroupFor, BOARD_GROUPS, isActiveJob, type BoardGroup } from "@/lib/case-flow";
import { formatBaht } from "@/lib/money";
import { formatPhone } from "@/lib/normalize";
import { caseBalance } from "@/lib/payments";
import { tenantDb } from "@/lib/session";

// The Case Board (M5 brief §5, DESIGN.md D-2): every open case exactly once,
// grouped by what needs a human, In assessment leading as the catch-all.
// No kanban — placement is derived (ruling 4c), so there is nothing to drag.
// M7 (ruling 1) adds the trailing Balance-due group: delivered cases still
// owed money — rendered for money, not work — until their balance clears.
// Ready rows show the amount to collect at handover.
export default async function BoardPage() {
  const [t, tp, format, db] = await Promise.all([
    getTranslations("board"),
    getTranslations("payments"),
    getFormatter(),
    tenantDb(),
  ]);

  const [cases, deliveredCases] = await Promise.all([
    db.repairCase.findMany({
      where: { status: { not: "DELIVERED" } },
      include: {
        vehicle: { select: { plate: true, make: true, model: true } },
        contactCustomer: { select: { name: true, phone: true } },
        jobs: {
          select: {
            status: true,
            waitingReason: true,
            payerType: true,
            priceSatang: true,
            assignedStaff: { select: { name: true } },
            partLines: { select: { orderStatus: true, etaDate: true } },
          },
        },
        payments: { select: { payerType: true, amountSatang: true, voidedAt: true } },
      },
      orderBy: { checkedInAt: "asc" }, // oldest first — the stalest car needs the eyes
      take: 200,
    }),
    // Balance due (M7 ruling 1): the membership test is a derived balance,
    // so the rows are computed here and filtered below. Small selects over
    // all delivered cases — cheap at garage scale; a materialized balance
    // column is the later optimization if it ever isn't.
    db.repairCase.findMany({
      where: { status: "DELIVERED" },
      select: {
        id: true,
        reference: true,
        deliveredAt: true,
        vehicle: { select: { plate: true, make: true, model: true } },
        contactCustomer: { select: { name: true, phone: true } },
        jobs: { select: { status: true, payerType: true, priceSatang: true } },
        payments: { select: { payerType: true, amountSatang: true, voidedAt: true } },
      },
      orderBy: { deliveredAt: "asc" }, // oldest debt first
    }),
  ]);

  const balanceRows = deliveredCases
    .map((repairCase) => ({
      ...repairCase,
      balance: caseBalance(repairCase.jobs, repairCase.payments),
    }))
    .filter((row) => row.balance.totalDueSatang > 0);

  if (cases.length === 0 && balanceRows.length === 0) {
    return (
      <div className="relative mx-auto mt-16 max-w-md border bg-card p-10 text-center">
        <CornerTicks />
        <CarFront className="mx-auto size-6 text-faint" aria-hidden />
        <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>
        <Button asChild className="mt-5 font-semibold">
          <Link href="/checkin">
            <Plus data-icon="inline-start" />
            {t("newCheckin")}
          </Link>
        </Button>
      </div>
    );
  }

  const grouped = new Map<BoardGroup, typeof cases>();
  for (const repairCase of cases) {
    const group = boardGroupFor(repairCase.status, repairCase.jobs);
    grouped.set(group, [...(grouped.get(group) ?? []), repairCase]);
  }

  const dueChips = (balance: ReturnType<typeof caseBalance>, tone: string) =>
    ([
      ["CUSTOMER", balance.customer] as const,
      ["INSURER", balance.insurer] as const,
    ]).map(([side, sideBalance]) =>
      sideBalance.dueSatang > 0 ? (
        <span key={side} className={`num border px-1.5 py-px text-[10.5px] ${tone}`}>
          {tp("dueChip", {
            payer: tp(`payer.${side}`),
            amount: formatBaht(sideBalance.dueSatang),
          })}
        </span>
      ) : null,
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center">
        <span className="num text-xs text-muted-foreground">
          {t("openCount", { count: cases.length })}
        </span>
        <Button asChild className="ml-auto font-semibold">
          <Link href="/checkin">
            <Plus data-icon="inline-start" />
            {t("newCheckin")}
          </Link>
        </Button>
      </div>

      {BOARD_GROUPS.map((group) => {
        if (group === "BALANCE_DUE") {
          if (balanceRows.length === 0) return null;
          return (
            <section key={group} className="relative border bg-card">
              <CornerTicks />
              <header className="flex items-center gap-2 border-b border-dashed px-3.5 py-2">
                <h2 className="eyebrow">{t(`groups.${group}`)}</h2>
                <span className="num border border-border-strong px-1.5 text-[10.5px] text-primary">
                  {balanceRows.length}
                </span>
                <span className="num ml-auto text-[10.5px] text-bad">
                  {t("balanceTotal", {
                    amount: formatBaht(
                      balanceRows.reduce((sum, row) => sum + row.balance.totalDueSatang, 0),
                    ),
                  })}
                </span>
              </header>
              <table className="w-full text-sm">
                <tbody>
                  {balanceRows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-dashed last:border-0 hover:bg-surface-2"
                    >
                      <td className="w-0 px-3.5 py-2.5">
                        <Link
                          href={`/cases/${row.id}`}
                          className="font-mono text-[13px] font-semibold text-primary hover:underline"
                        >
                          {row.reference}
                        </Link>
                      </td>
                      <td className="w-0 px-3.5 py-2.5 whitespace-nowrap">
                        <span className="border border-border-strong px-1.5 py-px font-mono text-[11px]">
                          {row.vehicle.plate}
                        </span>
                        {(row.vehicle.make || row.vehicle.model) && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {[row.vehicle.make, row.vehicle.model].filter(Boolean).join(" ")}
                          </span>
                        )}
                      </td>
                      <td className="w-0 px-3.5 py-2.5 whitespace-nowrap">
                        {row.contactCustomer.name}
                        <span className="num ml-2 text-xs text-muted-foreground">
                          {formatPhone(row.contactCustomer.phone)}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {dueChips(row.balance, "border-bad/45 text-bad")}
                        </span>
                      </td>
                      <td className="num w-0 px-3.5 py-2.5 text-right text-xs whitespace-nowrap text-muted-foreground">
                        {row.deliveredAt &&
                          t("deliveredAgo", { when: format.relativeTime(row.deliveredAt) })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        }

        const rows = grouped.get(group);
        if (!rows?.length) return null;
        return (
          <section key={group} className="relative border bg-card">
            <CornerTicks />
            <header className="flex items-center gap-2 border-b border-dashed px-3.5 py-2">
              <h2 className="eyebrow">{t(`groups.${group}`)}</h2>
              <span className="num border border-border-strong px-1.5 text-[10.5px] text-primary">
                {rows.length}
              </span>
            </header>
            <table className="w-full text-sm">
              <tbody>
                {rows.map((repairCase) => {
                  // Waiting-(Parts) rows surface what they wait for (§5):
                  // the M4 part lines of the waiting jobs, plus nearest ETA.
                  const partsWaitingLines = repairCase.jobs
                    .filter((job) => job.status === "WAITING" && job.waitingReason === "PARTS")
                    .flatMap((job) => job.partLines);
                  const partsArrived = partsWaitingLines.filter(
                    (line) => line.orderStatus === "ARRIVED",
                  ).length;
                  const nextEta = partsWaitingLines
                    .filter((line) => line.orderStatus !== "ARRIVED" && line.etaDate)
                    .map((line) => line.etaDate!)
                    .sort((a, b) => a.getTime() - b.getTime())[0];
                  const technicians = [
                    ...new Set(
                      repairCase.jobs
                        .filter((job) => isActiveJob(job.status) && job.assignedStaff)
                        .map((job) => job.assignedStaff!.name),
                    ),
                  ];
                  // Ready rows show what to collect at handover (M7 ruling 1).
                  const balance =
                    group === "READY"
                      ? caseBalance(repairCase.jobs, repairCase.payments)
                      : null;
                  return (
                    <tr
                      key={repairCase.id}
                      className="border-b border-dashed last:border-0 hover:bg-surface-2"
                    >
                      <td className="w-0 px-3.5 py-2.5">
                        <span className="flex items-center gap-2">
                          <Link
                            href={`/cases/${repairCase.id}`}
                            className="font-mono text-[13px] font-semibold text-primary hover:underline"
                          >
                            {repairCase.reference}
                          </Link>
                          {repairCase.status === "READY" && (
                            <CaseStatusBadge status={repairCase.status} />
                          )}
                        </span>
                      </td>
                      <td className="w-0 px-3.5 py-2.5 whitespace-nowrap">
                        <span className="border border-border-strong px-1.5 py-px font-mono text-[11px]">
                          {repairCase.vehicle.plate}
                        </span>
                        {(repairCase.vehicle.make || repairCase.vehicle.model) && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {[repairCase.vehicle.make, repairCase.vehicle.model]
                              .filter(Boolean)
                              .join(" ")}
                          </span>
                        )}
                      </td>
                      <td className="w-0 px-3.5 py-2.5 whitespace-nowrap">
                        {repairCase.contactCustomer.name}
                        <span className="num ml-2 text-xs text-muted-foreground">
                          {formatPhone(repairCase.contactCustomer.phone)}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <JobRollupChips jobs={repairCase.jobs} />
                          {balance && dueChips(balance, "border-warn/45 text-warn")}
                        </span>
                        {(partsWaitingLines.length > 0 || technicians.length > 0) && (
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-faint">
                            {partsWaitingLines.length > 0 && (
                              <span className="num">
                                {t("partsProgress", {
                                  arrived: partsArrived,
                                  total: partsWaitingLines.length,
                                })}
                                {nextEta &&
                                  ` · ${t("partsEta", {
                                    date: format.dateTime(nextEta, {
                                      day: "numeric",
                                      month: "short",
                                    }),
                                  })}`}
                              </span>
                            )}
                            {technicians.length > 0 && <span>{technicians.join(" · ")}</span>}
                          </span>
                        )}
                      </td>
                      <td className="num w-0 px-3.5 py-2.5 text-right text-xs whitespace-nowrap text-muted-foreground">
                        {format.relativeTime(repairCase.checkedInAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
