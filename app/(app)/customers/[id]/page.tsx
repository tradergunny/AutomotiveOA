import { ArrowLeft, Car, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CaseStatusBadge } from "@/components/blocks/case-status-badge";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/normalize";
import { tenantDb } from "@/lib/session";

// Customer detail (M2 brief §3): basic info + their Vehicles + their cases.
// Spending/visit history views are deliberately M7 (the history split).
export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const [t, tv, tc, format, db] = await Promise.all([
    getTranslations("customers"),
    getTranslations("vehicles"),
    getTranslations("common"),
    getFormatter(),
    tenantDb(),
  ]);

  const customer = await db.customer.findUnique({
    where: { id },
    include: { primaryVehicles: { orderBy: { createdAt: "asc" } } },
  });
  if (!customer) notFound();

  const cases = await db.repairCase.findMany({
    where: { OR: [{ contactCustomerId: id }, { vehicle: { primaryCustomerId: id } }] },
    include: { vehicle: { select: { plate: true } } },
    orderBy: { checkedInAt: "desc" },
    take: 20,
  });

  const shortDate = (date: Date) =>
    format.dateTime(date, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link
        href="/customers"
        className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {tc("back")}
      </Link>

      <div className="relative border bg-card p-5">
        <CornerTicks />
        <div className="flex items-start gap-3">
          <div>
            <h2 className="text-lg font-semibold">{customer.name}</h2>
            {customer.company && (
              <p className="text-sm text-muted-foreground">{customer.company}</p>
            )}
            <p className="num mt-1.5 text-[13px]">{formatPhone(customer.phone)}</p>
            {customer.note && (
              <p className="mt-2 border-l-2 border-border-strong pl-2.5 text-xs text-muted-foreground">
                {customer.note}
              </p>
            )}
          </div>
          <span className="ml-auto font-mono text-[10px] text-faint">
            {shortDate(customer.createdAt)}
          </span>
          <Button asChild variant="outline" size="sm">
            <Link href={`/customers/${customer.id}/edit`}>
              <Pencil data-icon="inline-start" />
              {tc("edit")}
            </Link>
          </Button>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="eyebrow">{t("vehicles")}</h3>
          <Button asChild variant="outline" size="xs" className="ml-auto">
            <Link href={`/vehicles/new?for=${customer.id}`}>
              <Plus data-icon="inline-start" />
              {t("addVehicle")}
            </Link>
          </Button>
        </div>
        {customer.primaryVehicles.length === 0 ? (
          <p className="border border-dashed px-3.5 py-3 text-xs text-faint">{t("noVehicles")}</p>
        ) : (
          <div className="border bg-card">
            {customer.primaryVehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                className="flex items-center gap-3 border-b border-dashed px-3.5 py-2.5 last:border-0"
              >
                <Car className="size-4 text-faint" aria-hidden />
                <span className="border border-border-strong px-2 py-0.5 font-mono text-[13px]">
                  {vehicle.plate}
                </span>
                {vehicle.province && (
                  <span className="text-xs text-muted-foreground">{vehicle.province}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {tv(`bodyTypes.${vehicle.bodyType}`)}
                  {[vehicle.make, vehicle.model, vehicle.color].filter(Boolean).length > 0 &&
                    ` · ${[vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ")}`}
                </span>
                <Link
                  href={`/vehicles/${vehicle.id}/edit`}
                  className="ml-auto text-xs text-muted-foreground hover:text-primary"
                >
                  {tc("edit")}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">{t("cases")}</h3>
        {cases.length === 0 ? (
          <p className="border border-dashed px-3.5 py-3 text-xs text-faint">{t("noCases")}</p>
        ) : (
          <div className="border bg-card">
            {cases.map((repairCase) => (
              <Link
                key={repairCase.id}
                href={`/cases/${repairCase.id}`}
                className="flex items-center gap-3 border-b border-dashed px-3.5 py-2.5 last:border-0 hover:bg-surface-2"
              >
                <span className="font-mono text-[13px] font-medium text-primary">
                  {repairCase.reference}
                </span>
                <span className="border border-border-strong px-1.5 py-px font-mono text-[11px]">
                  {repairCase.vehicle.plate}
                </span>
                <CaseStatusBadge status={repairCase.status} />
                <span className="ml-auto font-mono text-[10px] text-faint">
                  {shortDate(repairCase.checkedInAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
