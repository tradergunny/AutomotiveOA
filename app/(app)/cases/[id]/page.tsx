import { ArrowLeft, Car, Crosshair, NotebookPen, User } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CaseStatusBadge } from "@/components/blocks/case-status-badge";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { JobRollupChips } from "@/components/blocks/job-rollup";
import { hasActiveWork } from "@/lib/case-flow";
import { LINE_MAX_PHOTOS_PER_UPDATE } from "@/lib/line";
import { buildDraftBody, buildFollowUpDraftBody } from "@/lib/line-draft";
import { findingSeverity } from "@/lib/inspection";
import { formatBaht } from "@/lib/money";
import { formatPhone } from "@/lib/normalize";
import { caseBalance } from "@/lib/payments";
import { can } from "@/lib/permissions";
import { requireSession, tenantDb } from "@/lib/session";
import { CaseFlowPanel } from "./case-flow-panel";
import { CASE_EVENT_INCLUDE, CaseTimeline } from "./case-timeline";
import {
  CustomerTimeline,
  type ComposerFollowUp,
  type SendBlockedReason,
} from "./customer-timeline";
import { JOB_INCLUDE, QUOTATION_INCLUDE, toJobDto, toQuotationDto } from "./job-dto";
import { JobsPanel } from "./jobs-panel";
import { PAYMENT_INCLUDE, toPaymentDto } from "./payment-dto";
import { PaymentsPanel } from "./payments-panel";

// Repair Case page (M2 brief §6, M3 brief §6, M4 brief §7, M5 brief §6–§7):
// the check-in landing with the Inspection summary, the Jobs & money section,
// the real case status — derived rollup in the header, Mark ready / Mark
// delivered — the internal timeline, and (M6 brief §6, §9) the Customer
// Timeline beside it: the curated half, composed and sent by a human
// (ADR-003). M7 adds the money section (split balance + payment ledger,
// live on DELIVERED cases) and the Follow-up deep link into the composer,
// which now works on DELIVERED cases too (M7 ruling 5). Walkaround photos are the
// case-level ones (findingId AND jobId null); Finding/Job photos live with
// their Findings and Jobs.
export default async function CasePage({
  params,
  searchParams,
}: PageProps<"/cases/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [t, tv, tc, ti, tp, format, session, db] = await Promise.all([
    getTranslations("cases"),
    getTranslations("vehicles"),
    getTranslations("common"),
    getTranslations("inspection"),
    getTranslations("payments"),
    getFormatter(),
    requireSession(),
    tenantDb(),
  ]);

  const repairCase = await db.repairCase.findUnique({
    where: { id },
    include: {
      vehicle: { include: { primaryCustomer: true } },
      contactCustomer: true,
      openedByStaff: true,
      deliveredBy: { select: { name: true } },
      photos: { where: { findingId: null, jobId: null }, orderBy: { capturedAt: "asc" } },
      findings: {
        select: {
          id: true,
          source: true,
          zone: true,
          checklistItem: true,
          jobId: true,
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

  const [jobs, quotations, catalogItems, staffOptions, events, lineUpdates, lineChannel, lineContact, casePhotos, shop, payments] = await Promise.all([
    db.job.findMany({
      where: { caseId: id },
      include: JOB_INCLUDE,
      orderBy: { createdAt: "asc" },
    }),
    db.quotation.findMany({
      where: { caseId: id },
      include: QUOTATION_INCLUDE,
      orderBy: { version: "desc" },
    }),
    db.serviceCatalogItem.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, priceSatang: true },
    }),
    db.staff.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.caseEvent.findMany({
      where: { caseId: id },
      include: CASE_EVENT_INCLUDE,
      orderBy: { at: "asc" },
    }),
    db.lineUpdate.findMany({
      where: { caseId: id },
      include: {
        sentBy: { select: { name: true } },
        photos: { orderBy: { sortOrder: "asc" }, select: { photoId: true } },
      },
      orderBy: { sentAt: "desc" },
    }),
    db.shopLineChannel.findUnique({
      where: { shopId: session.shopId },
      select: { id: true },
    }),
    db.lineContact.findFirst({
      where: { customer: { contactCases: { some: { id } } } },
      select: { followState: true },
    }),
    // Every photo on the case — walkaround, Finding evidence and Job progress
    // shots are all attachable to an Update (CONTEXT.md).
    db.photo.findMany({
      where: { caseId: id },
      orderBy: { capturedAt: "asc" },
      select: { id: true, contentType: true, findingId: true, jobId: true },
    }),
    db.shop.findFirst({ select: { name: true } }),
    db.payment.findMany({
      where: { caseId: id },
      include: PAYMENT_INCLUDE,
      orderBy: { recordedAt: "asc" }, // a ledger reads oldest first
    }),
  ]);

  // The split balance (M7 ruling 2) — derived once, through the one helper.
  const balance = caseBalance(jobs, payments);

  // Opened from the Follow-up worklist (M7 §6): pre-fill the chase draft and
  // let the send flip the row to CONTACTED. A stale or foreign id is ignored
  // here — the composer then behaves like a normal visit update.
  const followUpParam = query["followup"];
  const followUpId = Array.isArray(followUpParam) ? followUpParam[0] : followUpParam;
  const followUpRow = followUpId
    ? await db.followUp.findUnique({
        where: { id: followUpId },
        select: {
          id: true,
          caseId: true,
          jobTitle: true,
          quotedPriceSatang: true,
          checklistItem: true,
          condition: true,
        },
      })
    : null;
  const followUp = followUpRow?.caseId === id ? followUpRow : null;

  const groupFindingParam = query["group-finding"];
  const preselectFindingId = Array.isArray(groupFindingParam)
    ? groupFindingParam[0]
    : groupFindingParam;
  const ungroupedFindings = repairCase.findings
    .filter((f) => f.jobId === null)
    .map((f) => ({ id: f.id, source: f.source, zone: f.zone, checklistItem: f.checklistItem }))
    .reverse(); // oldest first, matching the inspection screen's order

  const { vehicle, contactCustomer, photos, findings } = repairCase;
  const contactIsPrimary = contactCustomer.id === vehicle.primaryCustomerId;
  const descriptors = [vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ");
  const severe = findings.filter((f) => findingSeverity(f) === "SEVERE").length;
  const checklistCount = findings.filter((f) => f.source === "CHECKLIST").length;
  const findingPhotoCount = findings.reduce((sum, f) => sum + f._count.photos, 0);
  const lastRecorded = findings[0]?.recordedAt;

  // The Customer Timeline's send gate (M6 brief §6): each blocked reason is a
  // normal, explained state — never an error, and never a hidden control.
  const blockedReason: SendBlockedReason = !lineChannel
    ? "notConnected"
    : !lineContact
      ? "noIdentity"
      : lineContact.followState === "UNFOLLOWED"
        ? "unfollowed"
        : null;

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
          <JobRollupChips
            jobs={jobs.map((job) => ({
              status: job.status,
              waitingReason: job.waitingReason,
            }))}
          />
          {/* Outstanding money flags — the full split lives in the money
              section; red only once the car is gone (D-3: overdue balance). */}
          {([
            ["CUSTOMER", balance.customer] as const,
            ["INSURER", balance.insurer] as const,
          ]).map(([side, sideBalance]) =>
            sideBalance.dueSatang > 0 ? (
              <span
                key={side}
                className={
                  repairCase.status === "DELIVERED"
                    ? "num border border-bad/45 px-1.5 py-px text-[11px] text-bad"
                    : "num border border-warn/45 px-1.5 py-px text-[11px] text-warn"
                }
              >
                {tp("dueChip", {
                  payer: tp(`payer.${side}`),
                  amount: formatBaht(sideBalance.dueSatang),
                })}
              </span>
            ) : null,
          )}
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
        {repairCase.status === "READY" && repairCase.readyAt && (
          <p className="mt-1 text-xs text-ok">
            {t("readySince", { when: format.relativeTime(repairCase.readyAt) })}
          </p>
        )}
        {repairCase.status === "DELIVERED" && repairCase.deliveredAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("deliveredLine", {
              when: format.dateTime(repairCase.deliveredAt, {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
              name: repairCase.deliveredBy?.name ?? "—",
            })}
          </p>
        )}
        <CaseFlowPanel
          caseId={repairCase.id}
          canMarkReady={
            repairCase.status === "CHECKED_IN" &&
            !hasActiveWork(jobs.map((job) => ({ status: job.status })))
          }
          canDeliver={repairCase.status === "READY"}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="border bg-card p-4">
          <h3 className="eyebrow mb-2.5 flex items-center gap-1.5">
            <Car className="size-3.5" aria-hidden />
            {t("vehicle")}
          </h3>
          <div className="flex items-center gap-2">
            <Link
              href={`/vehicles/${vehicle.id}`}
              className="border border-border-strong px-2 py-0.5 font-mono text-[15px] hover:border-primary-dim hover:text-primary"
            >
              {vehicle.plate}
            </Link>
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

      <JobsPanel
        caseId={repairCase.id}
        initialJobs={jobs.map(toJobDto)}
        initialQuotations={quotations.map(toQuotationDto)}
        initialUngrouped={ungroupedFindings}
        catalogItems={catalogItems}
        staffOptions={staffOptions}
        isManager={can(session.role, "catalog.priceOverride")}
        canSignOffQc={can(session.role, "qc.signOff")}
        canCancelJob={can(session.role, "job.cancel")}
        canRevertStep={can(session.role, "job.revertStep")}
        viewerStaffId={session.staffId}
        readOnly={repairCase.status === "DELIVERED"}
        preselectFindingId={preselectFindingId}
      />

      <PaymentsPanel
        caseId={repairCase.id}
        initialPayments={payments.map(toPaymentDto)}
        owedCustomerSatang={balance.customer.owedSatang}
        owedInsurerSatang={balance.insurer.owedSatang}
        canVoid={can(session.role, "payment.void")}
        caseDelivered={repairCase.status === "DELIVERED"}
        defaultInsurerName={
          jobs.find((job) => job.payerType === "INSURER" && job.insurerName)?.insurerName ?? null
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <CaseTimeline
          events={events}
          checkedInAt={repairCase.checkedInAt}
          openedByName={repairCase.openedByStaff.name}
        />
        <CustomerTimeline
          caseId={repairCase.id}
          initialUpdates={lineUpdates.map((update) => ({
            id: update.id,
            bodyText: update.bodyText,
            deliveryStatus: update.deliveryStatus,
            errorCode: update.errorCode,
            recipientName: update.recipientName,
            sentByName: update.sentBy.name,
            sentAt: update.sentAt.toISOString(),
            photoIds: update.photos.map((photo) => photo.photoId),
          }))}
          draftBody={
            followUp
              ? buildFollowUpDraftBody({
                  shopName: shop?.name ?? "",
                  customerName: contactCustomer.name,
                  plate: vehicle.plate,
                  source: followUp.jobTitle
                    ? {
                        kind: "job",
                        title: followUp.jobTitle,
                        quotedPriceSatang: followUp.quotedPriceSatang,
                      }
                    : {
                        kind: "finding",
                        checklistItem: followUp.checklistItem ?? "",
                        condition: followUp.condition,
                      },
                })
              : buildDraftBody({
                  shopName: shop?.name ?? "",
                  reference: repairCase.reference,
                  plate: vehicle.plate,
                  customerName: contactCustomer.name,
                  caseStatus: repairCase.status,
                  jobs: jobs.map((job) => ({
                    title: job.title,
                    status: job.status,
                    waitingReason: job.waitingReason,
                  })),
                })
          }
          photos={casePhotos.map((photo) => ({
            id: photo.id,
            contentType: photo.contentType,
            origin: photo.findingId ? "finding" : photo.jobId ? "job" : "case",
          }))}
          recipientName={contactCustomer.name}
          blockedReason={blockedReason}
          maxPhotos={LINE_MAX_PHOTOS_PER_UPDATE}
          followUp={
            followUp
              ? ({
                  id: followUp.id,
                  label:
                    followUp.jobTitle ??
                    (followUp.checklistItem
                      ? ti(`checklist.${followUp.checklistItem}` as never)
                      : "—"),
                } satisfies ComposerFollowUp)
              : null
          }
        />
      </div>

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
