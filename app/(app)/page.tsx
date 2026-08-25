import { CarFront, Plus } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CaseStatusBadge } from "@/components/blocks/case-status-badge";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/normalize";
import { tenantDb } from "@/lib/session";

// M2 board (brief §7): a plain list of open cases so check-in has a visible
// result. Deliberately NOT the attention-grouped board — that is M5 (D-2),
// once Jobs exist to derive attention from.
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
    },
    orderBy: { checkedInAt: "desc" },
    take: 100,
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center">
        <Button asChild className="ml-auto font-semibold">
          <Link href="/checkin">
            <Plus data-icon="inline-start" />
            {t("newCheckin")}
          </Link>
        </Button>
      </div>
      <div className="relative border bg-card">
        <CornerTicks />
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="eyebrow px-3.5 py-2.5 font-medium">{t("columns.case")}</th>
              <th className="eyebrow px-3.5 py-2.5 font-medium">{t("columns.vehicle")}</th>
              <th className="eyebrow px-3.5 py-2.5 font-medium">{t("columns.contact")}</th>
              <th className="eyebrow px-3.5 py-2.5 text-right font-medium">
                {t("columns.checkedIn")}
              </th>
            </tr>
          </thead>
          <tbody>
            {cases.map((repairCase) => (
              <tr
                key={repairCase.id}
                className="border-b border-dashed last:border-0 hover:bg-surface-2"
              >
                <td className="px-3.5 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <Link
                      href={`/cases/${repairCase.id}`}
                      className="font-mono text-[13px] font-semibold text-primary hover:underline"
                    >
                      {repairCase.reference}
                    </Link>
                    <CaseStatusBadge status={repairCase.status} />
                  </span>
                </td>
                <td className="px-3.5 py-2.5">
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
                <td className="px-3.5 py-2.5">
                  {repairCase.contactCustomer.name}
                  <span className="num ml-2 text-xs text-muted-foreground">
                    {formatPhone(repairCase.contactCustomer.phone)}
                  </span>
                </td>
                <td className="num px-3.5 py-2.5 text-right text-xs text-muted-foreground">
                  {format.relativeTime(repairCase.checkedInAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
