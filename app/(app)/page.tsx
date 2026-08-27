import { CarFront, Plus, Truck } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { JobRollupLine } from "@/components/blocks/job-rollup";
import { Button } from "@/components/ui/button";
import { boardGroupFor, BOARD_GROUPS, isActiveJob, type BoardGroup } from "@/lib/case-flow";
import type { BodyType } from "@/lib/generated/prisma/enums";
import { formatBaht } from "@/lib/money";
import { formatPhone } from "@/lib/normalize";
import { caseBalance } from "@/lib/payments";
import { tenantDb } from "@/lib/session";

// The Case Board (M5 brief §5, DESIGN.md D-2): every open case exactly once,
// grouped by what needs a human, In assessment leading as the catch-all.
// No kanban — placement is derived (ruling 4c), so there is nothing to drag.
// M7 (ruling 1) adds the trailing Balance-due group: delivered cases still
// owed money — rendered for money, not work — until their balance clears.
// M7.5 (D-8/D-9): rows wear the car's face (first walkaround photo), carry
// at most one chip (the waiting reason), and speak the rollup as a sentence.
// Grouping, precedence, and the Balance-due rendering are untouched.

/** First check-in walkaround shot (D-9), or the body-type icon. */
function CarThumb({
  photoId,
  bodyType,
  plate,
  alt,
}: {
  photoId: string | undefined;
  bodyType: BodyType;
  plate: string;
  alt: string;
}) {
  if (photoId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- authenticated route; next/image would re-fetch without the session cookie
      <img
        src={`/api/photos/${photoId}`}
        alt={`${alt} ${plate}`}
        loading="lazy"
        className="size-10 flex-none border object-cover"
      />
    );
  }
  const Icon = bodyType === "PICKUP" ? Truck : CarFront;
  return (
    <span className="flex size-10 flex-none items-center justify-center border bg-surface-2">
      <Icon className="size-4.5 text-faint" aria-hidden />
    </span>
  );
}

export default async function BoardPage() {
  const [t, tc, tp, twr, format, db] = await Promise.all([
    getTranslations("board"),
    getTranslations("cases"),
    getTranslations("payments"),
    getTranslations("waitingReasons"),
    getFormatter(),
    tenantDb(),
  ]);

  const walkaroundPhoto = {
    where: { findingId: null, jobId: null },
    orderBy: { capturedAt: "asc" },
    take: 1,
    select: { id: true },
  } as const;

  const [cases, deliveredCases] = await Promise.all([
    db.repairCase.findMany({
      where: { status: { not: "DELIVERED" } },
      include: {
        vehicle: { select: { plate: true, make: true, model: true, bodyType: true } },
        contactCustomer: { select: { name: true, phone: true } },
        photos: walkaroundPhoto,
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
        vehicle: { select: { plate: true, make: true, model: true, bodyType: true } },
        contactCustomer: { select: { name: true, phone: true } },
        photos: walkaroundPhoto,
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

  /* Money as a sentence of tinted words, never chips (D-8). */
  const dueLine = (balance: ReturnType<typeof caseBalance>, tone: string) => {
    const parts = ([
      ["CUSTOMER", balance.customer] as const,
      ["INSURER", balance.insurer] as const,
    ])
      .filter(([, side]) => side.dueSatang > 0)
      .map(([side, sideBalance]) =>
        tp("dueChip", {
          payer: tp(`payer.${side}`),
          amount: formatBaht(sideBalance.dueSatang),
        }),
      );
    if (parts.length === 0) return null;
    return <span className={`num text-[11px] ${tone}`}>{parts.join(" · ")}</span>;
  };

  const identityCells = (row: {
    id: string;
    reference: string;
    vehicle: { plate: string; make: string | null; model: string | null; bodyType: BodyType };
    contactCustomer: { name: string; phone: string };
    photos: { id: string }[];
  }) => (
    <>
      <td className="w-0 py-2 pl-3.5 pr-0">
        <CarThumb
          photoId={row.photos[0]?.id}
          bodyType={row.vehicle.bodyType}
          plate={row.vehicle.plate}
          alt={tc("carPhotoAlt", { plate: row.vehicle.plate })}
        />
      </td>
      <td className="w-0 px-3.5 py-2 whitespace-nowrap">
        <Link
          href={`/cases/${row.id}`}
          className="font-mono text-[13px] font-semibold text-primary hover:underline"
        >
          {row.reference}
        </Link>
      </td>
      <td className="w-0 px-3.5 py-2 whitespace-nowrap">
        <span className="border border-border-strong px-1.5 py-px font-mono text-[11px]">
          {row.vehicle.plate}
        </span>
        {(row.vehicle.make || row.vehicle.model) && (
          <span className="ml-2 text-xs text-muted-foreground">
            {[row.vehicle.make, row.vehicle.model].filter(Boolean).join(" ")}
          </span>
        )}
      </td>
      <td className="w-0 px-3.5 py-2 whitespace-nowrap">
        {row.contactCustomer.name}
        <span className="num ml-2 text-xs text-muted-foreground">
          {formatPhone(row.contactCustomer.phone)}
        </span>
      </td>
    </>
  );

  return (
    <div className="flex flex-col gap-5">
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
              <header className="flex items-baseline gap-2.5 border-b border-dashed px-3.5 py-2.5">
                <h2 className="text-[12.5px] font-semibold">{t(`groups.${group}`)}</h2>
                <span className="num text-[11px] text-faint">{balanceRows.length}</span>
                <span className="num ml-auto text-[11px] text-bad">
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
                      {identityCells(row)}
                      <td className="px-3.5 py-2">
                        {dueLine(row.balance, "text-bad")}
                      </td>
                      <td className="num w-0 px-3.5 py-2 text-right text-xs whitespace-nowrap text-muted-foreground">
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
            <header className="flex items-baseline gap-2.5 border-b border-dashed px-3.5 py-2.5">
              <h2 className="text-[12.5px] font-semibold">{t(`groups.${group}`)}</h2>
              <span className="num text-[11px] text-faint">{rows.length}</span>
            </header>
            <table className="w-full text-sm">
              <tbody>
                {rows.map((repairCase) => {
                  // Waiting-(Parts) rows surface what they wait for (§5):
                  // the M4 part lines of the waiting jobs, plus nearest ETA.
                  const waitingJobs = repairCase.jobs.filter((job) => job.status === "WAITING");
                  const partsWaitingLines = waitingJobs
                    .filter((job) => job.waitingReason === "PARTS")
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
                  // The row's one chip (D-8): the waiting reason — the only
                  // state the group name doesn't already say.
                  const waitingReason =
                    group === "WAITING" ? (waitingJobs[0]?.waitingReason ?? "OTHER") : null;
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
                      {identityCells(repairCase)}
                      <td className="px-3.5 py-2">
                        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                          {waitingReason && (
                            <span className="hatch-soft inline-flex items-center self-center border border-warn/50 px-1.5 py-px font-mono text-[10px] tracking-[0.08em] whitespace-nowrap text-warn">
                              {twr(waitingReason)}
                            </span>
                          )}
                          {/* The chip already says Waiting — the sentence
                              carries only what it doesn't. */}
                          <JobRollupLine
                            jobs={
                              waitingReason
                                ? repairCase.jobs.filter((job) => job.status !== "WAITING")
                                : repairCase.jobs
                            }
                          />
                          {balance && dueLine(balance, "text-warn")}
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
                      <td className="num w-0 px-3.5 py-2 text-right text-xs whitespace-nowrap text-muted-foreground">
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
