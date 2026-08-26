import { CarFront, Plus } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CaseStatusBadge } from "@/components/blocks/case-status-badge";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { JobRollupChips } from "@/components/blocks/job-rollup";
import { Button } from "@/components/ui/button";
import { boardGroupFor, BOARD_GROUPS, isActiveJob, type BoardGroup } from "@/lib/case-flow";
import { formatPhone } from "@/lib/normalize";
import { tenantDb } from "@/lib/session";

// The Case Board (M5 brief §5, DESIGN.md D-2): every open case exactly once,
// grouped by what needs a human, In assessment leading as the catch-all.
// Balance due arrives with M7's Payments; Delivered cases leave the board.
// No kanban — placement is derived (ruling 4c), so there is nothing to drag.
export default async function BoardPage() {
  const [t, format, db] = await Promise.all([
    getTranslations("board"),
    getFormatter(),
    tenantDb(),
  ]);

  const cases = await db.repairCase.findMany({
    where: { status: { not: "DELIVERED" } },
    include: {
      vehicle: { select: { plate: true, make: true, model: true } },
      contactCustomer: { select: { name: true, phone: true } },
      jobs: {
        select: {
          status: true,
          waitingReason: true,
          assignedStaff: { select: { name: true } },
          partLines: { select: { orderStatus: true, etaDate: true } },
        },
      },
    },
    orderBy: { checkedInAt: "asc" }, // oldest first — the stalest car needs the eyes
    take: 200,
  });

  if (cases.length === 0) {
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
                        <JobRollupChips jobs={repairCase.jobs} />
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
