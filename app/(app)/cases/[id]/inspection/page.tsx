import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CaseStatusBadge } from "@/components/blocks/case-status-badge";
import { formatPhone } from "@/lib/normalize";
import type { FindingDto } from "@/lib/inspection";
import { isLineFrozen } from "@/lib/offer";
import { tenantDb } from "@/lib/session";
import { InspectionScreen } from "./inspection-screen";

// Inspection screen (M3 brief §5): the two capture surfaces on one page.
// Reachable any time the case isn't DELIVERED — mid-repair discoveries land
// here as new Findings on the same case (CONTEXT.md).
export default async function InspectionPage({
  params,
}: PageProps<"/cases/[id]/inspection">) {
  const { id } = await params;
  const [t, db] = await Promise.all([getTranslations("inspection"), tenantDb()]);

  const repairCase = await db.repairCase.findUnique({
    where: { id },
    include: {
      vehicle: true,
      contactCustomer: true,
      findings: {
        orderBy: { recordedAt: "asc" },
        include: {
          recordedBy: { select: { name: true } },
          photos: { select: { id: true }, orderBy: { capturedAt: "asc" } },
          // The freeze point (D-24): a Finding on a priced or sent line.
          job: {
            select: {
              status: true,
              priceSatang: true,
              _count: { select: { quotationLines: true } },
            },
          },
        },
      },
    },
  });
  if (!repairCase) notFound();

  const { vehicle, contactCustomer } = repairCase;
  const descriptors = [vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ");
  const findings: FindingDto[] = repairCase.findings.map((f) => ({
    id: f.id,
    source: f.source,
    zone: f.zone,
    checklistItem: f.checklistItem,
    damageTypes: f.damageTypes,
    condition: f.condition,
    proposedActions: f.proposedActions,
    note: f.note,
    jobId: f.jobId,
    frozen:
      f.job != null &&
      isLineFrozen({
        status: f.job.status,
        priceSatang: f.job.priceSatang,
        quotationLineCount: f.job._count.quotationLines,
      }),
    recordedAt: f.recordedAt.toISOString(),
    recordedByName: f.recordedBy.name,
    confirmedAt: f.confirmedAt?.toISOString() ?? null,
    photos: f.photos,
  }));

  // M4: findings show which Job fulfils them ("→ left-side repaint").
  const jobs = await db.job.findMany({
    where: { caseId: repairCase.id },
    select: { id: true, title: true },
  });
  const jobTitles = Object.fromEntries(jobs.map((job) => [job.id, job.title]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/cases/${repairCase.id}`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t("backToCase")}
        </Link>
        <span className="font-mono text-lg font-semibold">
          <span className="text-primary">{repairCase.reference}</span>
        </span>
        <span className="border border-border-strong px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {vehicle.plate}
          {vehicle.province ? ` ${vehicle.province}` : ""}
        </span>
        {descriptors && (
          <span className="border px-2 py-0.5 text-xs text-muted-foreground">{descriptors}</span>
        )}
        <span className="border px-2 py-0.5 text-xs text-muted-foreground">
          {contactCustomer.name}
          <span className="num ml-1.5 text-faint">{formatPhone(contactCustomer.phone)}</span>
        </span>
        <CaseStatusBadge status={repairCase.status} />
      </div>

      <InspectionScreen
        caseId={repairCase.id}
        bodyType={vehicle.bodyType}
        initialFindings={findings}
        jobTitles={jobTitles}
        readOnly={repairCase.status === "DELIVERED"}
      />
    </div>
  );
}
