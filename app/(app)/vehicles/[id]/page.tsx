import { ArrowLeft, Camera, Car, Pencil, Wrench } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CaseStatusBadge } from "@/components/blocks/case-status-badge";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/normalize";
import { tenantDb } from "@/lib/session";

// Vehicle detail (M7 brief §8): the PHYSICAL half of the history split (M7
// ruling 6) — every Repair Case chronologically ACROSS OWNERS: work done,
// parts replaced, photos. Deliberately NO money anywhere on this view:
// prices and Payments are relationship data and stay with the person, so a
// car's new owner never sees what the previous owner paid. Case pages stay
// full-detail for staff — the split governs the history views, not access.
export default async function VehiclePage({ params }: PageProps<"/vehicles/[id]">) {
  const { id } = await params;
  const [t, tc, tj, format, db] = await Promise.all([
    getTranslations("vehicles"),
    getTranslations("common"),
    getTranslations("jobStatus"),
    getFormatter(),
    tenantDb(),
  ]);

  const vehicle = await db.vehicle.findUnique({
    where: { id },
    include: { primaryCustomer: { select: { id: true, name: true, phone: true } } },
  });
  if (!vehicle) notFound();

  const cases = await db.repairCase.findMany({
    where: { vehicleId: id },
    select: {
      id: true,
      reference: true,
      status: true,
      checkedInAt: true,
      deliveredAt: true,
      odometerKm: true,
      _count: { select: { photos: true } },
      jobs: {
        select: {
          id: true,
          title: true,
          status: true,
          partLines: { select: { id: true, name: true, quantity: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { checkedInAt: "desc" },
    take: 50,
  });

  const descriptors = [vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ");
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
            <div className="flex items-center gap-2">
              <Car className="size-4 text-muted-foreground" aria-hidden />
              <span className="border border-border-strong px-2 py-0.5 font-mono text-[15px]">
                {vehicle.plate}
              </span>
              {vehicle.province && (
                <span className="text-xs text-muted-foreground">{vehicle.province}</span>
              )}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {t(`bodyTypes.${vehicle.bodyType}`)}
              {descriptors && ` · ${descriptors}`}
            </p>
            {vehicle.vin && (
              <p className="num mt-1 text-xs text-muted-foreground">
                {t("vin")} · {vehicle.vin}
              </p>
            )}
            <p className="mt-2 text-xs">
              <span className="eyebrow mr-2">{t("owner")}</span>
              <Link
                href={`/customers/${vehicle.primaryCustomer.id}`}
                className="hover:text-primary"
              >
                {vehicle.primaryCustomer.name}
              </Link>
              <span className="num ml-2 text-muted-foreground">
                {formatPhone(vehicle.primaryCustomer.phone)}
              </span>
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="ml-auto">
            <Link href={`/vehicles/${vehicle.id}/edit`}>
              <Pencil data-icon="inline-start" />
              {tc("edit")}
            </Link>
          </Button>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="eyebrow">{t("historyTitle")}</h3>
          <span className="text-[10.5px] text-faint">{t("historyHint")}</span>
        </div>
        {cases.length === 0 ? (
          <p className="border border-dashed px-3.5 py-3 text-xs text-faint">
            {t("historyEmpty")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {cases.map((repairCase) => {
              // Physical truth: the work that was actually done, and the
              // parts that went in with it.
              const completedJobs = repairCase.jobs.filter((job) => job.status === "COMPLETED");
              const partsReplaced = completedJobs.flatMap((job) => job.partLines);
              return (
                <div key={repairCase.id} className="border bg-card">
                  <div className="flex flex-wrap items-center gap-2.5 border-b border-dashed px-3.5 py-2">
                    <Link
                      href={`/cases/${repairCase.id}`}
                      className="font-mono text-[13px] font-semibold text-primary hover:underline"
                    >
                      {repairCase.reference}
                    </Link>
                    <CaseStatusBadge status={repairCase.status} />
                    {repairCase.odometerKm != null && (
                      <span className="num text-[10.5px] text-muted-foreground">
                        {format.number(repairCase.odometerKm)} km
                      </span>
                    )}
                    <span className="num ml-auto text-[10.5px] text-faint">
                      {shortDate(repairCase.checkedInAt)}
                      {repairCase.deliveredAt && ` → ${shortDate(repairCase.deliveredAt)}`}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 px-3.5 py-2.5 text-xs">
                    {repairCase.jobs.length === 0 ? (
                      <span className="text-faint">{t("historyNoWork")}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {repairCase.jobs.map((job) => (
                          <span
                            key={job.id}
                            className={
                              job.status === "COMPLETED"
                                ? "flex items-center gap-1 border border-ok/45 px-1.5 py-px text-ok"
                                : "flex items-center gap-1 border border-border-strong px-1.5 py-px text-faint"
                            }
                          >
                            <Wrench className="size-3" aria-hidden />
                            {job.title}
                            {job.status !== "COMPLETED" && (
                              <span className="font-mono text-[9px] tracking-wider">
                                {tj(job.status)}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    {partsReplaced.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {t("partsReplaced")}
                        {" · "}
                        {partsReplaced
                          .map(
                            (line) =>
                              `${line.name}${line.quantity > 1 ? ` ×${line.quantity}` : ""}`,
                          )
                          .join(" · ")}
                      </p>
                    )}
                    {repairCase._count.photos > 0 && (
                      <p className="flex items-center gap-1 text-[10.5px] text-faint">
                        <Camera className="size-3" aria-hidden />
                        {t("photoCount", { count: repairCase._count.photos })}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
