import { ArrowLeft, Car, Crosshair, NotebookPen, User } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CaseStatusBadge } from "@/components/blocks/case-status-badge";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { findingSeverity } from "@/lib/inspection";
import { formatPhone } from "@/lib/normalize";
import { tenantDb } from "@/lib/session";

// Repair Case page (M2 brief §6, M3 brief §6): the check-in landing, now with
// the Inspection summary. M4+ add Jobs and money. Walkaround photos are the
// case-level ones (findingId null); Finding photos live with their Findings
// on the inspection screen.
export default async function CasePage({ params }: PageProps<"/cases/[id]">) {
  const { id } = await params;
  const [t, tv, tc, ti, format, db] = await Promise.all([
    getTranslations("cases"),
    getTranslations("vehicles"),
    getTranslations("common"),
    getTranslations("inspection"),
    getFormatter(),
    tenantDb(),
  ]);

  const repairCase = await db.repairCase.findUnique({
    where: { id },
    include: {
      vehicle: { include: { primaryCustomer: true } },
      contactCustomer: true,
      openedByStaff: true,
      photos: { where: { findingId: null }, orderBy: { capturedAt: "asc" } },
      findings: {
        select: {
          source: true,
          damageTypes: true,
          condition: true,
          recordedAt: true,
          _count: { select: { photos: true } },
        },
        orderBy: { recordedAt: "desc" },
      },
    },
  });
  if (!repairCase) notFound();

  const { vehicle, contactCustomer, photos, findings } = repairCase;
  const contactIsPrimary = contactCustomer.id === vehicle.primaryCustomerId;
  const descriptors = [vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ");
  const severe = findings.filter((f) => findingSeverity(f) === "SEVERE").length;
  const checklistCount = findings.filter((f) => f.source === "CHECKLIST").length;
  const findingPhotoCount = findings.reduce((sum, f) => sum + f._count.photos, 0);
  const lastRecorded = findings[0]?.recordedAt;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link
        href="/"
        className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {tc("back")}
      </Link>

      <div className="relative border bg-card p-5">
        <CornerTicks />
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xl font-semibold text-primary">
            {repairCase.reference}
          </span>
          <CaseStatusBadge status={repairCase.status} />
          <span className="ml-auto text-right">
            <span className="eyebrow block">{t("checkedInAt")}</span>
            <span className="font-mono text-xs">
              {format.dateTime(repairCase.checkedInAt, {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("openedBy")} · {repairCase.openedByStaff.name}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="border bg-card p-4">
          <h3 className="eyebrow mb-2.5 flex items-center gap-1.5">
            <Car className="size-3.5" aria-hidden />
            {t("vehicle")}
          </h3>
          <div className="flex items-center gap-2">
            <span className="border border-border-strong px-2 py-0.5 font-mono text-[15px]">
              {vehicle.plate}
            </span>
            {vehicle.province && (
              <span className="text-xs text-muted-foreground">{vehicle.province}</span>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {tv(`bodyTypes.${vehicle.bodyType}`)}
            {descriptors && ` · ${descriptors}`}
          </p>
          {repairCase.odometerKm != null && (
            <p className="num mt-1.5 text-xs text-muted-foreground">
              {t("odometer")} · {t("odometerValue", { km: format.number(repairCase.odometerKm) })}
            </p>
          )}
        </section>

        <section className="border bg-card p-4">
          <h3 className="eyebrow mb-2.5 flex items-center gap-1.5">
            <User className="size-3.5" aria-hidden />
            {t("contact")}
          </h3>
          <Link
            href={`/customers/${contactCustomer.id}`}
            className="font-medium hover:text-primary"
          >
            {contactCustomer.name}
          </Link>
          {contactCustomer.company && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              · {contactCustomer.company}
            </span>
          )}
          <p className="num mt-1 text-[13px]">{formatPhone(contactCustomer.phone)}</p>
          {!contactIsPrimary && (
            <div className="mt-3 border-t border-dashed pt-2.5">
              <span className="eyebrow">{t("primaryCustomer")}</span>
              <p className="mt-1 text-sm">
                <Link
                  href={`/customers/${vehicle.primaryCustomer.id}`}
                  className="hover:text-primary"
                >
                  {vehicle.primaryCustomer.name}
                </Link>
                <span className="num ml-2 text-xs text-muted-foreground">
                  {formatPhone(vehicle.primaryCustomer.phone)}
                </span>
              </p>
            </div>
          )}
        </section>
      </div>

      {repairCase.note && (
        <section className="border border-dashed bg-card/50 p-4">
          <h3 className="eyebrow mb-1.5 flex items-center gap-1.5">
            <NotebookPen className="size-3.5" aria-hidden />
            {t("note")}
          </h3>
          <p className="whitespace-pre-wrap text-sm">{repairCase.note}</p>
        </section>
      )}

      <section className="relative border bg-card p-4">
        <CornerTicks />
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="eyebrow flex items-center gap-1.5">
            <Crosshair className="size-3.5" aria-hidden />
            {ti("summaryTitle")}
          </h3>
          <Link
            href={`/cases/${repairCase.id}/inspection`}
            className="ml-auto border border-primary-dim px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
          >
            {ti("openInspection")} →
          </Link>
        </div>
        {findings.length === 0 ? (
          <p className="mt-2.5 text-xs text-faint">{ti("notInspected")}</p>
        ) : (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            <span className="font-medium">
              {ti("summaryFindings", { count: findings.length })}
            </span>
            {severe > 0 && (
              <span className="hatch-soft border border-bad/45 px-1.5 py-px text-bad">
                {ti("summarySevere", { count: severe })}
              </span>
            )}
            {findings.length - severe > 0 && (
              <span className="hatch-soft border border-warn/45 px-1.5 py-px text-warn">
                {ti("summaryMinor", { count: findings.length - severe })}
              </span>
            )}
            {checklistCount > 0 && (
              <span className="border border-border-strong px-1.5 py-px text-muted-foreground">
                {ti("summaryChecklist", { count: checklistCount })}
              </span>
            )}
            <span className="text-muted-foreground">
              {ti("summaryPhotos", { count: findingPhotoCount })}
            </span>
            {lastRecorded && (
              <span className="num ml-auto text-[11px] text-faint">
                {ti("lastRecorded")} ·{" "}
                {format.dateTime(lastRecorded, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">
          {t("photos")}
          {photos.length > 0 && <span className="num ml-1.5">({photos.length})</span>}
        </h3>
        {photos.length === 0 ? (
          <p className="border border-dashed px-3.5 py-3 text-xs text-faint">{t("noPhotos")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {photos.map((photo, index) => (
              <a
                key={photo.id}
                href={`/api/photos/${photo.id}`}
                target="_blank"
                rel="noreferrer"
                className="group relative border bg-surface-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- bytes come from our authenticated route; next/image optimization would re-fetch without the session cookie */}
                <img
                  src={`/api/photos/${photo.id}`}
                  alt={t("photoAlt", { n: index + 1 })}
                  loading="lazy"
                  className="aspect-square w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                />
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
